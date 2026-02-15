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

async function tryFetchLogo(url: string): Promise<ArrayBuffer | null> {
  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      await resp.text();
      return null;
    }
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { signalId, companyName } = await req.json();

    if (!signalId) {
      return new Response(JSON.stringify({ error: "signalId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Priority 1: Get domain from company_enrichment (most reliable)
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

    // Priority 2: Guess from company name (normalize accents first)
    if (!domain && companyName) {
      const cleaned = companyName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip accents
        .toLowerCase()
        .replace(/\s*\(.*?\)\s*/g, '') // remove parenthetical like (ex-Affluent Medical)
        .replace(/[^a-z0-9\s-]/g, '') // keep letters, digits, spaces, hyphens
        .trim()
        .split(/[\s-]+/)[0]; // take first word as base domain guess
      
      // Try full name without spaces too
      const fullCleaned = companyName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
      
      domain = `${fullCleaned}.com`;
    }

    if (!domain) {
      return new Response(JSON.stringify({ error: "Could not determine domain" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build candidate domains to try
    const candidateDomains: string[] = [domain];
    if (!domain.endsWith('.fr')) {
      candidateDomains.push(domain.replace(/\.\w+$/, '.fr'));
    }
    // Also try hyphenated version for multi-word names (e.g., credit-agricole.com)
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

    console.log(`Trying domains: ${candidateDomains.join(', ')}`);

    let logoData: ArrayBuffer | null = null;
    let logoSource = '';
    let usedDomain = domain;

    for (const d of candidateDomains) {
      if (logoData) break;
      logoData = await tryFetchLogo(`https://logo.clearbit.com/${d}`);
      if (logoData) { logoSource = 'clearbit'; usedDomain = d; break; }
      logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${d}&sz=128`);
      if (logoData) { logoSource = 'google_favicon'; usedDomain = d; break; }
    }

    if (!logoData) {
      return new Response(JSON.stringify({ error: "No logo found", domains: candidateDomains }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload to storage bucket
    const fileName = `${signalId}_${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(fileName, logoData, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('company-logos')
      .getPublicUrl(fileName);

    const logoUrl = publicUrlData.publicUrl;

    // Update signal with logo URL
    const { error: updateError } = await supabase
      .from('signals')
      .update({ company_logo_url: logoUrl })
      .eq('id', signalId);

    if (updateError) {
      console.error("Signal update error:", updateError);
    }

    console.log(`Logo fetched from ${logoSource} and stored: ${logoUrl}`);

    return new Response(
      JSON.stringify({ logoUrl, source: logoSource, domain: usedDomain }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching logo:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
