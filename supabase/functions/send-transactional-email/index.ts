import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from '../_shared/internal-auth.ts'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { assessOutreachRecipient } from '../_shared/outreach-recipient-guard.ts'
import {
  fingerprintEmail,
  resolveEmailProvider,
} from '../_shared/email-delivery.ts'

// Configuration baked in at scaffold time — do NOT change these manually.
// To update, re-run the email domain setup flow.
const SITE_NAME = "signal-gourmet"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers — never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "notify.gourrmet.com"
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// When display_from_root is enabled, this can be the root domain for cleaner branding,
// even though actual sending uses the subdomain above.
const FROM_DOMAIN = "notify.gourrmet.com"

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// La gateway valide le JWT et le garde partage ci-dessous exige ensuite soit
// le service_role exact, soit un utilisateur Auth present dans user_roles.

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders })
  if (!access.ok) return access.response

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, unknown> = {}
  let signalId: string | null = null
  let contactId: string | null = null
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    const requestedIdempotencyKey = body.idempotencyKey || body.idempotency_key
    idempotencyKey =
      typeof requestedIdempotencyKey === 'string' && requestedIdempotencyKey.trim()
        ? requestedIdempotencyKey.trim()
        : messageId
    signalId = typeof body.signalId === 'string' ? body.signalId
      : (typeof body.signal_id === 'string' ? body.signal_id : null)
    contactId = typeof body.contactId === 'string' ? body.contactId
      : (typeof body.contact_id === 'string' ? body.contact_id : null)
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData as Record<string, unknown>
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  const userId = access.principal.kind === 'user' ? access.principal.userId : null

  if (!templateName) {
    return new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (idempotencyKey.length > 256) {
    return new Response(
      JSON.stringify({ error: 'idempotencyKey must not exceed 256 characters' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 1. Look up template from registry (early — needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    return new Response(
      JSON.stringify({
        error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the caller-provided recipientEmail. This allows notification templates
  // to always send to a fixed address (e.g., site owner from env var).
  const effectiveRecipient = template.to || recipientEmail

  if (!effectiveRecipient) {
    return new Response(
      JSON.stringify({
        error: 'recipientEmail is required (unless the template defines a fixed recipient)',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 2. Check suppression list (fail-closed: if we can't verify, don't send)
  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', {
      error: suppressionError,
      effectiveRecipient,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to verify suppression status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (suppressed) {
    // Log the suppressed attempt
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })

    console.log('Email suppressed', { effectiveRecipient, templateName })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 2 bis. Garde de prospection : jamais d'envoi commercial vers une adresse
  // non vérifiée. La suppression protège les gens qui ont dit non ; cette
  // garde-ci protège le domaine expéditeur — mesuré le 2026-08-22 : 41 adresses
  // vérifiées sur 4 704, 40 déclarées introuvables. Sans elle, le premier lot
  // d'envois après vérification du domaine Resend partirait en majorité vers
  // des adresses jamais vérifiées, et les bounces feraient classer le domaine
  // avant la première vraie campagne. Fail-closed, comme la suppression.
  if (templateName === 'outreach-message') {
    if (!contactId) {
      return new Response(
        JSON.stringify({
          error: 'Un envoi de prospection doit être rattaché à un contact (contactId manquant).',
          reason: 'outreach_requires_contact',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: outreachContact, error: contactError } = await supabase
      .from('contacts')
      .select('email_principal, email_verification_status')
      .eq('id', contactId)
      .maybeSingle()

    if (contactError) {
      console.error('Outreach contact check failed — refusing to send', {
        error: contactError, contactId,
      })
      return new Response(
        JSON.stringify({ error: 'Failed to verify outreach recipient' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const decision = assessOutreachRecipient(outreachContact, effectiveRecipient)
    if (!decision.ok) {
      console.log('Outreach send refused', {
        contactId, reason: decision.reason, effectiveRecipient,
      })
      return new Response(
        JSON.stringify({ success: false, error: decision.error, reason: decision.reason }),
        { status: decision.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
  }

  // 3. Get or create unsubscribe token (one token per email address)
  const normalizedEmail = effectiveRecipient.toLowerCase()
  let unsubscribeToken: string

  // Check for existing token for this email
  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', {
      error: tokenLookupError,
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return new Response(
      JSON.stringify({ error: 'Failed to prepare email' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (existingToken && !existingToken.used_at) {
    // Reuse existing unused token
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    // Create new token — upsert handles concurrent inserts gracefully
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true }
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', {
        error: tokenError,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // If another request raced us, our upsert was silently ignored.
    // Re-read to get the actual stored token.
    const { data: storedToken, error: reReadError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', {
        error: reReadError,
        email: normalizedEmail,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to confirm unsubscribe token storage',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token exists but is already used — email should have been caught by suppression check above.
    // This is a safety fallback; log and skip sending.
    console.warn('Unsubscribe token already used but email not suppressed', {
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message:
        'Unsubscribe token used but email missing from suppressed list',
    })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // RGPD : injecter le lien de désinscription one-click dans les données du
  // template AVANT le rendu (le token est déjà résolu plus haut). On pointe
  // directement sur l'edge function publique handle-email-unsubscribe avec
  // &confirm=1 (désinscription en un clic + page de confirmation HTML), via
  // SUPABASE_URL (jamais d'ID projet en dur).
  templateData = {
    ...templateData,
    unsubscribeUrl: `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(unsubscribeToken)}&confirm=1`,
  }

  // 4. Render React Email template to HTML and plain text
  const html = await renderAsync(
    React.createElement(template.component, templateData)
  )
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true }
  )

  // Resolve subject — supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. Queue and truth row are written atomically by enqueue_tracked_email.
  // Outreach is forced to Resend. Lovable remains available only for future
  // auth/transactional templates and for its dedicated auth queue.
  const provider = resolveEmailProvider({ templateName })
  const purpose = provider === 'resend' ? 'outreach' : 'transactional'
  const senderFrom = provider === 'resend'
    ? (Deno.env.get('RESEND_OUTREACH_FROM')?.trim() ||
      'Clotilde Gautier <clotilde@gourrmet.com>')
    : `Clotilde Gautier <clotilde@${FROM_DOMAIN}>`
  const replyTo = 'clotilde@gourrmet.com'
  const requestFingerprint = await fingerprintEmail({
    provider,
    to: effectiveRecipient,
    from: senderFrom,
    subject: resolvedSubject,
    html,
    text: plainText,
    replyTo,
  })
  const queuePayload = {
    message_id: messageId,
    to: effectiveRecipient,
    from: senderFrom,
    reply_to: replyTo,
    sender_domain: provider === 'lovable_email' ? SENDER_DOMAIN : undefined,
    subject: resolvedSubject,
    html,
    text: plainText,
    provider,
    purpose,
    label: templateName,
    signal_id: signalId,
    contact_id: contactId,
    idempotency_key: idempotencyKey,
    unsubscribe_token: unsubscribeToken,
    queued_at: new Date().toISOString(),
  }

  const { data: queueResult, error: enqueueError } = await supabase.rpc(
    'enqueue_tracked_email',
    {
      p_message_id: messageId,
      p_idempotency_key: idempotencyKey,
      p_request_fingerprint: requestFingerprint,
      p_provider: provider,
      p_template_name: templateName,
      p_recipient_email: effectiveRecipient,
      p_sender_email: senderFrom,
      p_subject: resolvedSubject,
      p_body: plainText,
      p_signal_id: signalId,
      p_contact_id: contactId,
      p_user_id: userId,
      p_metadata: {
        template_name: templateName,
        reply_to: replyTo,
      },
      p_payload: queuePayload,
    }
  )

  if (enqueueError) {
    console.error('Failed to enqueue email', {
      error: enqueueError,
      templateName,
      effectiveRecipient,
    })

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })

    const conflict = enqueueError.code === '22000'
    return new Response(JSON.stringify({
      error: conflict
        ? 'This idempotency key was already used for a different email'
        : 'Failed to enqueue email',
    }), {
      status: conflict ? 409 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const result = queueResult && typeof queueResult === 'object'
    ? queueResult as Record<string, unknown>
    : {}

  console.log('Email queue request accepted', {
    templateName,
    provider,
    queued: result.queued === true,
    status: result.status,
  })

  return new Response(
    JSON.stringify({
      success: true,
      queued: result.queued === true,
      status: result.status ?? 'queued',
      message_id: result.message_id ?? messageId,
      log_id: result.email_id ?? null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
