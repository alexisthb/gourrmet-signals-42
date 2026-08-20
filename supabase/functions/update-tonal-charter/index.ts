import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  assertLovableAILedgerReady,
  callMeteredLovableAI,
  lovableAICohortKey,
  markLovableAIAttemptFailed,
} from "../_shared/lovable-ai-usage.ts";

const AI_MODEL = "google/gemini-3.1-pro-preview";
const MAX_FEEDBACKS_PER_ANALYSIS = 200;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, {
    responseHeaders: corsHeaders,
  });
  if (!access.ok) return access.response;

  const requestBody = req.method === "POST"
    ? await req.json().catch(() => ({})) as Record<string, unknown>
    : {};
  const manualGenerationId = typeof requestBody.manual_generation_id === "string" &&
      requestBody.manual_generation_id.length >= 16 &&
      requestBody.manual_generation_id.length <= 100
    ? requestBody.manual_generation_id
    : null;

  try {
    // Validate authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized - Missing or invalid authorization header",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user's auth token for validation
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth
      .getClaims(token);

    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Authenticated user request (update-tonal-charter)");

    // Create service client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Lovable AI Gateway (Gemini 3.1)
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      throw new Error("LOVABLE_API_KEY is not configured in environment");
    }

    // La charte privilégie explicitement les corrections récentes. Une borne
    // déclarée évite à la fois la troncature PostgREST silencieuse et un prompt
    // qui dépasserait le contexte du modèle.
    const {
      data: recentFeedbacks,
      error: feedbackError,
      count: feedbackCount,
    } = await supabase
      .from("message_feedback")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_FEEDBACKS_PER_ANALYSIS);

    if (feedbackError) throw feedbackError;

    const feedbacks = [...(recentFeedbacks ?? [])].reverse();
    const totalFeedbacks = feedbackCount ?? feedbacks.length;

    if (feedbacks.length === 0) {
      return new Response(
        JSON.stringify({ success: false, reason: "No feedback to analyze" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `Analyzing the ${feedbacks.length} most recent corrections out of ${totalFeedbacks}...`,
    );

    const feedbackIds = feedbacks.map((feedback) => String(feedback.id));
    const cohortKey = await lovableAICohortKey("tonal_charter", [
      AI_MODEL,
      ...feedbackIds,
      ...(manualGenerationId ? [`manual:${manualGenerationId}`] : []),
    ]);
    const { data: claimedRun, error: claimError } = await supabase.rpc(
      "claim_tonal_charter_analysis",
      {
        p_cohort_key: cohortKey,
        p_model: AI_MODEL,
        p_feedback_ids: feedbackIds,
        p_feedback_available: totalFeedbacks,
        p_lease_seconds: 300,
      },
    );
    if (claimError || !claimedRun || typeof claimedRun !== "object") {
      throw new Error(
        `Impossible de réclamer l'analyse tonale: ${
          claimError?.message || "réponse vide"
        }`,
      );
    }
    const runClaim = claimedRun as Record<string, unknown>;
    const runState = String(runClaim.state || "");
    if (runState === "completed") {
      return new Response(
        JSON.stringify({
          success: true,
          reused: true,
          corrections_analyzed: feedbacks.length,
          corrections_available: totalFeedbacks,
          sampling_method: "latest_first",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (["active", "reconciliation_required", "abandoned"].includes(runState)) {
      return new Response(
        JSON.stringify({
          success: false,
          retryable: false,
          state: runState,
          error: runState === "active"
            ? "Une analyse de cette cohorte est déjà en cours"
            : "Cette cohorte exige une réconciliation manuelle",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const analysisRunId = typeof runClaim.run_id === "string"
      ? runClaim.run_id
      : null;
    const analysisLeaseToken = typeof runClaim.lease_token === "string"
      ? runClaim.lease_token
      : null;
    const analysisAttempt = Number(runClaim.attempt);
    if (
      !analysisRunId || !analysisLeaseToken ||
      !Number.isInteger(analysisAttempt) || analysisAttempt < 1
    ) {
      throw new Error("Claim tonal incomplet");
    }

    // Build the analysis prompt with all corrections
    const correctionsText = feedbacks.map((f, i) => {
      let text = `
=== CORRECTION ${i + 1} (${f.message_type}) ===
Contexte: ${JSON.stringify(f.context)}

MESSAGE ORIGINAL:
${f.original_message}

MESSAGE CORRIGÉ PAR L'UTILISATEUR:
${f.edited_message}
`;
      if (
        f.original_subject && f.edited_subject &&
        f.original_subject !== f.edited_subject
      ) {
        text += `
SUJET ORIGINAL: ${f.original_subject}
SUJET CORRIGÉ: ${f.edited_subject}
`;
      }
      return text;
    }).join("\n\n");

    const systemPrompt =
      `Tu es un expert en analyse linguistique et communication professionnelle.
Ta mission est d'analyser les corrections apportées par un utilisateur à des messages générés automatiquement
pour en déduire sa "charte tonale" personnelle : ses préférences de style, ton, vocabulaire et structure.

Tu dois produire un document JSON structuré qui capture de manière précise et actionnable les préférences détectées.
Plus tu as de corrections à analyser, plus ta synthèse sera précise et la confiance élevée.

IMPORTANT:
- Identifie les PATTERNS RÉCURRENTS (pas les cas isolés)
- Sois SPÉCIFIQUE dans tes observations (avec exemples concrets)
- Calcule un score de confiance basé sur:
  * Nombre de corrections (5-10: faible, 10-30: moyen, 30+: élevé)
  * Cohérence des patterns détectés
  * Diversité des contextes couverts`;

    const userPrompt =
      `Analyse les ${feedbacks.length} corrections les plus récentes parmi ${totalFeedbacks} disponibles et génère une charte tonale JSON:

${correctionsText}

---

Génère UNIQUEMENT un objet JSON valide (sans markdown, sans explication) avec cette structure exacte:
{
  "formality": {
    "level": "formel|semi-formel|informel|très-informel",
    "tutoyment": true/false,
    "observations": ["observation 1 avec exemple", "observation 2 avec exemple"]
  },
  "structure": {
    "max_paragraphs": number,
    "sentence_length": "courte|moyenne|longue",
    "bullet_points": true/false,
    "observations": ["observation avec exemple"]
  },
  "vocabulary": {
    "forbidden_words": ["mot1", "mot2"],
    "preferred_words": ["mot1", "mot2"],
    "forbidden_expressions": ["expression1", "expression2"],
    "preferred_expressions": ["expression1", "expression2"],
    "observations": ["observation avec exemple"]
  },
  "tone": {
    "style": "professionnel|décontracté|espiègle|direct|chaleureux",
    "humor_allowed": true/false,
    "energy_level": "calme|dynamique|enthousiaste",
    "observations": ["observation avec exemple"]
  },
  "signatures": {
    "preferred": ["signature1", "signature2"],
    "avoided": ["signature1", "signature2"]
  },
  "openings": {
    "preferred": ["accroche1", "accroche2"],
    "avoided": ["accroche1", "accroche2"]
  },
  "subjects_email": {
    "max_length": number,
    "style": "descriptif|accrocheur|minimaliste",
    "observations": ["observation"]
  },
  "confidence_score": 0.0-1.0,
  "patterns_detected": number,
  "summary": "Résumé en une phrase du style de l'utilisateur"
}`;

    const failAnalysisRun = async (errorCode: string) => {
      const { data, error } = await supabase.rpc(
        "fail_tonal_charter_analysis",
        {
          p_run_id: analysisRunId,
          p_lease_token: analysisLeaseToken,
          p_error: errorCode,
        },
      );
      if (error || data !== true) {
        throw new Error(
          `Impossible de clôturer l'analyse tonale en échec: ${
            error?.message || "bail perdu"
          }`,
        );
      }
    };

    let providerPayload: Record<string, unknown> | null = null;
    let providerRequestKey = typeof runClaim.provider_request_key === "string"
      ? runClaim.provider_request_key
      : null;
    let providerStatus = 200;

    if (runClaim.should_dispatch === true) {
      await assertLovableAILedgerReady(supabase);
      const aiCall = await callMeteredLovableAI({
        supabase,
        apiKey: lovableApiKey,
        operation: "update_tonal_charter",
        businessKey: cohortKey,
        invocationId: analysisRunId,
        attempt: analysisAttempt,
        model: AI_MODEL,
        itemsCount: feedbacks.length,
        itemBasis: "feedback_corrections_submitted",
        metadata: {
          cohort_key: cohortKey,
          corrections_count: feedbacks.length,
          corrections_available: totalFeedbacks,
          sampling_method: "latest_first",
          sampling_limit: MAX_FEEDBACKS_PER_ANALYSIS,
        },
        onResponseObserved: async (observed) => {
          const { data, error } = await supabase.rpc(
            "cache_tonal_charter_analysis_response",
            {
              p_run_id: analysisRunId,
              p_lease_token: analysisLeaseToken,
              p_provider_request_key:
                `lovable_ai:update_tonal_charter:${analysisRunId}:${analysisAttempt}`,
              p_response_payload: {
                http_status: observed.status,
                payload: observed.payload,
                raw_body: observed.payload
                  ? null
                  : observed.rawBody?.slice(0, 100_000) ?? null,
              },
              p_lease_seconds: 300,
            },
          );
          if (error || data !== true) {
            throw new Error(
              `Réponse tonale observée mais non cachée: ${
                error?.message || "bail perdu"
              }`,
            );
          }
        },
        body: {
          model: AI_MODEL,
          max_tokens: 4000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
      });
      providerRequestKey = aiCall.requestKey;
      providerStatus = aiCall.status;
      providerPayload = aiCall.payload;
      if (!aiCall.ok) {
        console.error("Lovable AI Gateway error:", aiCall.rawBody);
        await failAnalysisRun(`http_${aiCall.status}`);
        throw new Error(`Lovable AI Gateway error: ${aiCall.status}`);
      }
    } else if (runClaim.should_apply === true) {
      const cached = runClaim.response_payload &&
          typeof runClaim.response_payload === "object" &&
          !Array.isArray(runClaim.response_payload)
        ? runClaim.response_payload as Record<string, unknown>
        : null;
      providerStatus = Number(cached?.http_status ?? 0);
      providerPayload = cached?.payload &&
          typeof cached.payload === "object" &&
          !Array.isArray(cached.payload)
        ? cached.payload as Record<string, unknown>
        : null;
      if (providerStatus < 200 || providerStatus >= 300) {
        await failAnalysisRun(`http_${providerStatus || "unknown"}`);
        throw new Error(`Cached Lovable AI error: ${providerStatus}`);
      }
    } else {
      throw new Error(`État tonal non exécutable: ${runState}`);
    }

    if (!providerPayload) {
      await failAnalysisRun("invalid_provider_payload");
      throw new Error("Lovable AI Gateway returned invalid JSON");
    }
    const choices = Array.isArray(providerPayload.choices)
      ? providerPayload.choices
      : [];
    const firstChoice = choices[0] && typeof choices[0] === "object"
      ? choices[0] as Record<string, unknown>
      : null;
    const message =
      firstChoice?.message && typeof firstChoice.message === "object"
        ? firstChoice.message as Record<string, unknown>
        : null;
    const responseText = typeof message?.content === "string"
      ? message.content
      : "";

    if (!responseText) {
      if (providerRequestKey) {
        await markLovableAIAttemptFailed(
          supabase,
          providerRequestKey,
          "empty_response",
        );
      }
      await failAnalysisRun("empty_response");
      throw new Error("Lovable AI Gateway returned an empty response");
    }

    console.log("AI response received, parsing...");

    // Parse the JSON response
    let charterData;
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        charterData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Error parsing charter JSON:", parseError);
      console.log("Raw response:", responseText);
      if (providerRequestKey) {
        await markLovableAIAttemptFailed(
          supabase,
          providerRequestKey,
          "invalid_charter_json",
        );
      }
      await failAnalysisRun("invalid_charter_json");
      throw new Error("Failed to parse charter from AI response");
    }

    // Extract confidence score
    const confidenceScore = Math.min(
      1,
      Math.max(
        0,
        charterData.confidence_score ||
          Math.min(0.95, feedbacks.length * 0.03),
      ),
    ); // Fallback: ~3% per correction, max 95%

    // La charte et l'état terminal du run sont écrits dans la même transaction.
    const { data: completed, error: completeError } = await supabase.rpc(
      "complete_tonal_charter_analysis",
      {
        p_run_id: analysisRunId,
        p_lease_token: analysisLeaseToken,
        p_charter_data: charterData,
        p_feedback_available: totalFeedbacks,
        p_confidence_score: confidenceScore,
      },
    );
    if (completeError || completed !== true) {
      throw new Error(
        `Réponse tonale cachée mais non appliquée: ${
          completeError?.message || "bail perdu"
        }`,
      );
    }

    console.log("Tonal charter updated successfully");
    console.log("Confidence score:", confidenceScore);
    console.log("Summary:", charterData.summary);

    return new Response(
      JSON.stringify({
        success: true,
        corrections_analyzed: feedbacks.length,
        corrections_available: totalFeedbacks,
        sampling_method: "latest_first",
        confidence_score: confidenceScore,
        charter_summary: charterData.summary,
        patterns_detected: charterData.patterns_detected,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in update-tonal-charter:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
