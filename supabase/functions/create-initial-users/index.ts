import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-setup-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SÉCURITÉ : secret de setup obligatoire + mot de passe depuis l'env
    // (plus aucun mot de passe en dur dans le repo).
    const setupSecret = Deno.env.get("SETUP_SECRET");
    if (!setupSecret || req.headers.get("x-setup-secret") !== setupSecret) {
      return new Response(JSON.stringify({ error: "Forbidden: invalid or missing setup secret" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const defaultPassword = Deno.env.get("SETUP_DEFAULT_PASSWORD");
    if (!defaultPassword) {
      return new Response(JSON.stringify({ error: "SETUP_DEFAULT_PASSWORD not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const users = [
      { email: "alexis@gourrmet.fr", password: defaultPassword, role: "super_admin" },
      { email: "patrick@gourrmet.fr", password: defaultPassword, role: "user" },
      { email: "salome@gourrmet.fr", password: defaultPassword, role: "user" },
    ];

    const results = [];

    for (const user of users) {
      // Check if user already exists
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === user.email);
      
      if (existingUser) {
        // Update role if user exists
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: existingUser.id, role: user.role }, { onConflict: "user_id" });
        
        results.push({ email: user.email, status: "exists", role: user.role });
        continue;
      }

      // Create user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      });

      if (createError) {
        results.push({ email: user.email, status: "error", error: createError.message });
        continue;
      }

      // Update role (trigger creates 'user' by default, we need to update for super_admin)
      if (user.role !== "user" && newUser?.user) {
        await supabaseAdmin
          .from("user_roles")
          .update({ role: user.role })
          .eq("user_id", newUser.user.id);
      }

      results.push({ email: user.email, status: "created", role: user.role });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
