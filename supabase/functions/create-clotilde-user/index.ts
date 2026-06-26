import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SÉCURITÉ : le mot de passe n'est plus en dur (fuite repo). Il est lu depuis
// l'env SETUP_DEFAULT_PASSWORD, et l'appel est protégé par un secret de setup
// (header x-setup-secret == env SETUP_SECRET). Sans SETUP_SECRET configuré, la
// fonction est désactivée (403).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-setup-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const setupSecret = Deno.env.get("SETUP_SECRET");
    if (!setupSecret || req.headers.get("x-setup-secret") !== setupSecret) {
      return new Response(JSON.stringify({ error: "Forbidden: invalid or missing setup secret" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const password = Deno.env.get("SETUP_DEFAULT_PASSWORD");
    if (!password) {
      return new Response(JSON.stringify({ error: "SETUP_DEFAULT_PASSWORD not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const email = "clotilde.gautier98@gmail.com";
    const role = "super_admin";

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((u) => u.email === email);

    let userId: string;
    let status: string;

    if (existing) {
      userId = existing.id;
      status = "exists";
    } else {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError) throw createError;
      userId = newUser!.user!.id;
      status = "created";
    }

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id" });

    return new Response(JSON.stringify({ success: true, status, email, role }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
