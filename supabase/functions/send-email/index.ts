// DEPRECATED — GR-001 superseded by `send-transactional-email` (Lovable Emails).
// Resend / RESEND_API_KEY n'est plus utilisée dans le code ; le secret est conservé
// pour rollback éventuel mais aucun appel n'est plus effectué.
//
// L'ancien flux Resend complet est commenté ci-dessous pour mémoire.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error:
        "send-email est désactivée. Utilisez 'send-transactional-email' (templateName: 'outreach-message').",
      deprecated: true,
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});

/*
// --- ANCIENNE IMPLÉMENTATION RESEND (désactivée) ---
// const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// ... appel POST https://api.resend.com/emails ...
// Voir l'historique git pour la version complète.
*/
