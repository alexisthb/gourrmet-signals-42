-- Le second étage d'enrichissement (profil complet sur les seuls contacts
-- retenus, livré le 2026-08-21) appelle Apify SANS passer par la réservation
-- de quota. C'est un défaut introduit par ce lot, relevé à l'audit du 22/08.
--
-- Ce que cela casse concrètement : `reserve_apify_actor_run` est la SEULE
-- autorité qui compte les runs Apify contre le plafond mensuel, et
-- `mark_apify_actor_run_dispatched` est ce qui rend l'intention durable AVANT
-- le POST — de sorte qu'un processus qui meurt entre les deux ne puisse pas
-- resoumettre et payer deux fois. Un appel qui contourne ces deux étapes
-- dépense sans être compté et sans être protégé du rejeu.
--
-- Le plafond mensuel est donc sous-évalué de tous les appels du second étage :
-- la plateforme peut le franchir en croyant avoir de la marge.
--
-- Cette migration ouvre l'opération `linkedin_profile_full` aux mêmes garde-fous
-- que les deux autres. Elle ne change RIEN d'autre : même verrou consultatif,
-- même refus sur réservation existante, même arithmétique de plafond.

CREATE OR REPLACE FUNCTION public.reserve_apify_actor_run(
  p_request_key text,
  p_operation text,
  p_run_id uuid,
  p_signal_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  plan public.apify_plan_settings%ROWTYPE;
  existing public.provider_quota_reservations%ROWTYPE;
  quota jsonb;
  reservation_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_request_key), '') = ''
     -- `linkedin_profile_full` : second étage, acteur
     -- harvestapi~linkedin-profile-scraper appelé sur les seuls candidats
     -- retenus. Une run facturée comme les autres, donc comptée comme les autres.
     OR p_operation NOT IN (
          'linkedin_company_search',
          'linkedin_employee_submit',
          'linkedin_profile_full'
        )
     OR p_run_id IS NULL
     OR p_signal_id IS NULL THEN
    RAISE EXCEPTION 'Réservation Apify invalide' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:apify:actor-run-quota', 0));

  SELECT * INTO existing
  FROM public.provider_quota_reservations
  WHERE provider = 'apify' AND request_key = p_request_key
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'existing_reservation',
      'reservation_id', existing.id,
      'status', existing.status,
      'dispatch_state', existing.metadata->>'dispatch_state'
    );
  END IF;

  SELECT * INTO plan FROM public.apify_plan_settings LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan Apify absent' USING ERRCODE = '55000';
  END IF;
  IF plan.quota_unit <> 'actor_runs' OR plan.monthly_run_limit <= 0 THEN
    RAISE EXCEPTION 'Plan Apify non configuré (plafond runs à 0)' USING ERRCODE = '55000';
  END IF;
  IF current_date < plan.current_period_start OR current_date > plan.current_period_end THEN
    RAISE EXCEPTION 'Période Apify non courante: % - %',
      plan.current_period_start, plan.current_period_end USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.provider_measurement_state(provider, measurement_started_at, metadata)
  VALUES (
    'apify_actor_runs',
    now(),
    jsonb_build_object('unit', 'actor_runs', 'source', 'atomic_quota_reservations')
  )
  ON CONFLICT (provider) DO NOTHING;

  quota := public.apify_actor_run_quota_status(now());
  IF (quota->>'used')::numeric + 1 > plan.monthly_run_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_run_quota_exhausted',
      'used', (quota->>'used')::numeric,
      'limit', plan.monthly_run_limit,
      'unit', 'actor_runs'
    );
  END IF;

  -- INSERT REPRIS MOT POUR MOT de 20260820178000 : cette migration ne doit
  -- changer QUE la liste blanche des opérations. Toute divergence ici casserait
  -- les deux opérations existantes en même temps que celle qu'on ajoute.
  INSERT INTO public.provider_quota_reservations(
    provider, operation, request_key, run_id, reserved_units, status,
    occurred_at, expires_at, metadata
  ) VALUES (
    'apify', p_operation, p_request_key, p_run_id, 1, 'reserved',
    now(),
    ((plan.current_period_end + 1)::timestamp AT TIME ZONE 'UTC'),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      -- 'prepared' et non 'reserved' : c'est la valeur que
      -- `mark_apify_actor_run_dispatched` exige pour accepter la transition.
      'dispatch_state', 'prepared',
      'quota_unit', 'actor_runs',
      -- `complete_apify_actor_run` relit ce signal_id pour estampiller
      -- l'événement d'usage : il n'est pas décoratif.
      'signal_id', p_signal_id
    )
  ) RETURNING id INTO reservation_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', reservation_id,
    'used_before', (quota->>'used')::numeric,
    'used_after', (quota->>'used')::numeric + 1,
    'limit', plan.monthly_run_limit,
    'unit', 'actor_runs'
  );
END;
$$;

COMMENT ON FUNCTION public.reserve_apify_actor_run(text, text, uuid, uuid, jsonb) IS
  'Reserve UNE run Apify contre le plafond mensuel, sous verrou consultatif. '
  'Couvre les trois operations facturees : recherche societe, scan employes, '
  'et profil complet du second etage. Toute run non reservee depense sans etre '
  'comptee et sans protection contre le rejeu.';
