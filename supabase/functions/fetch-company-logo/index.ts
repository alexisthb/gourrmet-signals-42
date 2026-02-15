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
    const { signalId, companyName, sourceUrl } = await req.json();

    if (!signalId) {
      return new Response(JSON.stringify({ error: "signalId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to extract domain from sourceUrl
    let domain = sourceUrl ? extractDomain(sourceUrl) : null;

    // If no domain from sourceUrl, try Google search for the company domain
    if (!domain && companyName) {
      // Use a simplified approach: guess the domain from company name
      const cleaned = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
      domain = `${cleaned}.com`;
    }

    if (!domain) {
      return new Response(JSON.stringify({ error: "Could not determine domain" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Fetching logo for domain: ${domain}`);

    // Try Clearbit Logo API first
    let logoData = await tryFetchLogo(`https://logo.clearbit.com/${domain}`);
    let logoSource = 'clearbit';

    // Fallback: Google Favicon API (128px)
    if (!logoData) {
      logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
      logoSource = 'google_favicon';
    }

    // Fallback: try with .fr domain for French companies
    if (!logoData && !domain.endsWith('.fr')) {
      const frDomain = domain.replace(/\.\w+$/, '.fr');
      logoData = await tryFetchLogo(`https://logo.clearbit.com/${frDomain}`);
      if (logoData) {
        logoSource = 'clearbit_fr';
      } else {
        logoData = await tryFetchLogo(`https://www.google.com/s2/favicons?domain=${frDomain}&sz=128`);
        if (logoData) logoSource = 'google_favicon_fr';
      }
    }

    if (!logoData) {
      return new Response(JSON.stringify({ error: "No logo found", domain }), {
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
      JSON.stringify({ logoUrl, source: logoSource, domain }),
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
