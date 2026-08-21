import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async () => {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Response(JSON.stringify({ len: k.length, prefix: k.slice(0, 3), sha256: hex }), {
    headers: { "Content-Type": "application/json" },
  });
});
