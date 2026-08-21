-- La logique de réparation des contacts écrite en 20260821210000 n'était posée
-- que dans `complete_enrichment_dispatch`. Or la voie LinkedIn — celle qui
-- tourne réellement en production — finalise par
-- `finalize_linkedin_enrichment_poll`, qui portait sa PROPRE copie du
-- dédoublonnage, restée fautive.
--
-- Deux copies du même raisonnement, dont une seule corrigée : c'est exactement
-- ainsi qu'un correctif devient invisible. Les deux finalisations appellent
-- désormais la même fonction, et il n'y a plus qu'un endroit à corriger.
--
-- Ce que fait la fusion, et pourquoi :
--
--   * L'identité d'un contact est son NOM, pas le format d'URL que le
--     fournisseur a choisi ce jour-là. Une personne stockée avec un identifiant
--     interne LinkedIn (`/in/ACwAA…`) et revue avec son nom public est la même
--     personne — la dédoublonner sur l'URL en ferait deux fiches, dont une avec
--     un lien mort.
--   * Une fiche connue est RÉPARÉE : lien mort remplacé par le vrai profil,
--     champs manquants complétés, priorité réalignée sur les personas courants.
--   * Rien d'exploitable n'est écrasé. Le fournisseur n'a pas autorité sur ce
--     que l'opératrice a corrigé à la main, et un rejeu ne doit jamais pouvoir
--     dégrader une fiche.

