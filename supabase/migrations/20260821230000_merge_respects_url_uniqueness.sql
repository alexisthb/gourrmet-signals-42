-- La réparation d'URL du second étage pouvait faire échouer TOUT
-- l'enrichissement d'un signal.
--
-- Mesuré en production le 2026-08-21 sur VECTOR FRANCE :
--   « finalisation LinkedIn transactionnelle: duplicate key value violates
--     unique constraint "contacts_signal_linkedin_unique" »
--
-- L'index est `UNIQUE (signal_id, linkedin_url) WHERE linkedin_url IS NOT NULL`.
-- Le scénario : la même personne figure DEUX FOIS sur un signal — une ligne
-- ancienne portant déjà son nom public, une ligne récente portant l'identifiant
-- interne. Ces doublons datent d'avant la fusion par le nom. Quand le second
-- étage répare la seconde ligne, elle réclame une URL que la première détient
-- déjà : l'index refuse, la fonction lève, et le poller perd l'enrichissement
-- entier — pas seulement la réparation.
--
-- Un contact réparable ne doit jamais coûter la fiche complète. La mise à jour
-- ne prend donc l'URL publique QUE si aucune autre ligne du même signal ne la
-- porte. Sinon la ligne garde son identifiant interne : l'interface l'affiche
-- déjà comme « profil sans adresse publique », ce qui est exact, et
-- l'enrichissement va au bout.
--
-- Ce que cette migration NE fait pas, volontairement : fusionner les doublons
-- hérités. Deux lignes pour une même personne demandent de choisir laquelle
-- garder — ses notes, son statut d'approche, son historique. C'est une décision
-- métier, pas une reprise automatique.

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
           (public.is_opaque_linkedin_url(linkedin_url)) ASC,
           (linkedin_url IS NULL) ASC;

  UPDATE public.contacts AS existing
  SET linkedin_url = CASE
        WHEN c.linkedin_url IS NOT NULL
             AND NOT public.is_opaque_linkedin_url(c.linkedin_url)
             AND (existing.linkedin_url IS NULL
                  OR public.is_opaque_linkedin_url(existing.linkedin_url))
             -- L'index `contacts_signal_linkedin_unique` interdit deux fois la
             -- même URL sur un signal. Une réparation impossible doit être
             -- abandonnée, jamais faire échouer la fiche entière.
             AND NOT EXISTS (
               SELECT 1 FROM public.contacts AS autre
               WHERE autre.signal_id = p_signal_id
                 AND autre.id <> existing.id
                 AND lower(autre.linkedin_url) = lower(c.linkedin_url)
             )
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
  )
  -- Même garde à l'insertion : le signal peut porter des contacts rattachés à
  -- une AUTRE fiche d'enrichissement, que la clause ci-dessus ne voit pas.
  AND NOT EXISTS (
    SELECT 1 FROM public.contacts AS autre
    WHERE autre.signal_id = p_signal_id
      AND c.linkedin_url IS NOT NULL
      AND lower(autre.linkedin_url) = lower(c.linkedin_url)
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  DROP TABLE IF EXISTS _candidats;
  RETURN jsonb_build_object('inserted', v_inserted, 'repaired', v_repaired);
END;
$$;
