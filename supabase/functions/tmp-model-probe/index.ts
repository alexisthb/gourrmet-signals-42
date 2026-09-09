// Sonde temporaire : valide l'identifiant de modèle auprès du Lovable AI Gateway.
Deno.serve(async () => {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return new Response("no key", { status: 500 });
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3.8-flash",
      messages: [{ role: "user", content: "Réponds uniquement: OK" }],
    }),
  });
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text.slice(0, 400) }), {
    headers: { "Content-Type": "application/json" },
  });
});
