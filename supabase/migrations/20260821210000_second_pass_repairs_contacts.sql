-- Une seconde passe d'enrichissement doit RÉPARER une fiche, pas la doubler.
--
-- Constat du 2026-08-21, en préparant le rejeu des 19 signaux « prêts à
-- envoyer » de lundi : `complete_enrichment_dispatch` dédoublonne les contacts
-- sur `linkedin_url`, et ne retombe sur le nom que si le candidat n'a AUCUNE
-- URL. Deux conséquences, toutes deux mauvaises :
--
--   1. Les 17 contacts stockés avec un identifiant interne LinkedIn
--      (`/in/ACwAA…`, inexploitable — corrigé côté extracteur le même jour)
--      seraient revus avec leur vrai nom public. Nouvelle URL, donc clé
--      différente, donc DOUBLON : l'opératrice verrait deux fois la même
--      personne, l'une des deux avec un lien mort.
--
--   2. Même sans doublon, la fiche existante ne serait jamais corrigée. Le
--      rejeu coûterait des crédits fournisseur pour laisser en place
--      exactement les URL cassées qu'il était censé réparer.
--
-- Cette migration ajoute donc une passe de mise à jour AVANT l'insertion, et
-- élargit la clé de dédoublonnage au nom.
--
-- Ce qui est réparé, et rien d'autre : une URL LinkedIn absente ou opaque
-- remplacée par un vrai profil, un email absent désormais connu, un intitulé
-- de poste absent. Une donnée déjà exploitable n'est JAMAIS écrasée — le
-- fournisseur n'a pas autorité sur ce que l'opératrice a pu corriger à la
-- main, et un rejeu ne doit pas pouvoir dégrader une fiche.

-- Un identifiant interne LinkedIn (`ACwAA…`) identifie bien la personne, mais
-- n'ouvre aucune page : pour l'opératrice, c'est un lien mort. Il vaut donc
-- moins qu'une absence d'URL, qui elle au moins ne promet rien.
CREATE OR REPLACE FUNCTION public.is_opaque_linkedin_url(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_url IS NOT NULL AND p_url ~ '/in/AC[A-Za-z0-9_-]{18,}';
$$;

COMMENT ON FUNCTION public.is_opaque_linkedin_url(text) IS
  'Vrai si l URL porte un identifiant interne LinkedIn (ACwAA...) au lieu du '
  'nom public : la personne est identifiee mais le lien n ouvre aucune page.';

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
  v_contacts_inserted integer := 0;
  v_contacts_repaired integer := 0;
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

  -- Deux finalisations peuvent se suivre dans une même transaction (rejeu,
  -- test) : la table de travail précédente ne doit pas faire échouer celle-ci.
  DROP TABLE IF EXISTS _candidats;
  CREATE TEMP TABLE _candidats ON COMMIT DROP AS
  SELECT DISTINCT ON (cle) *
  FROM (
    SELECT candidate.*,
           -- Le nom prime sur l'URL comme identité : c'est ce qui reste stable
           -- quand le fournisseur change de format d'URL entre deux passes.
           NULLIF(lower(btrim(
             COALESCE(NULLIF(btrim(candidate.first_name), '') || ' ', '') ||
             COALESCE(NULLIF(btrim(candidate.last_name), ''),
                      COALESCE(candidate.full_name, ''))
           )), '') AS cle_nom,
           COALESCE(
             NULLIF(lower(btrim(
               COALESCE(NULLIF(btrim(candidate.first_name), '') || ' ', '') ||
               COALESCE(NULLIF(btrim(candidate.last_name), ''),
                        COALESCE(candidate.full_name, ''))
             )), ''),
             NULLIF(lower(candidate.linkedin_url), '')
           ) AS cle
    FROM jsonb_to_recordset(COALESCE(p_contacts, '[]'::jsonb)) AS candidate(
      full_name text,
      first_name text,
      last_name text,
      job_title text,
      department text,
      location text,
      email_principal text,
      email_alternatif text,
      phone text,
      linkedin_url text,
      is_priority_target boolean,
      priority_score integer,
      outreach_status text,
      resolution_status text,
      resolution_score numeric,
      resolution_provenance jsonb,
      email_verification_status text,
      email_verification_provider text,
      email_verification_qualification text,
      email_verification_confidence numeric,
      email_verified_at timestamptz,
      email_verification_provenance jsonb,
      raw_data jsonb
    )
    WHERE NULLIF(btrim(candidate.full_name), '') IS NOT NULL
  ) q
  WHERE cle IS NOT NULL
  ORDER BY cle,
           -- À nom égal, on garde la version la plus exploitable : un vrai
           -- profil LinkedIn plutôt qu'un identifiant interne.
           (public.is_opaque_linkedin_url(linkedin_url)) ASC,
           (linkedin_url IS NULL) ASC;

  -- ============================ RÉPARATION ============================
  -- Une fiche déjà connue est mise à jour, jamais dupliquée. Chaque champ n'est
  -- écrit que s'il apporte quelque chose : `COALESCE(existant, nouveau)` sur
  -- les champs simples, et pour l'URL LinkedIn, remplacement du lien mort par
  -- le vrai profil.
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
      -- La priorité, elle, suit la configuration COURANTE : c'est précisément
      -- ce qu'un élargissement des personas est censé changer.
      is_priority_target = COALESCE(c.is_priority_target, existing.is_priority_target),
      priority_score     = COALESCE(c.priority_score, existing.priority_score),
      resolution_status  = COALESCE(existing.resolution_status, c.resolution_status),
      resolution_score   = COALESCE(existing.resolution_score, c.resolution_score),
      resolution_provenance = COALESCE(existing.resolution_provenance, c.resolution_provenance),
      email_verification_status   = COALESCE(existing.email_verification_status, c.email_verification_status),
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
        AND lower(btrim(
              COALESCE(NULLIF(btrim(existing.first_name), '') || ' ', '') ||
              COALESCE(NULLIF(btrim(existing.last_name), ''),
                       COALESCE(existing.full_name, ''))
            )) = c.cle_nom)
    );
  GET DIAGNOSTICS v_contacts_repaired = ROW_COUNT;

  -- ============================= INSERTION =============================
  -- Ne restent que les personnes réellement inconnues de cette fiche.
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
    p_enrichment_id, v_signal_id, c.full_name, c.first_name,
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
          AND lower(btrim(
                COALESCE(NULLIF(btrim(existing.first_name), '') || ' ', '') ||
                COALESCE(NULLIF(btrim(existing.last_name), ''),
                         COALESCE(existing.full_name, ''))
              )) = c.cle_nom)
      )
  );
  GET DIAGNOSTICS v_contacts_inserted = ROW_COUNT;

  DROP TABLE IF EXISTS _candidats;

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
    'contacts_inserted', v_contacts_inserted,
    'contacts_repaired', v_contacts_repaired
  );
END;
$$;

COMMENT ON FUNCTION public.complete_enrichment_dispatch(uuid, uuid, uuid, jsonb, jsonb) IS
  'Finalise un enrichissement contacts sous bail. Une seconde passe repare les '
  'fiches connues (URL LinkedIn morte remplacee par le vrai profil, champs '
  'manquants completes) sans jamais ecraser une donnee deja exploitable, et '
  'n insere que les personnes reellement nouvelles.';
