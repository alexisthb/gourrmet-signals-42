import type { ResolutionStatus } from "./apify-linkedin.ts";

export interface PappersContactCandidate {
  first_name: string;
  last_name: string;
  job_title: string | null;
  source: "pappers";
  resolution_status: "resolved";
  resolution_score: number;
  resolution_provenance: Record<string, unknown>;
  dropcontact_candidate_id?: string;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || /^(?:n\/?a|na|-|null|none|undefined)(?:\s+(?:n\/?a|na|-|null|none|undefined))*$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function fromFullName(fullName: string | null): { first: string | null; last: string | null } {
  if (!fullName) return { first: null, last: null };
  const withoutTitle = fullName.replace(/^(?:m(?:\.|onsieur)?|mme\.?|madame)\s+/i, "");
  const parts = withoutTitle.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] || null, last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function firstGivenName(value: string | null): string | null {
  if (!value) return null;
  return value.split(",")[0].trim() || null;
}

// Décision déterministe sur les représentants légaux : seules les personnes physiques avec
// prénom et nom complets sont résolues. Le score décrit cette complétude, pas une accuracy.
export function extractPappersRepresentatives(fiche: any): {
  candidates: PappersContactCandidate[];
  website: string | null;
  industry: string | null;
  counts: Record<ResolutionStatus, number>;
  reasonCounts: Record<string, number>;
} {
  const raw = [
    ...(Array.isArray(fiche?.representants) ? fiche.representants : []),
    ...(Array.isArray(fiche?.dirigeants) ? fiche.dirigeants : []),
  ];
  const seen = new Set<string>();
  const candidates: PappersContactCandidate[] = [];
  const counts: Record<ResolutionStatus, number> = { resolved: 0, ambiguous: 0, rejected: 0 };
  const reasonCounts: Record<string, number> = {};
  const countReason = (reason: string) => {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  };

  for (const representative of raw) {
    const explicitlyCorporate = representative?.personne_morale === true ||
      representative?.est_personne_morale === true ||
      /personne\s+morale|morale/i.test(String(representative?.type_personne || representative?.type || "")) ||
      Boolean(clean(representative?.denomination) && !clean(representative?.prenom) && !clean(representative?.nom));
    if (explicitlyCorporate) {
      counts.rejected++;
      countReason("corporate_representative");
      continue;
    }

    let first = clean(representative?.prenom);
    let last = clean(representative?.nom) || clean(representative?.nom_famille);
    if (!first && !last) {
      const derived = fromFullName(clean(representative?.nom_complet) || clean(representative?.nom_complet_sans_civilite));
      first = derived.first;
      last = derived.last;
    }
    first = firstGivenName(first);
    if (!first || !last) {
      counts.ambiguous++;
      countReason("incomplete_identity");
      continue;
    }

    const key = `${first.toLocaleLowerCase("fr")}|${last.toLocaleLowerCase("fr")}`;
    if (seen.has(key)) {
      counts.rejected++;
      countReason("duplicate_identity");
      continue;
    }
    seen.add(key);
    candidates.push({
      first_name: first,
      last_name: last,
      job_title: clean(representative?.qualite) || clean(representative?.fonction),
      source: "pappers",
      resolution_status: "resolved",
      resolution_score: 100,
      resolution_provenance: {
        provider: "pappers",
        algorithm: "registry-representative-v1",
        reason: "physical_person_with_complete_legal_name",
        evidence: ["physical_person", "complete_legal_name"],
      },
    });
    counts.resolved++;
    countReason("physical_person_with_complete_legal_name");
  }

  return {
    candidates,
    website: clean(fiche?.site_web) || clean(fiche?.siege?.site_web),
    industry: clean(fiche?.libelle_code_naf) || clean(fiche?.domaine_activite),
    counts,
    reasonCounts,
  };
}
