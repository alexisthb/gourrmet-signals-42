import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function tryFetchLogo(url: string, minBytes = 1000): Promise<ArrayBuffer | null> {
  try {
    const resp = await fetch(url, { redirect: 'follow' });
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

// Launch a real Manus AI agent task to find and download the company logo
async function launchManusLogoTask(
  supabase: any,
  signalId: string,
  companyName: string,
  websiteUrl: string | null = null
): Promise<{ status: string; manus_task_id?: string } | null> {
  const manusApiKey = Deno.env.get("MANUS_API_KEY");
  if (!manusApiKey) {
    console.log("[Manus Logo] No MANUS_API_KEY configured, skipping");
    return null;
  }

  // Check Manus credits before launching
  try {
    const { data: planSettings } = await supabase
      .from('manus_plan_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (planSettings) {
      const { data: usage } = await supabase
        .from('manus_credit_usage')
        .select('credits_used')
        .gte('date', planSettings.current_period_start)
        .lte('date', planSettings.current_period_end);

      const totalUsed = (usage || []).reduce((sum: number, u: any) => sum + Number(u.credits_used), 0);
      if (totalUsed >= planSettings.monthly_credits) {
        console.log("[Manus Logo] Monthly credit limit reached");
        return null;
      }
    }
  } catch (e) {
    console.log("[Manus Logo] Could not check credits, proceeding anyway:", e);
  }

  // Build website context for the prompt
  const websiteContext = websiteUrl 
    ? `\n\n## SITE WEB OFFICIEL\nLe site officiel de l'entreprise est : ${websiteUrl}\nTu DOIS récupérer le logo depuis CE site uniquement. Ne cherche pas d'autres entreprises portant le même nom.`
    : '';

  console.log(`[${companyName}] Launching Manus logo search...${websiteUrl ? ` (site: ${websiteUrl})` : ''}`);

  const prompt = `Tu es un expert en recherche de logos d'entreprises.

## MISSION
Trouve le logo officiel de l'entreprise "${companyName}" (entreprise française probablement).
${websiteContext}

## INSTRUCTIONS
1. ${websiteUrl ? `Va sur le site ${websiteUrl}` : `Trouve le site officiel de l'entreprise "${companyName}"`}
2. Télécharge le logo officiel de l'entreprise en haute qualité
3. Le logo doit être au format PNG (PAS de SVG)
4. Résolution minimum : 200x200 pixels
5. Fond transparent si possible
6. C'est le LOGO de l'entreprise, pas un favicon, pas une icône de navigateur
7. Retourne le fichier image en output

## IMPORTANT
- Ne confonds pas avec d'autres entreprises du même nom
${websiteUrl ? `- Le site officiel est ${websiteUrl}, utilise UNIQUEMENT ce site comme référence` : ''}
- Privilégie le logo principal (pas un logo secondaire ou un sous-brand)
- Si l'entreprise a un groupe parent, prends le logo de l'entité exacte demandée
- Retourne UNIQUEMENT le fichier image, pas de texte`;

  try {
    const manusResponse = await fetch("https://api.manus.ai/v1/tasks", {
      method: "POST",
      headers: {
        "API_KEY": manusApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        agentProfile: "manus-1.6",
        taskMode: "agent",
      }),
    });

    if (!manusResponse.ok) {
      const errorText = await manusResponse.text();
      console.error(`[Manus Logo] API error: ${manusResponse.status} - ${errorText}`);
      return null;
    }

    const manusResult = await manusResponse.json();
    const taskId = manusResult.id || manusResult.task_id;

    if (!taskId) {
      console.error("[Manus Logo] No task_id in response");
      return null;
    }

    console.log(`[${companyName}] Manus task created: ${taskId}`);

    // Store task ID on signal
    await supabase
      .from('signals')
      .update({ logo_manus_task_id: taskId })
      .eq('id', signalId);

    // Log credit usage
    await supabase.from('manus_credit_usage').insert({
      credits_used: 1,
      enrichments_count: 1,
      signal_id: signalId,
      details: { type: 'logo_search', company_name: companyName, task_id: taskId },
    });

    return { status: "manus_processing", manus_task_id: taskId };
  } catch (err) {
    console.error(`[Manus Logo] Error:`, err);
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
  forceAI = false,
  manualDomain: string | null = null
): Promise<{ domain: string; source: string; logoUrl: string } | { status: string; manus_task_id: string } | null> {
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

  // If forceAI, skip standard search and go directly to Manus
  if (forceAI) {
    console.log(`[${companyName}] Force AI mode — launching Manus`);
    // Get website from enrichment for context
    const { data: enrichForAI } = await supabase
      .from('company_enrichment')
      .select('website, domain')
      .eq('signal_id', signalId)
      .maybeSingle();
    const aiWebsite = enrichForAI?.website || (enrichForAI?.domain ? `https://${enrichForAI.domain}` : null);
    const manusResult = await launchManusLogoTask(supabase, signalId, companyName, aiWebsite);
    if (manusResult) return manusResult;
    // If Manus unavailable, fall through to standard search
    console.log(`[${companyName}] Manus unavailable, falling back to standard search`);
  }

  // Priority 1: Get domain from company_enrichment
  let domain: string | null = null;
  const { data: enrichment } = await supabase
    .from('company_enrichment')
    .select('website, domain')
    .eq('signal_id', signalId)
    .maybeSingle();

  if (enrichment?.domain) {
    domain = enrichment.domain.replace(/^www\./, '');
  } else if (enrichment?.website) {
    domain = extractDomain(enrichment.website);
  }

  // Priority 2: Guess from company name
  if (!domain && companyName) {
    const fullCleaned = companyName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
    domain = `${fullCleaned}.com`;
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
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (hyphenated !== domain.replace(/\.\w+$/, '')) {
      candidateDomains.push(`${hyphenated}.com`, `${hyphenated}.fr`);
    }
  }

  console.log(`[${companyName}] Trying: ${candidateDomains.join(', ')}`);

  let logoData: ArrayBuffer | null = null;
  let logoSource = '';
  let usedDomain = domain;

  // Try Clearbit
  for (const d of candidateDomains) {
    logoData = await tryFetchLogo(`https://logo.clearbit.com/${d}`, 500);
    if (logoData) { logoSource = 'clearbit'; usedDomain = d; break; }
  }

  // If standard search failed, launch Manus as fallback (async)
  if (!logoData) {
    console.log(`[${companyName}] Standard search failed, launching Manus fallback...`);
    const fallbackWebsite = enrichment?.website || (enrichment?.domain ? `https://${enrichment.domain}` : null);
    const manusResult = await launchManusLogoTask(supabase, signalId, companyName, fallbackWebsite);
    if (manusResult) return manusResult;

    // If Manus also unavailable, try Google Favicon as last resort
    for (const d of candidateDomains) {
      logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${d}&sz=256`, 500);
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

  try {
    const body = await req.json();
    const { signalId, companyName, batch, forceRetry, forceAI, manualDomain } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // BATCH MODE
    if (batch) {
      const limit = body.limit || 15;
      const { data: signals } = await supabase
        .from('signals')
        .select('id, company_name')
        .is('company_logo_url', null)
        .limit(limit);

      if (!signals || signals.length === 0) {
        return new Response(JSON.stringify({ message: "All signals have logos", processed: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`Batch: processing ${signals.length} signals`);
      const results: { id: string; company: string; status: string; domain?: string }[] = [];

      for (const signal of signals) {
        try {
          const r = await fetchAndStoreLogo(supabase, signal.id, signal.company_name);
          if (!r) {
            results.push({ id: signal.id, company: signal.company_name, status: 'not_found' });
          } else if ('manus_task_id' in r) {
            results.push({ id: signal.id, company: signal.company_name, status: 'manus_processing' });
          } else {
            results.push({ id: signal.id, company: signal.company_name, status: 'ok', domain: r.domain });
          }
        } catch (e) {
          console.error(`[${signal.company_name}] Error:`, e);
          results.push({ id: signal.id, company: signal.company_name, status: 'error' });
        }
        await new Promise(r => setTimeout(r, 200));
      }

      const succeeded = results.filter(r => r.status === 'ok').length;
      return new Response(JSON.stringify({ processed: results.length, succeeded, failed: results.length - succeeded, details: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SINGLE MODE
    if (!signalId) {
      return new Response(JSON.stringify({ error: "signalId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await fetchAndStoreLogo(supabase, signalId, companyName, forceRetry, forceAI, manualDomain);
    
    if (!result) {
      return new Response(JSON.stringify({ error: "No logo found", fallback_used: true }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Manus async response
    if ('manus_task_id' in result) {
      return new Response(JSON.stringify(result), {
        status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
