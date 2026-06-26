// Helper CORS partagé entre toutes les Edge Functions.
// Avant: chaque fonction avait son propre `Access-Control-Allow-Origin: *` en dur,
// dupliqué ~35 fois. Maintenant: une seule source de vérité, configurable via la
// variable d'environnement ALLOWED_ORIGINS (CSV). Défaut `*` (compat) si absente.
//
// Usage (drop-in, identique à l'ancien objet local — `corsHeaders` reste un objet):
//   import { corsHeaders } from "../_shared/cors.ts";
//   if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
//   return new Response(body, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
//
// Pour durcir en prod: définir ALLOWED_ORIGINS="https://app.exemple.fr" dans les
// secrets Supabase (Edge Functions). Une seule variable durcit TOUTES les fonctions.
// Plusieurs origines: CSV — l'objet `corsHeaders` renvoie la 1re; pour un écho
// par-requête multi-domaines, utiliser `corsHeadersFor(req)`.

const COMMON_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-setup-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version';

function allowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Objet figé au démarrage (cold start). Drop-in pour les ~250 sites `...corsHeaders`.
// `*` tant que ALLOWED_ORIGINS n'est pas défini → aucun changement de comportement.
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigins()[0] ?? '*',
  'Access-Control-Allow-Headers': COMMON_HEADERS,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Vary': 'Origin',
};

// Variante par-requête: écho de l'Origin s'il est dans la whitelist (multi-domaines).
// Optionnelle — aucune fonction n'en a besoin aujourd'hui, dispo si un jour plusieurs
// domaines front doivent taper les mêmes fonctions.
export function corsHeadersFor(req: Request): Record<string, string> {
  const allowed = allowedOrigins();
  if (allowed.length === 0) return corsHeaders;
  const origin = req.headers.get('Origin') ?? '';
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] ?? '*'),
  };
}

export function handleCorsPreflight(req?: Request): Response {
  return new Response(null, { headers: req ? corsHeadersFor(req) : corsHeaders });
}

// Helper utilitaire pour les fetch avec timeout (utile partout).
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
