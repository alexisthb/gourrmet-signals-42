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

async function fetchAndStoreLogo(
  supabase: any,
  signalId: string,
  companyName: string
): Promise<{ domain: string; source: string; logoUrl: string } | null> {
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

  for (const d of candidateDomains) {
    logoData = await tryFetchLogo(`https://logo.clearbit.com/${d}`, 500);
    if (logoData) { logoSource = 'clearbit'; usedDomain = d; break; }
  }
  if (!logoData) {
    for (const d of candidateDomains) {
      logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${d}&sz=256`, 500);
      if (logoData) { logoSource = 'google_favicon'; usedDomain = d; break; }
    }
  }

  if (!logoData) return null;

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
    const { signalId, companyName, batch } = body;

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
          results.push({ id: signal.id, company: signal.company_name, status: r ? 'ok' : 'not_found', domain: r?.domain });
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

    const result = await fetchAndStoreLogo(supabase, signalId, companyName);
    if (!result) {
      return new Response(JSON.stringify({ error: "No logo found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
