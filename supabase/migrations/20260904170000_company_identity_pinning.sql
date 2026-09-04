-- L'IDENTITÉ D'UNE ENTREPRISE EST UNE DÉCISION, PAS UN SCORE.
--
-- Vécu le 04/09 : Pasqal, Arval et Crédit Agricole S.A. bloqués en échec
-- « Résolution société ambiguous/rejected ». La machine calcule un top 5 de
-- candidates (nom, page LinkedIn, score, indices) puis... le jette dans
-- resolution_provenance et affiche « réessai dans 24 h » — un réessai qui
-- retombe sur la MÊME hésitation, en payant un run fournisseur à chaque fois.
-- Pire : le fournisseur est capricieux — Pasqal résolu à 100 le 30/08, puis
-- « aucun candidat » le 04/09 sur la même requête.
--
-- Une hésitation entre « Arval BNP Paribas Group » et « ARVAL SARL
-- D'ARCHITECTURE » se tranche en deux secondes par un humain. Ce lot donne
-- donc à l'opératrice une file « À identifier » : la machine montre ses
-- candidates, l'humain épingle la bonne page, et l'épinglage PRIME ensuite
-- sur toute recherche fournisseur — plus aucune hésitation possible, plus
-- aucun run de résolution dépensé pour cette entreprise-là.
--
-- Trois pièces :
--   1. `company_identity_resolutions` — la décision humaine, tracée (qui,
--      quand, quoi, à partir de quelles candidates). Jamais écrasée : une
--      nouvelle décision s'AJOUTE, la plus récente fait foi.
--   2. `company_identifications_pending` — la file : signaux dont l'échec est
--      une VRAIE question d'identité (résolution aboutie sans vainqueur), pas
--      une panne technique, et qu'aucune décision n'a encore tranchés.
--   3. `resolve_company_identity` — le geste : consigne la décision puis,
--      pour un épinglage, relance l'enrichissement par le chemin canonique
--      (authorize_enrichment_regeneration : motif tracé, jobs supplantés,
--      zéro cooldown). « Aucune de celles-ci » consigne sans relancer :
--      dépenser un run sur une entreprise introuvable est un gaspillage connu.

-- ─────────────────────────────────────────────────────────────────────────────
-- Clé de rapprochement inter-signaux. Volontairement fruste (minuscules,
-- accents pliés, alphanumérique seul) : elle sert à retrouver « Pasqal » quand
-- le signal dit « PASQAL », pas à faire de la linguistique. Deux entreprises
-- réellement distinctes au même nom plié partageront la clé — acceptable, car
-- la clé ne DÉCIDE jamais : elle ne fait que proposer une candidate de plus,
-- que l'opératrice reste libre d'ignorer.
CREATE OR REPLACE FUNCTION public.normalize_company_identity_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_catalog
AS $nk$
  SELECT regexp_replace(
    translate(
      lower(coalesce(p_name, '')),
      'àâäáãåéèêëíìîïóòôöõúùûüÿçñœæ',
      'aaaaaaeeeeiiiiooooouuuuycnoa'
    ),
    '[^a-z0-9]+', '', 'g'
  );
$nk$;

