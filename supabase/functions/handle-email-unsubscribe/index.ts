import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Page HTML minimaliste pour la désinscription one-click depuis un email.
function htmlResponse(title: string, message: string, status = 200): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#faf7f2;color:#1a1a1a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;max-width:480px;padding:40px 32px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);text-align:center}
h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.6;color:#4a4a4a;margin:0}
.brand{font-weight:700;letter-spacing:.08em;color:#2E3E92;margin-bottom:24px}</style></head>
<body><div class="card"><div class="brand">GOURЯMET</div><h1>${title}</h1><p>${message}</p></div></body></html>`
  return new Response(html, { status, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
}

// Marque le token comme utilisé (atomique, anti-TOCTOU) puis ajoute l'email à la
// liste de suppression. Retourne 'ok' | 'already' | 'error'.
async function processUnsubscribe(
  supabase: ReturnType<typeof createClient>,
  token: string,
  email: string,
): Promise<'ok' | 'already' | 'error'> {
  const { data: updated, error: updateError } = await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select()
    .maybeSingle()

  if (updateError) {
    console.error('Failed to mark token as used', { error: updateError })
    return 'error'
  }
  if (!updated) return 'already'

  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert({ email: email.toLowerCase(), reason: 'unsubscribe' }, { onConflict: 'email' })

  if (suppressError) {
    console.error('Failed to suppress email', { error: suppressError })
    return 'error'
  }
  console.log('Email unsubscribed')
  return 'ok'
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Extract token from query params (GET) or body (POST)
  const url = new URL(req.url)
  let token: string | null = url.searchParams.get('token')

  if (req.method === 'POST') {
    // Detect RFC 8058 one-click unsubscribe: POST with form-encoded body
    // containing "List-Unsubscribe=One-Click". Email clients (Gmail, Apple Mail,
    // etc.) send this when the user clicks "Unsubscribe" in the mail UI.
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await req.text()
      const params = new URLSearchParams(formText)
      // For one-click, token comes from query param (already set above).
      // Otherwise, token may be in the form body.
      if (!params.get('List-Unsubscribe')) {
        const formToken = params.get('token')
        if (formToken) {
          token = formToken
        }
      }
    } else {
      // JSON body (from the app's unsubscribe page)
      try {
        const body = await req.json()
        if (body.token) {
          token = body.token
        }
      } catch {
        // Fall through — token stays from query param
      }
    }
  }

  if (!token) {
    return jsonResponse({ error: 'Token is required' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Look up the token
  const { data: tokenRecord, error: lookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (lookupError || !tokenRecord) {
    return jsonResponse({ error: 'Invalid or expired token' }, 404)
  }

  // One-click depuis un email : GET ?token=...&confirm=1 → désinscrit
  // immédiatement et renvoie une page HTML de confirmation (lien cliquable
  // dans le footer des emails, RGPD).
  const oneClick = req.method === 'GET' && url.searchParams.get('confirm') === '1'

  if (tokenRecord.used_at) {
    return oneClick
      ? htmlResponse('Déjà désinscrit', 'Cette adresse est déjà désinscrite de nos communications.')
      : jsonResponse({ valid: false, reason: 'already_unsubscribed' })
  }

  // GET sans confirm : valider le token uniquement (la page /unsubscribe du SPA
  // appelle ceci au chargement avant de proposer le bouton de confirmation).
  if (req.method === 'GET' && !oneClick) {
    return jsonResponse({ valid: true })
  }

  // GET one-click OU POST : traiter la désinscription.
  const result = await processUnsubscribe(supabase, token, tokenRecord.email)

  if (oneClick) {
    if (result === 'error') return htmlResponse('Erreur', 'Une erreur est survenue. Réessayez plus tard.', 500)
    if (result === 'already') return htmlResponse('Déjà désinscrit', 'Cette adresse est déjà désinscrite.')
    return htmlResponse('Désinscription confirmée', 'Vous ne recevrez plus de messages de la part de GOURЯMET. À bientôt.')
  }

  if (result === 'error') return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  if (result === 'already') return jsonResponse({ success: false, reason: 'already_unsubscribed' })
  return jsonResponse({ success: true })
})
