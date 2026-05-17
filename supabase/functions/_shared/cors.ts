// Helper CORS partagé entre toutes les Edge Functions.
// Avant: chaque fonction avait son propre `Access-Control-Allow-Origin: *` en dur.
// Maintenant: whitelist via env var ALLOWED_ORIGINS (CSV), avec fallback `*` en dev.
//
// Usage:
//   import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
//   if (req.method === "OPTIONS") return handleCorsPreflight(req);
//   ... new Response(body, { headers: { ...corsHeaders(req), "Content-Type": "application/json" } })

const COMMON_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version';

function getAllowedOrigins(): string[] | null {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (!raw) return null; // fallback: tout autoriser (compat)
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveOrigin(req: Request): string {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = getAllowedOrigins();
  if (!allowed) return '*';
  if (allowed.includes(origin)) return origin;
  // fallback : premier origin de la whitelist (au lieu de *, qui leak des infos)
  return allowed[0] ?? '*';
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(req),
    'Access-Control-Allow-Headers': COMMON_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function handleCorsPreflight(req: Request): Response {
  return new Response(null, { headers: corsHeaders(req) });
}

// Helper utilitaire pour les fetch avec timeout (utile partout).
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
