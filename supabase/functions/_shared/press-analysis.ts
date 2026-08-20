export type PressAnalysisSignal = {
  company_name?: string;
  signal_type?: unknown;
  event_detail?: string | null;
  sector?: string | null;
  estimated_size?: unknown;
  score?: unknown;
  hook_suggestion?: string | null;
  source_url?: unknown;
};

export type PressAnalysisParseResult =
  | { ok: true; signals: PressAnalysisSignal[] }
  | { ok: false; error: string };

export type PressPriorityZone = {
  name: string;
  regions?: string[] | null;
  cities?: string[] | null;
};

export type PressBacklogMetrics = {
  ready?: number | null;
  in_flight?: number | null;
  retry_waiting?: number | null;
  dead_lettered?: number | null;
  exhausted_orphan?: number | null;
  next_retry_at?: string | null;
};

export function summarizePressBacklog(metrics: PressBacklogMetrics) {
  const count = (value: number | null | undefined) =>
    Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
  const ready = count(metrics.ready);
  const inFlight = count(metrics.in_flight);
  const retryWaiting = count(metrics.retry_waiting);
  const deadLettered = count(metrics.dead_lettered);
  const exhausted = count(metrics.exhausted_orphan);
  const outstanding = ready + inFlight + retryWaiting + deadLettered + exhausted;

  return {
    hasOutstanding: outstanding > 0,
    outstanding,
    retryable: ready + retryWaiting,
    ready,
    inFlight,
    retryWaiting,
    deadLettered,
    exhausted,
    nextRetryAt: metrics.next_retry_at ?? null,
  };
}

export function initialPressProviderUsage(
  provider: "lovable_ai" | "perplexity",
): { units: number; unitName: string } {
  // Ces deux fournisseurs ne rendent leur consommation en tokens qu'avec la
  // réponse. L'événement initial reste donc non valorisable jusqu'au terminal.
  return provider === "lovable_ai" || provider === "perplexity"
    ? { units: 0, unitName: "tokens_pending" }
    : { units: 1, unitName: "request" };
}

export function findOverlappingPressDispatch<
  T extends {
    metadata: unknown;
  },
>(rows: T[], claimedArticleIds: string[]): T | null {
  const claimed = new Set(claimedArticleIds);
  return rows.find((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" &&
        !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    const articleIds = Array.isArray(metadata.article_ids)
      ? metadata.article_ids.filter((value): value is string =>
        typeof value === "string"
      )
      : [];
    const articleId = typeof metadata.article_id === "string"
      ? metadata.article_id
      : null;
    return (articleId !== null && claimed.has(articleId)) ||
      articleIds.some((id) => claimed.has(id));
  }) ?? null;
}

export function buildPressGeographyInstruction(
  priorityZones: PressPriorityZone[],
): string {
  const priorityLabels = [
    ...new Set(
      priorityZones.flatMap((zone) => [
        zone.name,
        ...(zone.regions ?? []),
        ...(zone.cities ?? []),
      ]).map((label) => label.trim()).filter(Boolean),
    ),
  ].slice(0, 40);

  const priorityLine = priorityLabels.length > 0
    ? `Les zones configurées comme prioritaires (${
      priorityLabels.join(", ")
    }) peuvent augmenter la priorité commerciale, mais ne sont jamais un filtre d'exclusion.`
    : "Aucune zone prioritaire n'est configurée : applique uniquement la couverture nationale.";

  return `## COUVERTURE GÉOGRAPHIQUE : FRANCE ENTIÈRE

Analyser la France entière : toute entreprise basée en France est éligible, quelle que soit sa région. Une société située à Bordeaux, Lille, Nantes, Strasbourg, Toulouse ou dans toute autre ville française est pleinement éligible.
Il faut ne jamais exclure une entreprise française au seul motif qu'elle se trouve hors d'une zone prioritaire.
Ignorer uniquement les entreprises dont l'implantation concernée est hors de France.
${priorityLine}`;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function tryParseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function removeUnsafeControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return !(
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    );
  }).join("");
}

export function parsePressAnalysisResponse(
  responseText: string,
  expectedArticlesAnalyzed?: number,
): PressAnalysisParseResult {
  const cleaned = responseText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const repaired = removeUnsafeControlCharacters(
    cleaned.replace(/,\s*([}\]])/g, "$1"),
  );

  let parsed = tryParseObject(cleaned) ?? tryParseObject(repaired);
  if (!parsed) {
    const firstObject = extractFirstJsonObject(cleaned);
    if (firstObject) {
      parsed = tryParseObject(firstObject) ?? tryParseObject(
        firstObject.replace(/,\s*([}\]])/g, "$1"),
      );
    }
  }

  if (!parsed) return { ok: false, error: "unparseable_ai_response" };
  if (!Array.isArray(parsed.signals)) {
    return { ok: false, error: "signals_is_not_an_array" };
  }
  if (
    typeof parsed.articles_analyzed !== "number" ||
    !Number.isInteger(parsed.articles_analyzed) ||
    parsed.articles_analyzed < 0
  ) {
    return {
      ok: false,
      error: "articles_analyzed_is_not_a_non_negative_integer",
    };
  }
  if (
    typeof parsed.signals_found !== "number" ||
    !Number.isInteger(parsed.signals_found) ||
    parsed.signals_found < 0
  ) {
    return {
      ok: false,
      error: "signals_found_is_not_a_non_negative_integer",
    };
  }
  if (
    !parsed.signals.every((signal) =>
      signal !== null && typeof signal === "object" && !Array.isArray(signal)
    )
  ) {
    return { ok: false, error: "signal_is_not_an_object" };
  }
  if (parsed.signals_found !== parsed.signals.length) {
    return { ok: false, error: "signals_found_does_not_match_signals" };
  }
  if (parsed.articles_analyzed === 0 && parsed.signals_found > 0) {
    return { ok: false, error: "signals_found_without_analyzed_article" };
  }
  if (
    expectedArticlesAnalyzed !== undefined &&
    parsed.articles_analyzed !== expectedArticlesAnalyzed
  ) {
    return { ok: false, error: "articles_analyzed_does_not_match_batch" };
  }
  return { ok: true, signals: parsed.signals as PressAnalysisSignal[] };
}

export function processedArticleIdsAfterWrites(
  articleIds: string[],
  articleIdsWithWriteFailure: Set<string>,
  parseSucceeded: boolean,
): string[] {
  return partitionPressClaimOutcome(
    articleIds,
    articleIdsWithWriteFailure,
    parseSucceeded,
  ).completeIds;
}

export function partitionPressClaimOutcome(
  articleIds: string[],
  articleIdsWithWriteFailure: Set<string>,
  parseSucceeded: boolean,
): { completeIds: string[]; retryIds: string[] } {
  if (!parseSucceeded) {
    return { completeIds: [], retryIds: [...articleIds] };
  }

  return articleIds.reduce(
    (outcome, id) => {
      if (articleIdsWithWriteFailure.has(id)) outcome.retryIds.push(id);
      else outcome.completeIds.push(id);
      return outcome;
    },
    { completeIds: [] as string[], retryIds: [] as string[] },
  );
}