CREATE OR REPLACE FUNCTION public.enrichment_contact_identity(
  p_first_name text, p_last_name text, p_full_name text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(lower(btrim(
    coalesce(nullif(btrim(p_first_name), '') || ' ', '') ||
    coalesce(nullif(btrim(p_last_name), ''), coalesce(p_full_name, ''))
  )), '');
$$;

COMMENT ON FUNCTION public.enrichment_contact_identity(text, text, text) IS
  'Cle d identite d un contact : son nom. Stable entre deux passes, la ou l URL '
  'du fournisseur peut changer de format.';

CREATE OR REPLACE FUNCTION public.merge_enrichment_contacts(
  p_enrichment_id uuid,
  p_signal_id uuid,
  p_contacts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted integer := 0;
  v_repaired integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_contacts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'contacts doit être un tableau JSON' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _candidats;
  CREATE TEMP TABLE _candidats ON COMMIT DROP AS
  SELECT DISTINCT ON (cle) *
  FROM (
    SELECT candidate.*,
           public.enrichment_contact_identity(
             candidate.first_name, candidate.last_name, candidate.full_name
           ) AS cle_nom,
           COALESCE(
             public.enrichment_contact_identity(
               candidate.first_name, candidate.last_name, candidate.full_name
             ),
             NULLIF(lower(candidate.linkedin_url), '')
           ) AS cle
    FROM jsonb_to_recordset(COALESCE(p_contacts, '[]'::jsonb)) AS candidate(
      full_name text, first_name text, last_name text, job_title text,
      department text, location text, email_principal text, email_alternatif text,
      phone text, linkedin_url text, is_priority_target boolean,
      priority_score integer, outreach_status text, resolution_status text,
      resolution_score numeric, resolution_provenance jsonb,
      email_verification_status text, email_verification_provider text,
      email_verification_qualification text, email_verification_confidence numeric,
      email_verified_at timestamptz, email_verification_provenance jsonb,
      raw_data jsonb
    )
    WHERE NULLIF(btrim(candidate.full_name), '') IS NOT NULL
  ) q
  WHERE cle IS NOT NULL
  ORDER BY cle,
           -- À nom égal, on garde la version la plus exploitable : un vrai
           -- profil plutôt qu'un identifiant interne, une URL plutôt que rien.
           (public.is_opaque_linkedin_url(linkedin_url)) ASC,
           (linkedin_url IS NULL) ASC;

  UPDATE public.contacts AS existing
  SET linkedin_url = CASE
        WHEN c.linkedin_url IS NOT NULL
             AND NOT public.is_opaque_linkedin_url(c.linkedin_url)
             AND (existing.linkedin_url IS NULL
                  OR public.is_opaque_linkedin_url(existing.linkedin_url))
        THEN c.linkedin_url
        ELSE existing.linkedin_url
      END,
      email_principal   = COALESCE(existing.email_principal, c.email_principal),
      email_alternatif  = COALESCE(existing.email_alternatif, c.email_alternatif),
      phone             = COALESCE(existing.phone, c.phone),
      job_title         = COALESCE(existing.job_title, c.job_title),
      department        = COALESCE(existing.department, c.department),
      location          = COALESCE(existing.location, c.location),
      is_priority_target = COALESCE(c.is_priority_target, existing.is_priority_target),
      priority_score     = COALESCE(c.priority_score, existing.priority_score),
      resolution_status  = COALESCE(existing.resolution_status, c.resolution_status),
      resolution_score   = COALESCE(existing.resolution_score, c.resolution_score),
      resolution_provenance = COALESCE(existing.resolution_provenance, c.resolution_provenance),
      -- Une vérification d'email réellement aboutie remplace une absence de
      -- vérification : c'est une information neuve, pas un écrasement.
      email_verification_status = CASE
        WHEN c.email_verification_status = 'verified'
             AND COALESCE(existing.email_verification_status, '') <> 'verified'
        THEN c.email_verification_status
        ELSE COALESCE(existing.email_verification_status, c.email_verification_status)
      END,
      email_verification_provider = COALESCE(existing.email_verification_provider, c.email_verification_provider),
      email_verification_qualification = COALESCE(existing.email_verification_qualification, c.email_verification_qualification),
      email_verification_confidence    = COALESCE(existing.email_verification_confidence, c.email_verification_confidence),
      email_verified_at               = COALESCE(existing.email_verified_at, c.email_verified_at),
      email_verification_provenance   = COALESCE(existing.email_verification_provenance, c.email_verification_provenance),
      updated_at = now()
  FROM _candidats AS c
  WHERE existing.enrichment_id = p_enrichment_id
    AND (
      (c.linkedin_url IS NOT NULL
        AND lower(existing.linkedin_url) = lower(c.linkedin_url))
      OR (c.cle_nom IS NOT NULL
        AND public.enrichment_contact_identity(
              existing.first_name, existing.last_name, existing.full_name
            ) = c.cle_nom)
    );
  GET DIAGNOSTICS v_repaired = ROW_COUNT;

  INSERT INTO public.contacts (
    enrichment_id, signal_id, full_name, first_name, last_name, job_title,
    department, location, email_principal, email_alternatif, phone,
    linkedin_url, is_priority_target, priority_score, outreach_status,
    resolution_status, resolution_score, resolution_provenance,
    email_verification_status, email_verification_provider,
    email_verification_qualification, email_verification_confidence,
    email_verified_at, email_verification_provenance, raw_data
  )
  SELECT
    p_enrichment_id, p_signal_id, c.full_name, c.first_name,
    c.last_name, c.job_title, c.department,
    c.location, c.email_principal, c.email_alternatif,
    c.phone, c.linkedin_url, c.is_priority_target,
    c.priority_score, COALESCE(c.outreach_status, 'new'),
    c.resolution_status, c.resolution_score,
    c.resolution_provenance, c.email_verification_status,
    c.email_verification_provider,
    c.email_verification_qualification,
    c.email_verification_confidence, c.email_verified_at,
    c.email_verification_provenance, c.raw_data
  FROM _candidats AS c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.contacts AS existing
    WHERE existing.enrichment_id = p_enrichment_id
      AND (
        (c.linkedin_url IS NOT NULL
          AND lower(existing.linkedin_url) = lower(c.linkedin_url))
        OR (c.cle_nom IS NOT NULL
          AND public.enrichment_contact_identity(
                existing.first_name, existing.last_name, existing.full_name
              ) = c.cle_nom)
      )
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  DROP TABLE IF EXISTS _candidats;
  RETURN jsonb_build_object('inserted', v_inserted, 'repaired', v_repaired);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_enrichment_contacts(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_enrichment_contacts(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.merge_enrichment_contacts(uuid, uuid, jsonb) IS
  'Fusionne les contacts d une passe d enrichissement dans une fiche existante : '
  'repare ce qui manque ou ce qui est casse, n insere que les personnes '
  'nouvelles, n ecrase jamais une donnee deja exploitable. Point unique '
  'd application pour les deux voies de finalisation.';

-- ─────────────────────── les deux finalisations s'y branchent ───────────────

CREATE OR REPLACE FUNCTION public.complete_enrichment_dispatch(
  p_job_id uuid,
  p_lease_token uuid,
  p_enrichment_id uuid,
  p_company_patch jsonb,
  p_contacts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal_id uuid;
  v_merge jsonb;
  v_updated boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_contacts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'contacts doit être un tableau JSON' USING ERRCODE = '22023';
  END IF;

  SELECT signal_id INTO v_signal_id
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'contacts_inserted', 0);
  END IF;

  v_merge := public.merge_enrichment_contacts(p_enrichment_id, v_signal_id, p_contacts);

  v_updated := public.update_enrichment_dispatch(
    p_job_id,
    p_lease_token,
    p_enrichment_id,
    COALESCE(p_company_patch, '{}'::jsonb) || jsonb_build_object(
      'status', 'completed',
      'enrichment_source', 'waterfall',
      'error_message', NULL
    ),
    'completed',
    NULL
  );
  IF NOT v_updated THEN
    RAISE EXCEPTION 'lease dispatcher perdu pendant la finalisation'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'contacts_inserted', (v_merge->>'inserted')::int,
    'contacts_repaired', (v_merge->>'repaired')::int
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_linkedin_enrichment_poll(
  p_job_id uuid,
  p_lease_token uuid,
  p_poll_token uuid,
  p_enrichment_id uuid,
  p_signal_id uuid,
  p_status text,
  p_resolution_attempted_at timestamptz,
  p_resolution_technical_status text,
  p_operational_profiles_count integer,
  p_company_raw_data jsonb,
  p_contacts jsonb DEFAULT '[]'::jsonb,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_locked_job uuid;
  v_company_updated integer;
  v_merge jsonb := jsonb_build_object('inserted', 0, 'repaired', 0);
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'statut terminal invalide: %', p_status
      USING ERRCODE = '22023';
  END IF;
  IF p_resolution_technical_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'statut technique invalide: %', p_resolution_technical_status
      USING ERRCODE = '22023';
  END IF;
  IF p_operational_profiles_count < 0 THEN
    RAISE EXCEPTION 'compte profils opérationnels invalide'
      USING ERRCODE = '22023';
  END IF;
  IF p_job_id IS NULL OR p_lease_token IS NULL OR p_poll_token IS NULL
     OR p_enrichment_id IS NULL OR p_signal_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'contacts_inserted', 0);
  END IF;

  SELECT id INTO v_locked_job
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND signal_id = p_signal_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND poll_token = p_poll_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'contacts_inserted', 0);
  END IF;

  IF p_status = 'completed' AND jsonb_typeof(COALESCE(p_contacts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'contacts doit être un tableau JSON' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'completed' THEN
    v_merge := public.merge_enrichment_contacts(p_enrichment_id, p_signal_id, p_contacts);
  END IF;

  UPDATE public.company_enrichment
  SET status = p_status,
      error_message = CASE
        WHEN p_status = 'failed' THEN NULLIF(left(p_error_message, 300), '')
        ELSE NULL
      END,
      resolution_attempted_at = COALESCE(p_resolution_attempted_at, now()),
      resolution_technical_status = p_resolution_technical_status,
      operational_profiles_count = p_operational_profiles_count,
      raw_data = COALESCE(p_company_raw_data, '{}'::jsonb)
  WHERE id = p_enrichment_id
    AND signal_id = p_signal_id;
  GET DIAGNOSTICS v_company_updated = ROW_COUNT;
  IF v_company_updated <> 1 THEN
    RAISE EXCEPTION 'company_enrichment introuvable pour finalisation'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.signals
  SET enrichment_status = p_status
  WHERE id = p_signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal introuvable pour finalisation' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.enrichment_jobs
  SET status = p_status,
      finished_at = now(),
      next_retry_at = NULL,
      error_message = CASE
        WHEN p_status = 'failed' THEN NULLIF(left(p_error_message, 500), '')
        ELSE NULL
      END,
      result = COALESCE(result, '{}'::jsonb) || COALESCE(p_result, '{}'::jsonb)
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND poll_token = p_poll_token;

  RETURN jsonb_build_object(
    'accepted', true,
    'contacts_inserted', (v_merge->>'inserted')::int,
    'contacts_repaired', (v_merge->>'repaired')::int
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_linkedin_enrichment_poll(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, integer, jsonb, jsonb, jsonb, text
) IS
  'Finalisation transactionnelle de la voie LinkedIn sous bail et jeton de poll. '
  'Delegue la fusion des contacts a merge_enrichment_contacts : une seconde '
  'passe repare la fiche au lieu de la dupliquer.';