COMMENT ON FUNCTION public.normalize_company_identity_key(text) IS
  'Cle de rapprochement des noms d entreprise entre signaux (minuscules, '
  'accents plies, alphanumerique seul). Ne decide rien : sert uniquement a '
  'proposer les identites deja connues du meme nom.';

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_identity_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  company_key text NOT NULL,
  -- 'pinned' : cette page LinkedIn EST l'entreprise du signal.
  -- 'none_of_these' : aucune candidate n'est la bonne — la machine doit
  -- cesser de proposer un réessai vain sur ce signal.
  decision text NOT NULL CHECK (decision IN ('pinned', 'none_of_these')),
  chosen_name text,
  linkedin_url text,
  -- Ce que l'opératrice avait sous les yeux au moment de trancher : la
  -- décision doit rester explicable des mois plus tard, même si la
  -- provenance du signal a été réécrite par une tentative ultérieure.
  source_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_by text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_identity_pinned_needs_url CHECK (
    decision <> 'pinned' OR (linkedin_url IS NOT NULL AND length(btrim(linkedin_url)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS company_identity_resolutions_signal_idx
  ON public.company_identity_resolutions(signal_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS company_identity_resolutions_key_idx
  ON public.company_identity_resolutions(company_key, resolved_at DESC);

ALTER TABLE public.company_identity_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_identity_resolutions_service_all
  ON public.company_identity_resolutions;
CREATE POLICY company_identity_resolutions_service_all
  ON public.company_identity_resolutions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS company_identity_resolutions_read
  ON public.company_identity_resolutions;
CREATE POLICY company_identity_resolutions_read
  ON public.company_identity_resolutions
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.company_identity_resolutions FROM PUBLIC, anon;
GRANT ALL ON public.company_identity_resolutions TO service_role;
-- L'écriture passe par resolve_company_identity (SECURITY DEFINER) : aucune
-- policy INSERT côté authenticated, exprès.
GRANT SELECT ON public.company_identity_resolutions TO authenticated;

COMMENT ON TABLE public.company_identity_resolutions IS
  'Decisions humaines d identite d entreprise (file « A identifier »). '
  'pinned = cette page LinkedIn est la bonne, elle prime sur toute recherche '
  'fournisseur ; none_of_these = introuvable, on cesse de proposer un reessai. '
  'Historique conserve : la decision la plus recente fait foi.';

-- ─────────────────────────────────────────────────────────────────────────────
-- La file « À identifier ». Un signal y entre quand :
--   • sa résolution société a ABOUTI techniquement mais sans vainqueur
--     (resolution_technical_status = 'completed' distingue « la machine a
--     hésité » de « le réseau est tombé » — une panne n'est pas une question
--     d'identité, elle relève du réessai, désormais immédiat pour l'infra) ;
--   • il n'a aucun contact (sinon la question est déjà derrière) ;
--   • aucune décision humaine ne l'a encore tranché.
CREATE OR REPLACE VIEW public.company_identifications_pending
WITH (security_invoker = true) AS
SELECT
  s.id AS signal_id,
  s.company_name,
  s.source_name,
  s.signal_type,
  s.score,
  s.event_detail,
  s.detected_at,
  ce.resolution_status,
  ce.resolution_provenance->>'reason' AS resolution_reason,
  ce.error_message,
  ce.updated_at AS failed_at,
  coalesce(ce.resolution_provenance->'candidates', '[]'::jsonb) AS candidates,
  past.linkedin_url AS previously_resolved_url,
  past.chosen_name AS previously_resolved_name
FROM public.company_enrichment ce
JOIN public.signals s ON s.id = ce.signal_id
LEFT JOIN LATERAL (
  -- L'identité déjà connue pour le MÊME nom d'entreprise : un épinglage
  -- antérieur d'abord, sinon une résolution forte passée sur un autre signal.
  -- C'est ce qui résout Pasqal d'office : résolu à 100 le 30/08, la candidate
  -- est re-proposée quand le fournisseur redevient amnésique.
  SELECT x.linkedin_url, x.chosen_name
  FROM (
    SELECT 0 AS prio, r.resolved_at AS ts, r.linkedin_url, r.chosen_name
    FROM public.company_identity_resolutions r
    WHERE r.company_key = public.normalize_company_identity_key(s.company_name)
      AND r.decision = 'pinned'
    UNION ALL
    SELECT 1, ce2.updated_at, ce2.linkedin_company_url,
           coalesce(ce2.resolution_provenance->'candidates'->0->>'name', s2.company_name)
    FROM public.company_enrichment ce2
    JOIN public.signals s2 ON s2.id = ce2.signal_id
    WHERE s2.id <> s.id
      AND ce2.resolution_status = 'resolved'
      AND ce2.linkedin_company_url IS NOT NULL
      AND public.normalize_company_identity_key(s2.company_name)
          = public.normalize_company_identity_key(s.company_name)
  ) x
  ORDER BY x.prio, x.ts DESC
  LIMIT 1
) past ON true
WHERE ce.status = 'failed'
  AND ce.resolution_status IN ('ambiguous', 'rejected')
  AND ce.resolution_technical_status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = ce.signal_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.company_identity_resolutions r
    WHERE r.signal_id = ce.signal_id
  );

REVOKE ALL ON public.company_identifications_pending FROM PUBLIC, anon;
GRANT SELECT ON public.company_identifications_pending TO authenticated, service_role;

COMMENT ON VIEW public.company_identifications_pending IS
  'File « A identifier » : signaux dont l echec d enrichissement est une vraie '
  'question d identite (resolution aboutie sans vainqueur, pas une panne), '
  'sans contact, et sans decision humaine. Porte les candidates de la derniere '
  'tentative et l identite deja connue du meme nom, le cas echeant.';

-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_company_identity(
  p_signal_id uuid,
  p_decision text,
  p_linkedin_url text DEFAULT NULL,
  p_chosen_name text DEFAULT NULL,
  p_actor text DEFAULT 'operateur'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
  v_candidates jsonb;
  v_resolution_id uuid;
  v_relaunch jsonb;
  v_url text := nullif(btrim(coalesce(p_linkedin_url, '')), '');
  v_name text := nullif(btrim(coalesce(p_chosen_name, '')), '');
  v_actor text := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'operateur');
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user() THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('pinned', 'none_of_these') THEN
    RAISE EXCEPTION 'decision invalide: %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_signal FROM public.signals WHERE id = p_signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal inconnu: %', p_signal_id USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'pinned' THEN
    -- Seule une PAGE ENTREPRISE LinkedIn est acceptée : c'est exactement ce
    -- que l'étage employés consomme. Un profil personnel ou un site web ici
    -- produirait un échec incompréhensible trois étages plus loin.
    IF v_url IS NULL
       OR v_url !~* '^https://([a-z0-9-]+\.)?linkedin\.com/company/.+' THEN
      RAISE EXCEPTION
        'URL de page entreprise LinkedIn requise (https://www.linkedin.com/company/...)'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_url := NULL;
  END IF;

  SELECT coalesce(ce.resolution_provenance->'candidates', '[]'::jsonb)
    INTO v_candidates
  FROM public.company_enrichment ce
  WHERE ce.signal_id = p_signal_id;

  INSERT INTO public.company_identity_resolutions
    (signal_id, company_name, company_key, decision, chosen_name, linkedin_url,
     source_candidates, resolved_by)
  VALUES
    (p_signal_id, v_signal.company_name,
     public.normalize_company_identity_key(v_signal.company_name),
     p_decision, v_name, v_url, coalesce(v_candidates, '[]'::jsonb), v_actor)
  RETURNING id INTO v_resolution_id;

  IF p_decision = 'none_of_these' THEN
    -- Consigner suffit : le signal sort de la file, et aucun run fournisseur
    -- n'est dépensé sur une entreprise que même un humain n'identifie pas.
    RETURN jsonb_build_object(
      'state', 'marked_unidentifiable',
      'resolution_id', v_resolution_id
    );
  END IF;

  -- Relance par le chemin canonique : motif tracé, historique supplanté sans
  -- effacement, zéro cooldown. L'épinglage sera lu au dispatch et remplacera
  -- la recherche fournisseur. Si un job est déjà en vol, authorize refuse
  -- ('job_en_vol') : l'épinglage reste consigné et s'appliquera à la
  -- prochaine génération — on le dit à l'appelant plutôt que de forcer.
  v_relaunch := public.authorize_enrichment_regeneration(
    p_signal_id,
    'Identification manuelle de l''entreprise : ' || coalesce(v_name, v_url),
    v_actor
  );

  RETURN jsonb_build_object(
    'state', 'pinned',
    'resolution_id', v_resolution_id,
    'relaunch', v_relaunch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_company_identity(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_company_identity(uuid, text, text, text, text)
  TO service_role, authenticated;

COMMENT ON FUNCTION public.resolve_company_identity(uuid, text, text, text, text) IS
  'Geste operatrice de la file « A identifier » : consigne la decision '
  '(pinned = page LinkedIn epinglee + relance canonique sans cooldown ; '
  'none_of_these = introuvable, aucune relance). La decision epinglee prime '
  'ensuite sur toute recherche fournisseur au dispatch.';
