import {
  canRecoverLocalProviderAcceptance,
  EmailProviderError,
  fingerprintEmail,
  resendStatusForEvent,
  resolveEmailProvider,
  sendResendEmail,
  verifySvixSignature,
} from './email-delivery.ts'

function assert(condition: unknown, message = 'assertion failed'): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test('outreach is always routed to Resend', () => {
  assertEquals(
    resolveEmailProvider({
      templateName: 'outreach-message',
      purpose: 'transactional',
      requestedProvider: 'lovable_email',
    }),
    'resend'
  )
  assertEquals(resolveEmailProvider({ purpose: 'auth' }), 'lovable_email')
})

Deno.test('Resend delivery events map to truthful states', () => {
  assertEquals(resendStatusForEvent('email.sent'), 'sent')
  assertEquals(resendStatusForEvent('email.delivered'), 'delivered')
  assertEquals(resendStatusForEvent('email.failed'), 'failed')
  assertEquals(resendStatusForEvent('email.bounced'), 'bounced')
  assertEquals(resendStatusForEvent('email.complained'), 'complained')
  assertEquals(resendStatusForEvent('email.suppressed'), 'suppressed')
  assertEquals(resendStatusForEvent('email.opened'), null)
})

Deno.test('provider acceptance only recovers a local failed row without provider id', () => {
  assert(canRecoverLocalProviderAcceptance('failed', null))
  assert(!canRecoverLocalProviderAcceptance('failed', 'email_provider_terminal'))
  assert(!canRecoverLocalProviderAcceptance('bounced', null))
  assert(!canRecoverLocalProviderAcceptance('complained', null))
  assert(!canRecoverLocalProviderAcceptance('sent', null))
})

Deno.test('Resend request carries the provider idempotency key and reply-to', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const result = await sendResendEmail(
    {
      to: 'recipient@example.com',
      from: 'Sender <sender@example.com>',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
      replyTo: 'reply@example.com',
      idempotencyKey: 'outreach/signal-1',
    },
    're_test',
    ((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'email_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }) as typeof fetch
  )

  assertEquals(result, { id: 'email_123', httpStatus: 200 })
  assertEquals(capturedUrl, 'https://api.resend.com/emails')
  const headers = new Headers(capturedInit?.headers)
  assertEquals(headers.get('Idempotency-Key'), 'outreach/signal-1')
  const body = JSON.parse(String(capturedInit?.body))
  assertEquals(body.reply_to, 'reply@example.com')
  assertEquals(body.to, ['recipient@example.com'])
})

Deno.test('Resend errors retain status, code and retry delay without accepting the send', async () => {
  let caught: unknown
  try {
    await sendResendEmail(
      {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Subject',
        idempotencyKey: 'outreach/signal-2',
      },
      're_test',
      (() =>
        Promise.resolve(
          new Response(JSON.stringify({ name: 'rate_limit_exceeded' }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '17',
            },
          })
        )) as typeof fetch
    )
  } catch (error) {
    caught = error
  }

  assert(caught instanceof EmailProviderError)
  assertEquals(caught.status, 429)
  assertEquals(caught.code, 'rate_limit_exceeded')
  assertEquals(caught.retryAfterSeconds, 17)
})

Deno.test('Svix signature verification uses the raw body and rejects replayed timestamps', async () => {
  const secretBytes = new TextEncoder().encode('a-test-webhook-secret-with-32-bytes')
  const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`
  const payload = '{"type":"email.sent","data":{"email_id":"email_123"}}'
  const messageId = 'msg_test'
  const timestamp = '1700000000'
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${messageId}.${timestamp}.${payload}`)
  )
  const signature = `v1,${btoa(String.fromCharCode(...new Uint8Array(digest)))}`

  assert(
    await verifySvixSignature({
      payload,
      messageId,
      timestamp,
      signature: `v0,ignored ${signature}`,
      secret,
      nowSeconds: 1_700_000_100,
    })
  )
  assert(
    !(await verifySvixSignature({
      payload: `${payload} `,
      messageId,
      timestamp,
      signature,
      secret,
      nowSeconds: 1_700_000_100,
    }))
  )
  assert(
    !(await verifySvixSignature({
      payload,
      messageId,
      timestamp,
      signature,
      secret,
      nowSeconds: 1_700_000_301,
    }))
  )
})

Deno.test('email fingerprint changes when the provider payload changes', async () => {
  const base = {
    provider: 'resend' as const,
    to: 'recipient@example.com',
    from: 'sender@example.com',
    subject: 'Subject',
    html: '<p>Hello</p>',
    text: 'Hello',
    replyTo: 'reply@example.com',
  }
  const first = await fingerprintEmail(base)
  const same = await fingerprintEmail({ ...base, to: ' RECIPIENT@example.com ' })
  const changed = await fingerprintEmail({ ...base, subject: 'Other subject' })

  assertEquals(first, same)
  assert(first !== changed)
})
