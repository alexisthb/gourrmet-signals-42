// Client Dropcontact (https://api.dropcontact.io) — recherche + vérification d'emails B2B
// nominatifs, 100 % RGPD. Remplace l'agent Manus pour la partie "email vérifié".
//
// Modèle ASYNCHRONE côté Dropcontact : POST /batch renvoie un request_id, puis on interroge
// GET /batch/{request_id} jusqu'à success:true. On borne le polling pour rester SOUS le
// timeout du worker (60 s) : l'enrichissement waterfall reste donc synchrone de bout en bout.
//
// Règle anti-fabrication (GR-002) : Dropcontact ne renvoie que des emails qu'il a qualifiés ;
// on n'insère JAMAIS un email dont la qualification est explicitement négative.

const BASE = "https://api.dropcontact.io";

export interface DropcontactInput {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  website?: string;
  num_siren?: string;
}

interface DropcontactEmail {
  email?: string;
  qualification?: string;
}

export interface DropcontactResult {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: DropcontactEmail[];
  phone?: string;
  mobile_phone?: string;
  company?: string;
  website?: string;
  job?: string;
  linkedin?: string;
}

// Qualifications qui signalent un email NON exploitable — tout le reste (nominatif pro,
// nominatif, etc.) est accepté. On raisonne par liste de rejet plutôt que par liste blanche :
// Dropcontact fait évoluer ses libellés, et il ne renvoie de toute façon que des emails qualifiés.
const NEGATIVE_QUALIF_RE = /wrong|invalid|not[_\s-]?found|unqualified|risky|catch[_\s-]?all|no[_\s-]?email/i;
// Préférence forte : email nominatif sur domaine professionnel.
const NOMINATIVE_PRO_RE = /nominative.*pro|pro.*nominative|nominatif.*pro/i;

// Choisit le meilleur email vérifié d'un résultat Dropcontact, ou null si aucun exploitable.
export function pickVerifiedEmail(
  emails: DropcontactEmail[] | undefined,
): { email: string; qualification: string } | null {
  if (!Array.isArray(emails)) return null;
  const good = emails
    .filter((e) => e?.email && typeof e.email === "string" && !NEGATIVE_QUALIF_RE.test(e.qualification || ""))
    .sort((a, b) => (NOMINATIVE_PRO_RE.test(b.qualification || "") ? 1 : 0) - (NOMINATIVE_PRO_RE.test(a.qualification || "") ? 1 : 0));
  if (!good.length) return null;
  return { email: good[0].email as string, qualification: good[0].qualification || "unknown" };
}

// Soumet un lot. Renvoie le request_id ou une erreur (jamais throw : l'appelant décide).
export async function submitDropcontactBatch(
  apiKey: string,
  data: DropcontactInput[],
): Promise<{ request_id: string } | { error: string }> {
  try {
    const resp = await fetch(`${BASE}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": apiKey },
      body: JSON.stringify({ data, siren: true, language: "fr" }),
    });
    const j = await resp.json().catch(() => ({} as any));
    if (!resp.ok || !j?.request_id) {
      return { error: `Dropcontact submit ${resp.status}: ${String(j?.reason || j?.error || "no request_id").slice(0, 160)}` };
    }
    return { request_id: j.request_id as string };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Dropcontact submit failed" };
  }
}

// Interroge le lot jusqu'à ce qu'il soit prêt. Dropcontact renvoie success:false tant que le
// traitement n'est pas terminé -> on re-poll. Borné par maxAttempts*delayMs (défaut ~30 s).
export async function pollDropcontactBatch(
  apiKey: string,
  requestId: string,
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<{ data: DropcontactResult[] } | { error: string; pending?: boolean }> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const delayMs = opts.delayMs ?? 5000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const resp = await fetch(`${BASE}/batch/${requestId}`, { headers: { "X-Access-Token": apiKey } });
      const j = await resp.json().catch(() => ({} as any));
      if (j?.success === true && Array.isArray(j?.data)) {
        return { data: j.data as DropcontactResult[] };
      }
      // success:false => encore en traitement, on continue.
    } catch (_e) {
      // erreur transitoire réseau -> on retente au tour suivant
    }
  }
  return { error: "Dropcontact: lot pas prêt dans le délai imparti", pending: true };
}
