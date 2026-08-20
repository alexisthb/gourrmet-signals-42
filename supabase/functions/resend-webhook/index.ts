import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  resendStatusForEvent,
  verifySvixSignature,
} from '../_shared/email-delivery.ts'

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!supabaseUrl || !supabaseServiceKey || !webhookSecret) {
    console.error('Resend webhook configuration is incomplete')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const messageId = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signature = req.headers.get('svix-signature')
  if (!messageId || !timestamp || !signature) {
    return jsonResponse({ error: 'Missing webhook signature headers' }, 400)
  }

  // The exact raw bytes must be verified before parsing JSON.
  const rawBody = await req.text()
  const signatureIsValid = await verifySvixSignature({
    payload: rawBody,
    messageId,
    timestamp,
    signature,
    secret: webhookSecret,
  })
  if (!signatureIsValid) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 400)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: 'Invalid webhook JSON' }, 400)
  }

  const eventType = typeof payload.type === 'string' ? payload.type : ''
  const deliveryStatus = resendStatusForEvent(eventType)
  if (!deliveryStatus) {
    // Open/click/delay events are deliberately outside the delivery state
    // machine. Acknowledge them so Resend does not retry them needlessly.
    return jsonResponse({ received: true, ignored: true })
  }

  const data = payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : null
  const providerMessageId =
    data && typeof data.email_id === 'string' ? data.email_id : ''
  const createdAt =
    typeof payload.created_at === 'string' ? payload.created_at : ''
  if (!providerMessageId || !createdAt || Number.isNaN(Date.parse(createdAt))) {
    return jsonResponse({ error: 'Invalid webhook payload' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const { data: application, error } = await supabase.rpc(
    'apply_resend_email_event',
    {
      p_event_id: messageId,
      p_provider_message_id: providerMessageId,
      p_event_type: eventType,
      p_status: deliveryStatus,
      p_occurred_at: new Date(createdAt).toISOString(),
    }
  )

  if (error) {
    console.error('Failed to persist Resend webhook event', {
      eventType,
      error,
    })
    // Resend retries failed deliveries; do not acknowledge a DB failure.
    return jsonResponse({ error: 'Failed to persist webhook event' }, 500)
  }

  const result = application && typeof application === 'object'
    ? application as Record<string, unknown>
    : {}
  console.log('Resend webhook event persisted', {
    eventType,
    applied: result.applied === true,
    duplicate: result.duplicate === true,
  })

  return jsonResponse({
    received: true,
    applied: result.applied === true,
    duplicate: result.duplicate === true,
    status: result.status ?? deliveryStatus,
  })
})
