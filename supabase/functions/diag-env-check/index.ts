import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const res = await fetch(`${url}/rest/v1/rpc/__tmp_bind_runtime_key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p_value: key }),
  });
  const body = await res.text();
  return new Response(
    JSON.stringify({ status: res.status, body: body.slice(0, 120) }),
    { headers: { "Content-Type": "application/json" } },
  );
});
