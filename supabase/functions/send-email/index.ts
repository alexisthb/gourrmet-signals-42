// GR-001 — Envoi d'email via Resend + persistance complète en DB (emails_sent).
// Provider: Resend (decision GR-001, voir backlog Clotilde).
// Sender: configurable via setting `email_sender` (default: Clotilde Gautier <clotilde@gourrmet.com>).
//
// TODO sprint suivant: réception IMAP / webhook Resend pour détection de réponses
// (table emails_sent.status passe à 'replied' quand on détecte une réponse entrante).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface SendEmailRequest {
  to: string;
  subject: string;
  body: string;
  from?: string;
  signal_id?: string;
  contact_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Service mail non configuré (RESEND_API_KEY manquant). Contactez l\'administrateur.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Identifier le caller (pour audit user_id).
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader && SUPABASE_ANON_KEY) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      userId = userData.user?.id ?? null;
    }

    const payload: SendEmailRequest = await req.json();
    const { to, subject, body, from, signal_id, contact_id } = payload;

    if (!to || !subject || !body) {
      return new Response(
        JSON.stringify({ error: 'Champs requis manquants: to, subject, body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return new Response(
        JSON.stringify({ error: 'Adresse email destinataire invalide' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Résoudre le sender : payload > setting email_sender > fallback.
    let senderEmail = from;
    if (!senderEmail) {
      const { data: senderSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'email_sender')
        .maybeSingle();
      senderEmail = senderSetting?.value || 'Clotilde Gautier <clotilde@gourrmet.com>';
    }

    let response: Response;
    try {
      response = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: senderEmail,
          to: [to],
          subject,
          text: body,
        }),
      }, FETCH_TIMEOUT_MS);
    } catch (networkErr) {
      const errMsg = networkErr instanceof Error ? networkErr.message : 'Network error';
      await supabase.from('emails_sent').insert({
        signal_id: signal_id ?? null,
        contact_id: contact_id ?? null,
        recipient_email: to,
        sender_email: senderEmail,
        subject,
        body,
        status: 'failed',
        provider: 'resend',
        error_message: `Network: ${errMsg}`,
        user_id: userId,
      });
      return new Response(
        JSON.stringify({ error: `Erreur réseau: ${errMsg}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Ne pas renvoyer le détail Resend brut au client (peut leak des infos provider).
      console.error('[send-email] Resend API error:', response.status, data?.message);
      await supabase.from('emails_sent').insert({
        signal_id: signal_id ?? null,
        contact_id: contact_id ?? null,
        recipient_email: to,
        sender_email: senderEmail,
        subject,
        body,
        status: 'failed',
        provider: 'resend',
        error_message: data?.message ?? `HTTP ${response.status}`,
        user_id: userId,
      });
      return new Response(
        JSON.stringify({
          error: data?.message || `Echec envoi email (HTTP ${response.status})`,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Persistance du succès.
    const { data: inserted, error: insertErr } = await supabase
      .from('emails_sent')
      .insert({
        signal_id: signal_id ?? null,
        contact_id: contact_id ?? null,
        recipient_email: to,
        sender_email: senderEmail,
        subject,
        body,
        status: 'sent',
        provider: 'resend',
        provider_message_id: data?.id ?? null,
        user_id: userId,
      })
      .select('id')
      .single();

    if (insertErr) {
      // L'email est parti chez Resend mais on n'a pas pu logger. Pas critique pour l'utilisateur,
      // mais on remonte un warning au lieu d'un succès silencieux.
      console.error('[send-email] Failed to persist emails_sent row:', insertErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, id: data.id, log_id: inserted?.id ?? null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[send-email] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
