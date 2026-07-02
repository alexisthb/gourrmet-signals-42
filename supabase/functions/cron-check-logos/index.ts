// cron-check-logos — poller backend des logos Manus en cours.
//
// PROBLÈME RACINE corrigé : check-logo-manus-status n'était appelé QUE par le
// frontend (useLogoManusPolling, toutes les 10s) tant qu'un user gardait la fiche
// signal ouverte. cron-check-manus ne traite QUE les contacts. Résultat : un logo
// dont la tâche Manus se termine alors que personne ne regarde la fiche reste
// bloqué avec logo_manus_task_id NOT NULL et company_logo_url NULL ad vitam.
//
// Ce cron (toutes les 2 minutes) :
//   0. GIVE-UP par âge : libère les tâches logo Manus > 6h (logo_manus_started_at) —
//      sans ça, une tâche morte (erreur API non-404, statut Manus inconnu) gardait son
//      task_id À VIE : signal exclu du batch auto gratuit ET re-pollé indéfiniment.
//   1. trouve tous les signaux avec logo_manus_task_id NOT NULL
//   2. appelle check-logo-manus-status pour chacun (qui persiste le logo et nettoie
//      le task_id en succès comme en échec — donc auto-déblocage des orphelins).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH = 25;        // max de logos pollés par tick
const CONCURRENCY = 3;   // douceur sur l'API Manus

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 0. Give-up des tâches logo fantômes (> 6h sans aboutir) : on libère le task_id
    // pour que le signal redevienne éligible au batch gratuit, et on marque l'état.
    const STALE_CUTOFF = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: staleRows, error: staleError } = await supabase
      .from("signals")
      .update({ logo_manus_task_id: null, logo_manus_started_at: null, logo_fetch_status: "manus_timeout" })
      .not("logo_manus_task_id", "is", null)
      .lt("logo_manus_started_at", STALE_CUTOFF)
      .select("id");
    if (staleError) console.error("[cron-check-logos] stale cleanup failed:", staleError.message);
    else if (staleRows && staleRows.length > 0) console.log(`[cron-check-logos] give-up: ${staleRows.length} tâche(s) logo > 6h libérée(s)`);

    const { data: rows, error } = await supabase
      .from("signals")
      .select("id")
      .not("logo_manus_task_id", "is", null)
      .limit(BATCH);

    if (error) throw new Error(`select logos in progress: ${error.message}`);

    const batch = rows || [];
    let checked = 0;
    let errors = 0;

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map((r: any) =>
          fetch(`${SUPABASE_URL}/functions/v1/check-logo-manus-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ signalId: r.id }),
          }),
        ),
      );
      for (const res of results) {
        if (res.status === "fulfilled" && res.value.ok) checked++;
        else errors++;
      }
    }

    return new Response(JSON.stringify({ in_progress: batch.length, checked, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[cron-check-logos] Error:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
