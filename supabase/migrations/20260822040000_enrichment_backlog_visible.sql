-- LA FAMINE SILENCIEUSE.
--
-- Mesuré le 2026-08-22 : 515 signaux de score >= 4 n'ont AUCUN contact, dont
-- 225 n'ont jamais eu le moindre job d'enrichissement. Pas un échec, pas une
-- erreur, pas une ligne de journal — rien ne les a jamais demandés.
--
-- La cause est structurelle : `enqueue-enrichment` n'est invoqué que par une
-- action de l'opératrice dans l'interface. Aucun cron ne balaie le stock. Un
-- signal détecté, évalué, jugé à fort potentiel, mais sur lequel personne n'a
-- cliqué, attend indéfiniment — et rien ne le signale.
--
-- C'est le pire des motifs rencontrés sur ce projet, pire qu'une panne :
-- une panne finit par se voir. Ici, plus aucune tentative n'échoue, donc plus
-- aucun bruit. Le stock paraît simplement « en attente », pour toujours.
--
-- Cette migration fait deux choses, et volontairement pas une troisième.
--
-- ELLE REND VISIBLE — `enrichment_backlog` compte ce qui dort et depuis quand.
--
-- ELLE DONNE UNE VANNE BORNÉE — `drain_enrichment_backlog(limite, motif)`
-- met en file un nombre EXPLICITE de signaux, les meilleurs d'abord, avec un
-- motif consigné.
--
-- ELLE N'OUVRE PAS LA VANNE. Aucun cron n'est créé ici. Vider 225 signaux
-- coûterait environ 65 $ chez Apify et 900 crédits Dropcontact — pour un solde
-- de 451. Une dépense de cet ordre se décide, elle ne se déclenche pas toute
-- seule parce qu'une migration a été appliquée.

CREATE OR REPLACE VIEW public.enrichment_backlog AS
SELECT
  s.id,
  s.company_name,
  s.source_name,
  s.score,
  s.detected_at,
  (now()::date - s.detected_at::date) AS jours_d_attente,
  EXISTS (SELECT 1 FROM public.company_enrichment ce WHERE ce.signal_id = s.id) AS a_une_fiche,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.enrichment_jobs j
      WHERE j.signal_id = s.id AND j.job_type = 'contacts'
    ) THEN 'JAMAIS DEMANDE — aucun job n a jamais existe'
    ELSE 'TENTE SANS RESULTAT — un job a tourne, zero contact'
  END AS situation
FROM public.signals s
WHERE coalesce(s.score, 0) >= 4
  AND s.status NOT IN ('ignored', 'lost')
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id)
  -- Rien en vol : un signal déjà en cours n'est pas en famine.
  AND NOT EXISTS (
    SELECT 1 FROM public.enrichment_jobs j
    WHERE j.signal_id = s.id AND j.job_type = 'contacts'
      AND j.status IN ('pending', 'running')
  )
ORDER BY s.score DESC, s.detected_at DESC;

REVOKE ALL ON public.enrichment_backlog FROM PUBLIC, anon;
GRANT SELECT ON public.enrichment_backlog TO service_role, authenticated;

COMMENT ON VIEW public.enrichment_backlog IS
  'Signaux a fort potentiel sans aucun contact et sans job en cours. La colonne '
  'situation distingue ceux que PERSONNE N A JAMAIS DEMANDES (famine : aucun '
  'echec, donc aucun bruit) de ceux qui ont ete tentes sans resultat. Les deux '
  'ne se soignent pas pareil.';

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.drain_enrichment_backlog(
  p_limit integer,
  p_reason text,
  p_authorized_by text DEFAULT 'operateur'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  s record;
  v_mis_en_file integer := 0;
  v_refuses integer := 0;
  v_resultats jsonb := '[]'::jsonb;
  v_r jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user() THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  -- Un motif écrit, comme pour toute dépense fournisseur refaite sur ce
  -- projet : une facture doit pouvoir s'expliquer des mois plus tard.
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Un motif explicite est requis pour engager une dépense fournisseur'
      USING ERRCODE = '22023';
  END IF;
  -- La borne est OBLIGATOIRE et plafonnée. Sans elle, un appel distrait
  -- viderait le backlog entier et la facture avec.
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Limite hors bornes (1 a 50) : une vanne se dose'
      USING ERRCODE = '22023';
  END IF;

  -- Les meilleurs d'abord : à budget égal, autant enrichir ce qui vaut le plus.
  FOR s IN
    SELECT id, company_name FROM public.enrichment_backlog
    WHERE situation LIKE 'JAMAIS DEMANDE%'
    LIMIT p_limit
  LOOP
    v_r := public.enqueue_enrichment_job_authorized(s.id, 'contacts', 5, 0, false);
    IF v_r->>'state' = 'enqueued' THEN
      v_mis_en_file := v_mis_en_file + 1;
    ELSE
      v_refuses := v_refuses + 1;
    END IF;
    v_resultats := v_resultats || jsonb_build_object(
      'signal', s.company_name, 'etat', v_r->>'state'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'mis_en_file', v_mis_en_file,
    'refuses', v_refuses,
    'motif', btrim(p_reason),
    'autorise_par', p_authorized_by,
    'detail', v_resultats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_enrichment_backlog(integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drain_enrichment_backlog(integer, text, text)
  TO service_role, authenticated;

COMMENT ON FUNCTION public.drain_enrichment_backlog(integer, text, text) IS
  'Met en file un nombre EXPLICITE de signaux en famille, les meilleurs '
  'd abord, avec motif ecrit. Bornee a 50 : une vanne se dose. Aucun cron ne '
  'l appelle — vider le backlog engage une depense fournisseur, donc une '
  'decision humaine.';
