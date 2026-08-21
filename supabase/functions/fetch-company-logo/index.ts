import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firstUsableDomain } from "../_shared/company-website.ts";

async function tryFetchLogo(url: string, minBytes = 1000): Promise<ArrayBuffer | null> {
  try {
    // Timeout dur : un domaine deviné qui ne répond pas gelait le tick batch entier
    // (fetch sans AbortSignal) — et le tick suivant resélectionnait les mêmes signaux.
    const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      await resp.text();
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < minBytes) return null;
    return buf;
  } catch {
    return null;
  }
}


// Clean up old generated gifts when logo changes
async function cleanupOldGifts(supabase: any, signalId: string) {
  try {
    const { data: oldGifts } = await supabase
      .from('generated_gifts')
      .select('id, generated_image_url')
      .eq('signal_id', signalId);

    if (oldGifts && oldGifts.length > 0) {
      // Delete storage files
      const filesToDelete = oldGifts
        .filter((g: any) => g.generated_image_url)
        .map((g: any) => {
          const url = g.generated_image_url as string;
          const parts = url.split('/generated-gifts/');
          return parts.length > 1 ? parts[1] : null;
        })
        .filter(Boolean);

      if (filesToDelete.length > 0) {
        await supabase.storage.from('generated-gifts').remove(filesToDelete);
        console.log(`[Cleanup] Deleted ${filesToDelete.length} old gift images from storage`);
      }

      // Delete DB records
      await supabase.from('generated_gifts').delete().eq('signal_id', signalId);
      console.log(`[Cleanup] Deleted ${oldGifts.length} old gift records`);
    }
  } catch (e) {
    console.error('[Cleanup] Error cleaning old gifts:', e);
  }
}

