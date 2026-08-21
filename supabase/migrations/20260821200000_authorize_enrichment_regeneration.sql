-- `enqueue_enrichment_job_authorized` refuse tout signal dont l'enrichissement
-- contacts est déjà `completed`, sans exception : c'est le garde-fou
-- anti-double-dépense du lot 1790, et il a raison de bloquer un rejeu
-- automatique.
--
-- Mais le commentaire de 1790 prévoit explicitement une sortie : « nouvelle
-- génération uniquement après terminal connu + ACTION UTILISATEUR + cooldown ».
-- Cette action utilisateur n'était exposée nulle part — ni en base, ni dans
-- l'interface. Résultat : la seule façon de re-enrichir un signal était de
-- maquiller l'état d'un job terminé, c'est-à-dire de mentir au garde-fou.
--
-- Cette fonction est cette sortie, faite proprement : elle exige un motif écrit,
-- le consigne, et ne franchit le garde-fou qu'une fois, de façon tracée.
--
-- Cas d'usage réel (2026-08-21) : les personas de recherche ont été élargis —
-- Presse ne cherchait que 4 fonctions et remontait presque exclusivement des
-- office managers. Les signaux déjà enrichis méritent une seconde passe avec le
-- nouveau ciblage. C'est une décision humaine, pas une reprise automatique.

CREATE TABLE IF NOT EXISTS public.enrichment_regeneration_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  superseded_job_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  authorized_by text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS enrichment_regeneration_signal_idx
  ON public.enrichment_regeneration_authorizations(signal_id, authorized_at DESC);

ALTER TABLE public.enrichment_regeneration_authorizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enrichment_regeneration_service_all
  ON public.enrichment_regeneration_authorizations;
CREATE POLICY enrichment_regeneration_service_all
  ON public.enrichment_regeneration_authorizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.enrichment_regeneration_authorizations FROM PUBLIC, anon;
GRANT ALL ON public.enrichment_regeneration_authorizations TO service_role;
GRANT SELECT ON public.enrichment_regeneration_authorizations TO authenticated;

COMMENT ON TABLE public.enrichment_regeneration_authorizations IS
  'Trace des re-enrichissements decides par un humain sur un signal deja abouti. '
  'Chaque ligne porte son motif : une depense fournisseur refaite doit pouvoir '
  'etre expliquee des mois plus tard.';

CREATE OR REPLACE FUNCTION public.authorize_enrichment_regeneration(
  p_signal_id uuid,
  p_reason text,
  p_authorized_by text DEFAULT 'operateur'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_previous public.enrichment_jobs%ROWTYPE;
  v_auth_id uuid;
  v_result jsonb;
  v_supplantes integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user() THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Un motif explicite est requis pour refaire une dépense fournisseur'
      USING ERRCODE = '22023';
  END IF;

  -- On ne franchit le garde-fou que pour un travail REELLEMENT termine. Un job
  -- en vol reste protege : le rejouer risquerait une double soumission chez le
  -- fournisseur, exactement ce que 1790 empeche.
  SELECT * INTO v_previous
  FROM public.enrichment_jobs
  WHERE signal_id = p_signal_id AND job_type = 'contacts'
    AND status IN ('completed', 'failed')
  ORDER BY coalesce(finished_at, updated_at, queued_at) DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.enrichment_jobs
    WHERE signal_id = p_signal_id AND job_type = 'contacts'
      -- `cancelled` est exclu : une autorisation precedente en a laisse
      -- derriere elle, et un job deja supplante n est evidemment pas en vol.
      AND status NOT IN ('completed', 'failed', 'cancelled')
  ) THEN
    RETURN jsonb_build_object(
      'state', 'refused', 'reason', 'job_en_vol',
      'detail', 'Un enrichissement est en cours sur ce signal : le rejouer risquerait une double soumission fournisseur.'
    );
  END IF;

  INSERT INTO public.enrichment_regeneration_authorizations
    (signal_id, superseded_job_id, reason, authorized_by)
  VALUES (p_signal_id, v_previous.id, btrim(p_reason), p_authorized_by)
  RETURNING id INTO v_auth_id;

  -- TOUS les jobs terminaux du signal sont supplantes, pas seulement le
  -- dernier. Mesure sur JALIOS le 2026-08-21 : ne supplanter que le plus
  -- recent (un `failed`) laissait `enqueue_...` retomber sur un `completed`
  -- plus ancien juste derriere, et refuser en `already_completed`. La porte
  -- s ouvrait sans rien laisser passer.
  --
  -- Le statut retenu est `cancelled` — valeur deja prevue par la contrainte —
  -- et non un statut invente : `enqueue_...` ne reconnait que 'completed' et
  -- 'failed' comme travail anterieur, et bloque tout statut inconnu en
  -- `retry_blocked_uncertain`. Les resultats ne sont pas effaces : le motif et
  -- l autorisation qui les ont supplantes y sont ecrits, et la table
  -- d autorisations en garde la trace complete.
  UPDATE public.enrichment_jobs
  SET status = 'cancelled',
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      poll_token = NULL, poll_expires_at = NULL,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'superseded_at', now(),
        'superseded_by_authorization', v_auth_id,
        'superseded_reason', btrim(p_reason)
      ),
      updated_at = now()
  WHERE signal_id = p_signal_id AND job_type = 'contacts'
    AND status IN ('completed', 'failed');
  GET DIAGNOSTICS v_supplantes = ROW_COUNT;

  -- La fiche repasse en `pending` : c est le seul etat que `enqueue_...`
  -- accepte pour laisser une nouvelle generation partir.
  UPDATE public.company_enrichment
  SET status = 'pending', updated_at = now()
  WHERE signal_id = p_signal_id AND status <> 'pending';

  UPDATE public.enrichment_regeneration_authorizations
  SET consumed_at = now() WHERE id = v_auth_id;

  v_result := public.enqueue_enrichment_job_authorized(p_signal_id, 'contacts', 10, 0, true);
  RETURN jsonb_build_object(
    'state', 'authorized', 'authorization_id', v_auth_id,
    'superseded_job_id', v_previous.id,
    'superseded_count', v_supplantes,
    'enqueue', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_enrichment_regeneration(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_enrichment_regeneration(uuid, text, text)
  TO service_role, authenticated;

COMMENT ON FUNCTION public.authorize_enrichment_regeneration(uuid, text, text) IS
  'Autorise UNE re-execution de l enrichissement contacts sur un signal deja '
  'abouti. Exige un motif ecrit, consigne l autorisation, supplante le job '
  'precedent sans l effacer. Refuse si un job est en vol.';
