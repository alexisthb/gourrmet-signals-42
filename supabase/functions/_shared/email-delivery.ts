export type EmailProvider = 'resend' | 'lovable_email'

export type ResendDeliveryStatus =
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'complained'
  | 'suppressed'

export interface ResendEmailInput {
  to: string
  from: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
  idempotencyKey: string
}

export interface ResendEmailResult {
  id: string
  httpStatus: number
}

export class EmailProviderError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    options: {
      status: number
      code?: string | null
      retryAfterSeconds?: number | null
    }
  ) {
    super(message)
    this.name = 'EmailProviderError'
    this.status = options.status
    this.code = options.code ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

export function resolveEmailProvider(input: {
  templateName?: unknown
  purpose?: unknown
  requestedProvider?: unknown
}): EmailProvider {
  // Commercial outreach must never fall back to Lovable Email. This also
  // catches legacy queue messages created before the provider field existed.
  if (
    input.templateName === 'outreach-message' ||
    input.purpose === 'outreach' ||
    input.requestedProvider === 'resend'
  ) {
    return 'resend'
  }

  return 'lovable_email'
}

export function resendStatusForEvent(eventType: string): ResendDeliveryStatus | null {
  switch (eventType) {
    case 'email.sent':
      return 'sent'
    case 'email.delivered':
      return 'delivered'
    case 'email.failed':
      return 'failed'
    case 'email.suppressed':
      return 'suppressed'
    case 'email.bounced':
      return 'bounced'
    case 'email.complained':
      return 'complained'
    default:
      return null
  }
}

export function canRecoverLocalProviderAcceptance(
  status: string,
  providerMessageId: string | null,
): boolean {
  return status === 'failed' && providerMessageId === null
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds)
  }

  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  }

  return null
}

function safeProviderCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const candidate = record.name ?? record.code
  return typeof candidate === 'string' ? candidate.slice(0, 120) : null
}

export async function sendResendEmail(
  input: ResendEmailInput,
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<ResendEmailResult> {
  if (!apiKey) {
    throw new EmailProviderError('RESEND_API_KEY is not configured', { status: 503 })
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
    throw new EmailProviderError('Invalid Resend idempotency key', {
      status: 400,
      code: 'invalid_idempotency_key',
    })
  }

  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // A malformed provider response is handled as an explicit failure below.
  }

  if (!response.ok) {
    const code = safeProviderCode(payload)
    throw new EmailProviderError(
      `Resend rejected the email request (${response.status}${code ? `, ${code}` : ''})`,
      {
        status: response.status,
        code,
        retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
      }
    )
  }

  const providerId =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).id
      : null
  if (typeof providerId !== 'string' || !providerId) {
    throw new EmailProviderError('Resend returned no email id', { status: 502 })
  }

  return { id: providerId, httpStatus: response.status }
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const decoded = atob(value)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let difference = left.length ^ right.length

  for (let index = 0; index < maxLength; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }

  return difference === 0
}

export async function verifySvixSignature(input: {
  payload: string
  messageId: string
  timestamp: string
  signature: string
  secret: string
  nowSeconds?: number
  toleranceSeconds?: number
}): Promise<boolean> {
  const timestampNumber = Number.parseInt(input.timestamp, 10)
  if (!Number.isSafeInteger(timestampNumber)) return false

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const toleranceSeconds = input.toleranceSeconds ?? 300
  if (Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) return false

  const encodedSecret = input.secret.startsWith('whsec_')
    ? input.secret.slice('whsec_'.length)
    : input.secret
  const secretBytes = decodeBase64(encodedSecret)
  if (!secretBytes?.length) return false

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signedPayload = `${input.messageId}.${timestampNumber}.${input.payload}`
  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload)
  )
  const expected = btoa(
    String.fromCharCode(...new Uint8Array(signatureBytes))
  )

  return input.signature.split(' ').some((candidate) => {
    const [version, signature] = candidate.split(',', 2)
    return version === 'v1' && Boolean(signature) && constantTimeEqual(signature, expected)
  })
}

export async function fingerprintEmail(input: {
  provider: EmailProvider
  to: string
  from: string
  subject: string
  html: string
  text: string
  replyTo: string
}): Promise<string> {
  const canonicalPayload = JSON.stringify([
    input.provider,
    input.to.trim().toLowerCase(),
    input.from,
    input.subject,
    input.html,
    input.text,
    input.replyTo,
  ])
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalPayload)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
