// cron-check-logos — poller backend des logos Manus en cours.
//
// PROBLÈME RACINE corrigé : check-logo-manus-status n'était appelé QUE par le
// frontend (useLogoManusPolling, toutes les 10s) tant qu'un user gardait la fiche
// signal ouverte. cron-check-manus ne traite QUE les contacts. Résultat : un logo
// dont la tâche Manus se termine alors que personne ne regarde la fiche reste
// bloqué avec logo_manus_task_id NOT NULL et company_logo_url NULL ad vitam.
//
// Ce cron (toutes les 2 minutes) :
//   1. trouve tous les signaux avec logo_manus_task_id NOT NULL
//   2. appelle check-logo-manus-status pour chacun (qui persiste le logo et nettoie
//      le task_id en succès comme en échec — donc auto-déblocage des orphelins).
// NB : la table signals n'a pas de colonne updated_at, donc pas de cleanup par âge ;
//      le nettoyage des task_id terminés est porté par check-logo-manus-status.

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
