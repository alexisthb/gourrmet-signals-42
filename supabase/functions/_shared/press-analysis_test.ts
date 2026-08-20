import {
  buildPressGeographyInstruction,
  findOverlappingPressDispatch,
  initialPressProviderUsage,
  parsePressAnalysisResponse,
  partitionPressClaimOutcome,
  processedArticleIdsAfterWrites,
  summarizePressBacklog,
} from "./press-analysis.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(message ?? `Expected ${right}, received ${left}`);
  }
}

Deno.test("une reponse IA non parsable est un echec relancable", () => {
  const result = parsePressAnalysisResponse("pas du json");
  assertEquals(result.ok, false);
});

Deno.test("le parseur recupere un objet JSON entoure de markdown", () => {
  const result = parsePressAnalysisResponse(
    '```json\n{"signals":[],"articles_analyzed":12,"signals_found":0}\n```',
    12,
  );
  assertEquals(result, { ok: true, signals: [] });
});

Deno.test("le parseur refuse un contrat Presse incomplet", () => {
  assertEquals(
    parsePressAnalysisResponse('{"signals":[]}'),
    { ok: false, error: "articles_analyzed_is_not_a_non_negative_integer" },
  );
  assertEquals(
    parsePressAnalysisResponse(
      '{"signals":[],"articles_analyzed":1}',
    ),
    { ok: false, error: "signals_found_is_not_a_non_negative_integer" },
  );
});

Deno.test("le parseur exige des compteurs entiers et coherents", () => {
  assertEquals(
    parsePressAnalysisResponse(
      '{"signals":[],"articles_analyzed":1.5,"signals_found":0}',
    ),
    { ok: false, error: "articles_analyzed_is_not_a_non_negative_integer" },
  );
  assertEquals(
    parsePressAnalysisResponse(
      '{"signals":[{"company_name":"Acme"}],"articles_analyzed":1,"signals_found":0}',
    ),
    { ok: false, error: "signals_found_does_not_match_signals" },
  );
  assertEquals(
    parsePressAnalysisResponse(
      '{"signals":[{"company_name":"Acme"}],"articles_analyzed":0,"signals_found":1}',
    ),
    { ok: false, error: "signals_found_without_analyzed_article" },
  );
});

Deno.test("le parseur refuse un compteur d articles different du batch", () => {
  assertEquals(
    parsePressAnalysisResponse(
      '{"signals":[],"articles_analyzed":11,"signals_found":0}',
      12,
    ),
    { ok: false, error: "articles_analyzed_does_not_match_batch" },
  );
});

Deno.test("les appels IA Presse ne sont valorises qu apres les tokens reels", () => {
  assertEquals(initialPressProviderUsage("lovable_ai"), {
    units: 0,
    unitName: "tokens_pending",
  });
  assertEquals(initialPressProviderUsage("perplexity"), {
    units: 0,
    unitName: "tokens_pending",
  });
});

Deno.test("un dispatch ambigu bloque le meme article meme dans un autre run", () => {
  const rows = [
    { id: "other", metadata: { article_ids: ["article-9"] } },
    { id: "same", metadata: { article_id: "article-2" } },
  ];
  assertEquals(
    findOverlappingPressDispatch(rows, ["article-1", "article-2"])?.id,
    "same",
  );
  assertEquals(findOverlappingPressDispatch(rows, ["article-3"]), null);
});

Deno.test("aucun article lie a une ecriture echouee ne devient processed", () => {
  assertEquals(
    processedArticleIdsAfterWrites(
      ["article-1", "article-2", "article-3"],
      new Set(["article-2"]),
      true,
    ),
    ["article-1", "article-3"],
  );
  assertEquals(
    processedArticleIdsAfterWrites(["article-1"], new Set(), false),
    [],
  );
});

Deno.test("le claim se partage entre complete et retry sans chevauchement", () => {
  assertEquals(
    partitionPressClaimOutcome(
      ["article-1", "article-2", "article-3"],
      new Set(["article-2"]),
      true,
    ),
    {
      completeIds: ["article-1", "article-3"],
      retryIds: ["article-2"],
    },
  );
  assertEquals(
    partitionPressClaimOutcome(
      ["article-1", "article-2"],
      new Set(),
      false,
    ),
    {
      completeIds: [],
      retryIds: ["article-1", "article-2"],
    },
  );
});

Deno.test("la Presse couvre toute la France et garde Bordeaux analysable", () => {
  const instruction = buildPressGeographyInstruction([
    { name: "Île-de-France", regions: ["Île-de-France"], cities: ["Paris"] },
  ]);

  if (!instruction.includes("France entière")) {
    throw new Error(
      "La couverture nationale doit être explicite dans le prompt",
    );
  }
  if (
    !instruction.includes("Bordeaux") ||
    !instruction.includes("ne jamais exclure")
  ) {
    throw new Error(
      "Une société française hors des anciennes zones doit rester analysable",
    );
  }
});

Deno.test("un backoff Presse reste un backlog et jamais un faux succes vide", () => {
  assertEquals(
    summarizePressBacklog({
      ready: 0,
      in_flight: 0,
      retry_waiting: 2,
      dead_lettered: 1,
      exhausted_orphan: 0,
      next_retry_at: "2026-08-20T12:00:00.000Z",
    }),
    {
      hasOutstanding: true,
      outstanding: 3,
      retryable: 2,
      ready: 0,
      inFlight: 0,
      retryWaiting: 2,
      deadLettered: 1,
      exhausted: 0,
      nextRetryAt: "2026-08-20T12:00:00.000Z",
    },
  );
  assertEquals(summarizePressBacklog({}).hasOutstanding, false);
});