async function fetchAndStoreLogo(
  supabase: any,
  signalId: string,
  companyName: string,
  forceRetry = false,
  manualDomain: string | null = null,
): Promise<{ domain: string; source: string; logoUrl: string } | null> {
  // Priority 0: Manual domain override
  if (manualDomain) {
    const cleanManual = manualDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    console.log(`[${companyName}] Manual domain: ${cleanManual}`);
    
    let logoData = await tryFetchLogo(`https://logo.clearbit.com/${cleanManual}`, 500);
    let logoSource = 'manual_clearbit';
    if (!logoData) {
      logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${cleanManual}&sz=256`, 500);
      logoSource = 'manual_google_favicon';
    }
    if (logoData) {
      await cleanupOldGifts(supabase, signalId);
      const fileName = `${signalId}_${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(fileName, logoData, { contentType: 'image/png', upsert: true });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      const { data: publicUrlData } = supabase.storage.from('company-logos').getPublicUrl(fileName);
      const logoUrl = publicUrlData.publicUrl;
      await supabase.from('signals').update({ company_logo_url: logoUrl }).eq('id', signalId);
      await supabase.from('company_enrichment').upsert({
        signal_id: signalId, company_name: companyName, domain: cleanManual,
        website: `https://${cleanManual}`, enrichment_source: 'manual', status: 'completed',
      }, { onConflict: 'signal_id' });
      console.log(`[${companyName}] ✓ manual via ${cleanManual}`);
      return { domain: cleanManual, source: logoSource, logoUrl };
    }
    return null;
  }



  // Priority 1: Get domain from company_enrichment
  let domain: string | null = null;
  const { data: enrichment } = await supabase
    .from('company_enrichment')
    .select('website, domain, raw_data')
    .eq('signal_id', signalId)
    .maybeSingle();

  // PRIORITÉ 0 — le logo de la page LinkedIn de l'entreprise.
  //
  // Tout ce qui suit cherche des FAVICONS : Clearbit (en fin de vie annoncée),
  // icônes DuckDuckGo, /favicon.ico du site, favicons Google. Une icône de 16 à
  // 64 pixels conçue pour un onglet de navigateur — puis gravée sur un visuel
  // cadeau. Et faute de site connu, le domaine est DEVINÉ depuis le nom légal :
  // « BPREX HEALTHCARE OFFRANVILLE » donne `bprexhealthcareoffranville.com`.
  //
  // La résolution de société, elle, rend la page LinkedIn de l'entreprise, qui
  // porte un vrai logo carré. On la paie déjà à chaque enrichissement ; on n'en
  // gardait que le nom et l'URL. Ce logo-là passe donc devant, et il n'est
  // retenu que sur une résolution CERTAINE — apposer celui d'une homonyme
  // serait pire que pas de logo du tout.
  const resolutionLogo = enrichment?.raw_data?.company_resolution?.logoUrl;
  if (typeof resolutionLogo === 'string' && resolutionLogo.startsWith('http')) {
    const linkedinLogo = await tryFetchLogo(resolutionLogo, 500);
    if (linkedinLogo) {
      const fileName = `${signalId}_${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from('company-logos')
        .upload(fileName, linkedinLogo, { contentType: 'image/png', upsert: true });
      if (!upErr) {
        const { data: pub } = supabase.storage.from('company-logos').getPublicUrl(fileName);
        await cleanupOldGifts(supabase, signalId);
        await supabase.from('signals')
          .update({ company_logo_url: pub.publicUrl, logo_fetch_status: 'ok' })
          .eq('id', signalId);
        console.log(`[${companyName}] logo LinkedIn (page societe) retenu`);
        return { logoUrl: pub.publicUrl, domain: 'linkedin', source: 'linkedin_company' };
      }
      console.error(`[${companyName}] upload logo LinkedIn echoue:`, upErr.message);
    }
  }

  // `domain` comme `website` peuvent porter plusieurs adresses concaténées :
  // les deux passent par le même extracteur, testé sur des chaînes réelles.
  domain = firstUsableDomain(enrichment?.domain) ?? firstUsableDomain(enrichment?.website);

  // Priority 2: Guess from company name.
  // On retire d'abord les formes juridiques et mots parasites : \u00ab DUPONT SAS \u00bb devinait
  // dupontsas.com (toujours faux) au lieu de dupont.com \u2014 fatal pour les d\u00e9nominations
  // l\u00e9gales Pappers qui portent quasi syst\u00e9matiquement la forme juridique.
  const LEGAL_FORMS_RE = /\b(sasu|sas|sarl|eurl|sa|sci|scop|scp|snc|selarl|selas|gie|groupe|group|holding|compagnie|cie|ets|etablissements?|societe|ste)\b/gi;
  if (!domain && companyName) {
    const fullCleaned = companyName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(LEGAL_FORMS_RE, ' ')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (fullCleaned) domain = `${fullCleaned}.com`;
  }

  if (!domain) return null;

  // Build candidate domains
  const candidateDomains: string[] = [domain];
  if (!domain.endsWith('.fr')) {
    candidateDomains.push(domain.replace(/\.\w+$/, '.fr'));
  }
  const strippedDomain = domain.replace(/-(group|groupe|france|international|europe|global)\./i, '.');
  if (strippedDomain !== domain && !candidateDomains.includes(strippedDomain)) {
    candidateDomains.push(strippedDomain);
    if (!strippedDomain.endsWith('.fr')) {
      candidateDomains.push(strippedDomain.replace(/\.\w+$/, '.fr'));
    }
  }
  if (companyName && !enrichment?.domain && !enrichment?.website) {
    const hyphenated = companyName
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, '')
      .replace(LEGAL_FORMS_RE, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (hyphenated && hyphenated !== domain.replace(/\.\w+$/, '')) {
      candidateDomains.push(`${hyphenated}.com`, `${hyphenated}.fr`);
    }
  }

  console.log(`[${companyName}] Trying: ${candidateDomains.join(', ')}`);

  let logoData: ArrayBuffer | null = null;
  let logoSource = '';
  let usedDomain = domain;

  // Try Clearbit — ATTENTION : l'API gratuite logo.clearbit.com est en sunset (annoncé
  // pour déc. 2025 par HubSpot). On la tente encore (coût nul), mais elle n'est plus la
  // source principale : DuckDuckGo et le favicon du site prennent le relais ci-dessous.
  for (const d of candidateDomains) {
    logoData = await tryFetchLogo(`https://logo.clearbit.com/${d}`, 500);
    if (logoData) { logoSource = 'clearbit'; usedDomain = d; break; }
  }

  // DuckDuckGo icons (gratuit, vivant) — meilleure couverture PME françaises que Clearbit.
  if (!logoData) {
    for (const d of candidateDomains) {
      logoData = await tryFetchLogo(`https://icons.duckduckgo.com/ip3/${d}.ico`, 500);
      if (logoData) { logoSource = 'duckduckgo'; usedDomain = d; break; }
    }
  }

  // Favicon/apple-touch-icon directement sur le site (gratuit).
  if (!logoData) {
    for (const d of candidateDomains) {
      logoData = await tryFetchLogo(`https://${d}/apple-touch-icon.png`, 500)
        || await tryFetchLogo(`https://${d}/favicon.ico`, 500);
      if (logoData) { logoSource = 'site_favicon'; usedDomain = d; break; }
    }
  }


  // Google Favicon en dernier recours (gratuit) — tenté que Manus ait été lancé ou non.
  // Seuil relevé 100 -> 600 octets : à 100, l'icône « globe » par défaut de Google
  // (renvoyée pour un domaine deviné inexistant) passait et on stockait un FAUX logo
  // qui finissait sur le visuel cadeau.
  if (!logoData) {
    for (const d of candidateDomains) {
      logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${d}&sz=256`, 600);
      if (logoData) { logoSource = 'google_favicon'; usedDomain = d; break; }
    }
  }

  if (!logoData) return null;

  await cleanupOldGifts(supabase, signalId);
  const fileName = `${signalId}_${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from('company-logos')
    .upload(fileName, logoData, { contentType: 'image/png', upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: publicUrlData } = supabase.storage
    .from('company-logos')
    .getPublicUrl(fileName);

  const logoUrl = publicUrlData.publicUrl;

  await supabase
    .from('signals')
    .update({ company_logo_url: logoUrl })
    .eq('id', signalId);

  console.log(`[${companyName}] ✓ ${logoSource} via ${usedDomain}`);
  return { domain: usedDomain, source: logoSource, logoUrl };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  try {
    const body = await req.json();
    const { signalId, companyName, batch, forceRetry, manualDomain } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // BATCH MODE
    // Anti-FAMINE (audit) : avant, sélection sans ORDER BY ni mémoire de tentative —
    // un échec gratuit n'écrivait rien en base, donc les 10 mêmes signaux « introuvables »
    // monopolisaient chaque tick et les nouveaux signaux n'étaient JAMAIS traités.
    // Désormais : plafond de tentatives + backoff 2h + priorité aux jamais-tentés
    // (puis aux plus récents) + persistance du résultat de chaque tentative.
    if (batch) {
      const limit = body.limit || 15;
      const minScore = body.minScore ?? 0;            // filtre métier : ne logoter que les signaux forts
      const MAX_ATTEMPTS = 5;                          // au-delà : 'exhausted', visible côté admin
      const BACKOFF_MS = 2 * 60 * 60 * 1000;           // 2h entre deux tentatives sur le même signal

      // La sélection est déléguée à `select_logo_candidates` (migration
      // 20260821170000) : PostgREST ne savait pas exprimer la condition de
      // reprise, qui exige de comparer `logo_last_attempt_at` à la fraîcheur de
      // `company_enrichment`. Sans elle, un signal ayant épuisé ses tentatives
      // AVANT que l'enrichissement ne trouve son site restait condamné, alors
      // même que son logo était devenu trouvable — 278 prospects de score >= 4
      // dans ce cas en production le 2026-08-21.
      const { data: signals, error: selectError } = await supabase.rpc(
        'select_logo_candidates',
        {
          p_limit: limit,
          p_min_score: minScore,
          p_max_attempts: MAX_ATTEMPTS,
          p_backoff_hours: Math.max(1, Math.round(BACKOFF_MS / 3_600_000)),
        },
      );

      if (selectError) {
        // Avant : erreur avalée -> réponse mensongère « All signals have logos ».
        console.error('[Batch] SELECT failed:', selectError);
        return new Response(JSON.stringify({ error: `Batch select failed: ${selectError.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!signals || signals.length === 0) {
        return new Response(JSON.stringify({ message: "No eligible signals (done, in-flight, backoff or attempts exhausted)", processed: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // La raison de sélection est journalisée : elle distingue une reprise
      // (`piste_fraiche_apres_epuisement`) d'un traitement normal, ce qui rend
      // l'effet du correctif observable sans requête supplémentaire.
      const reprises = signals.filter(
        (s: { selection_reason?: string }) =>
          s.selection_reason === 'piste_fraiche_apres_epuisement',
      ).length;
      console.log(
        `Batch: processing ${signals.length} signals` +
          (reprises > 0 ? ` (dont ${reprises} reprise(s) sur piste fraîche)` : ''),
      );
      const results: { id: string; company: string; status: string; domain?: string }[] = [];
      const BUDGET_MS = 45_000;                        // marge sous le timeout 55s du cron
      const batchStartedAt = Date.now();
      let truncated = false;

      for (const signal of signals) {
        if (Date.now() - batchStartedAt > BUDGET_MS) { truncated = true; break; }
        let status = 'not_found';
        let domain: string | undefined;
        try {
          const r = await fetchAndStoreLogo(supabase, signal.id, signal.company_name, false, null);
          if (r) { status = 'ok'; domain = r.domain; }
        } catch (e) {
          console.error(`[${signal.company_name}] Error:`, e);
          status = 'error';
        }
        results.push({ id: signal.id, company: signal.company_name, status, domain });

        // Mémoire de tentative : c'est elle qui casse la famine. En cas d'échec le
        // signal recule dans la file (backoff) au lieu de la boucher.
        const attempts = (signal.logo_fetch_attempts ?? 0) + 1;
        const { error: trackError } = await supabase
          .from('signals')
          .update({
            logo_fetch_attempts: attempts,
            logo_last_attempt_at: new Date().toISOString(),
            logo_fetch_status: status === 'not_found' && attempts >= MAX_ATTEMPTS ? 'exhausted' : status,
          })
          .eq('id', signal.id);
        if (trackError) console.error(`[${signal.company_name}] attempt tracking failed:`, trackError);

        await new Promise(r => setTimeout(r, 200));
      }

      const succeeded = results.filter(r => r.status === 'ok').length;
      return new Response(JSON.stringify({ processed: results.length, succeeded, failed: results.length - succeeded, truncated, details: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SINGLE MODE
    if (!signalId) {
      return new Response(JSON.stringify({ error: "signalId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await fetchAndStoreLogo(supabase, signalId, companyName, forceRetry, manualDomain);

    if (!result) {
      // Retour 200 : supabase.functions.invoke traite tout non-2xx comme FunctionsHttpError
      // et masque le body -> le front voyait un écran blanc.
      return new Response(JSON.stringify({ found: false, message: "Aucun logo trouvé automatiquement." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
