-- L'HORIZON COMMERCIAL DES SIGNAUX.
--
-- Décision d'Alexis le 2026-08-22 : « faisons une croix définitive sur les
-- signaux qui ont plus de 60 jours ».
--
-- Le motif est sain. Un signal de veille est un ÉVÉNEMENT daté — une levée de
-- fonds, un anniversaire, une inauguration. L'accroche commerciale qu'il porte
-- se périme avec lui : féliciter une entreprise pour une levée vieille de sept
-- mois n'ouvre pas une conversation, elle la ferme. Mesuré ici : le plus ancien
-- signal encore affiché en « nouveau » datait du 14 janvier, soit 220 jours.
--
-- CE QUE CETTE MIGRATION ARCHIVE, ET CE QU'ELLE REFUSE D'ARCHIVER.
--
-- La lecture littérale — tout signal de plus de 60 jours — touchait 2 141
-- signaux, dont 597 possédaient DÉJÀ des contacts obtenus, dont 546 notés 4 ou
-- 5. Ces coordonnées ont été payées chez Apify et Dropcontact ; les masquer
-- aurait jeté un travail déjà financé et retiré à l'opératrice 546 prospects
-- immédiatement appelables. Périmètre arbitré avec Alexis le 2026-08-22 :
--
--   ON ARCHIVE  les signaux anciens SANS AUCUN CONTACT — 1 544 lignes, poids
--               mort intégral : rien n'a jamais été obtenu sur eux et
--               l'accroche est morte.
--   ON PRÉSERVE tout signal PORTEUR DE CONTACTS, quel que soit son âge. Un
--               prospect joignable reste un prospect joignable.
--   ON NE TOUCHE JAMAIS  aux statuts commerciaux ('contacted', 'lost',
--               'probleme', …) : seuls les signaux restés 'new' sont concernés.
--
-- POURQUOI UNE RÈGLE ET NON UN UPDATE : un nettoyage ponctuel se reproduit
-- identique dans 60 jours. La fonction ci-dessous est rejouable et balayée
-- quotidiennement par un cron, ce qui fait de l'horizon une propriété
-- permanente de la plateforme plutôt qu'un coup de balai daté.

INSERT INTO public.settings (key, value)
VALUES ('signal_expiry_days', '60')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_stale_signals(
  p_horizon_days integer DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_horizon integer;
  v_candidats integer := 0;
  v_archives integer := 0;
  v_preserves integer := 0;
BEGIN
  -- L'horizon vient du réglage, pour rester ajustable sans redéploiement.
  v_horizon := coalesce(
    p_horizon_days,
    nullif(btrim((SELECT value::text FROM public.settings
                   WHERE key = 'signal_expiry_days'), '"'), '')::integer,
    60
  );
  -- Un horizon nul ou négatif archiverait la totalité du stock, silencieusement.
  IF v_horizon < 1 THEN
    RAISE EXCEPTION 'Horizon invalide (% jours) : un horizon se compte en jours pleins', v_horizon
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_candidats
  FROM public.signals s
  WHERE s.status = 'new'
    AND (now()::date - s.detected_at::date) > v_horizon
    AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id);

  -- Ce que la règle épargne délibérément : mesuré et rendu, pour que la
  -- préservation soit visible autant que l'archivage.
  SELECT count(*) INTO v_preserves
  FROM public.signals s
  WHERE s.status = 'new'
    AND (now()::date - s.detected_at::date) > v_horizon
    AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id);

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'simulation', true, 'horizon_jours', v_horizon,
      'archiverait', v_candidats, 'preserverait_car_ont_des_contacts', v_preserves
    );
  END IF;

  WITH expires AS (
    UPDATE public.signals s
    SET status = 'ignored',
        pipeline_status = 'archived',
        pipeline_updated_at = now(),
        -- On AJOUTE au bloc-notes, on ne l'écrase pas : il peut porter des
        -- observations de l'opératrice.
        notes = coalesce(nullif(btrim(s.notes), '') || E'\n', '')
                || '[' || to_char(now(), 'YYYY-MM-DD') || '] Archivé automatiquement : '
                || 'signal de plus de ' || v_horizon || ' jours, sans aucun contact obtenu. '
                || 'Accroche commerciale périmée.'
    WHERE s.status = 'new'
      AND (now()::date - s.detected_at::date) > v_horizon
      AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_archives FROM expires;

  RETURN jsonb_build_object(
    'horizon_jours', v_horizon,
    'archives', v_archives,
    'preserves_car_ont_des_contacts', v_preserves,
    'execute_a', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_signals(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_signals(integer, boolean) TO service_role;

COMMENT ON FUNCTION public.expire_stale_signals(integer, boolean) IS
  'Archive les signaux restes NEUFS au-dela de l horizon commercial ET sans '
  'aucun contact obtenu. Ne touche jamais un signal porteur de contacts, ni un '
  'statut commercial. p_dry_run=true rend le decompte sans rien modifier.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Le backlog d'enrichissement suit le même horizon : proposer d'enrichir un
-- signal qu'on vient d'archiver serait se contredire, et engagerait une dépense
-- fournisseur sur une accroche morte.
--
-- Les colonnes sont inchangées et dans le même ordre : `CREATE OR REPLACE VIEW`
-- ne sait pas les réordonner.

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
  AND NOT EXISTS (
    SELECT 1 FROM public.enrichment_jobs j
    WHERE j.signal_id = s.id AND j.job_type = 'contacts'
      AND j.status IN ('pending', 'running')
  )
  -- L'horizon commercial : au-delà, l'accroche est périmée et la dépense
  -- d'enrichissement serait engagée pour rien.
  AND (now()::date - s.detected_at::date) <= coalesce(
        nullif(btrim((SELECT value::text FROM public.settings
                       WHERE key = 'signal_expiry_days'), '"'), '')::integer, 60)
ORDER BY s.score DESC, s.detected_at DESC;

REVOKE ALL ON public.enrichment_backlog FROM PUBLIC, anon;
GRANT SELECT ON public.enrichment_backlog TO service_role, authenticated;

COMMENT ON VIEW public.enrichment_backlog IS
  'Signaux a fort potentiel, DANS L HORIZON COMMERCIAL, sans aucun contact et '
  'sans job en cours. La colonne situation distingue ceux que PERSONNE N A '
  'JAMAIS DEMANDES (famine : aucun echec, donc aucun bruit) de ceux tentes sans '
  'resultat. Les deux ne se soignent pas pareil.';
