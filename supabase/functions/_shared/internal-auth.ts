export type InternalPrincipal =
  | { kind: 'service_role'; userId: null; role: 'service_role' }
  | { kind: 'user'; userId: string; role: string }

export type InternalAccessResult =
  | { ok: true; principal: InternalPrincipal }
  | { ok: false; response: Response }

export interface InternalAuthOptions {
  supabaseUrl?: string
  serviceRoleKey?: string
  fetchImpl?: typeof fetch
  responseHeaders?: Record<string, string>
}

function jsonError(
  status: number,
  error: string,
  responseHeaders: Record<string, string> = {},
): InternalAccessResult {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...responseHeaders, 'Content-Type': 'application/json' },
    }),
  }
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get('Authorization')?.trim()
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1] ?? null
}

/**
 * Garde d'acces pour toute Edge Function qui peut utiliser le service_role ou
 * consommer un fournisseur payant.
 *
 * Deux identites seulement sont admises :
 * - la valeur exacte de SUPABASE_SERVICE_ROLE_KEY (cron/orchestration interne) ;
 * - un utilisateur verifie par Supabase Auth qui possede au moins une ligne
 *   public.user_roles.
 *
 * Le contenu non verifie d'un JWT n'est jamais utilise pour autoriser l'appel.
 */
export async function requireInternalAccess(
  req: Request,
  options: InternalAuthOptions = {},
): Promise<InternalAccessResult> {
  const supabaseUrl = options.supabaseUrl ?? Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = options.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const fetchImpl = options.fetchImpl ?? fetch
  const responseHeaders = options.responseHeaders

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[internal-auth] Missing Supabase server configuration')
    return jsonError(500, 'Server configuration error', responseHeaders)
  }

  const token = bearerToken(req)
  if (!token) return jsonError(401, 'Unauthorized', responseHeaders)

  // Ne pas deduire le role depuis les claims : seul le secret exact ouvre la
  // voie interne sans utilisateur.
  if (token === serviceRoleKey) {
    return {
      ok: true,
      principal: { kind: 'service_role', userId: null, role: 'service_role' },
    }
  }

  let userResponse: Response
  try {
    userResponse = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (error) {
    console.error('[internal-auth] Auth user verification failed', error)
    return jsonError(503, 'Authorization verification unavailable', responseHeaders)
  }

  if (!userResponse.ok) return jsonError(401, 'Unauthorized', responseHeaders)

  let userId: string | null = null
  try {
    const body = await userResponse.json() as { id?: unknown; user?: { id?: unknown } }
    const candidate = typeof body.id === 'string' ? body.id : body.user?.id
    userId = typeof candidate === 'string' && candidate.length > 0 ? candidate : null
  } catch {
    return jsonError(401, 'Unauthorized', responseHeaders)
  }
  if (!userId) return jsonError(401, 'Unauthorized', responseHeaders)

  const rolesUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/user_roles`)
  rolesUrl.searchParams.set('select', 'role')
  rolesUrl.searchParams.set('user_id', `eq.${userId}`)
  rolesUrl.searchParams.set('limit', '1')

  let rolesResponse: Response
  try {
    rolesResponse = await fetchImpl(rolesUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    })
  } catch (error) {
    console.error('[internal-auth] user_roles verification failed', error)
    return jsonError(503, 'Authorization verification unavailable', responseHeaders)
  }

  if (!rolesResponse.ok) {
    console.error('[internal-auth] user_roles verification returned', rolesResponse.status)
    return jsonError(503, 'Authorization verification unavailable', responseHeaders)
  }

  let role: string | null = null
  try {
    const rows = await rolesResponse.json() as Array<{ role?: unknown }>
    role = Array.isArray(rows) && typeof rows[0]?.role === 'string' ? rows[0].role : null
  } catch {
    return jsonError(503, 'Authorization verification unavailable', responseHeaders)
  }

  if (!role) return jsonError(403, 'Forbidden', responseHeaders)

  return { ok: true, principal: { kind: 'user', userId, role } }
}
