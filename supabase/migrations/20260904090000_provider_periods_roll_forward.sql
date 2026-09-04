-- LES PÉRIODES DE QUOTA ROULENT DÉSORMAIS TOUTES SEULES.
--
-- Constaté le 2026-09-04, au retour de l'opératrice : DEUX chaînes mortes en
-- silence sur le même défaut.
--
--   • Pappers : période stockée 30/07 → 29/08. Depuis le 30/08, la garde
--     « Période Pappers non courante » refusait chaque scan quotidien —
--     SIX JOURS sans détection Pappers, zéro signal, zéro alerte.
--   • Apify : période stockée 01/08 → 31/08. Depuis le 01/09, la réservation
--     de quota refusait tout enrichissement — « Quota Apify refusé : Période
--     Apify non courante », le message que l'opératrice a fini par voir.
--
-- Les gardes ont fait EXACTEMENT ce qu'on leur avait dit : refuser hors
-- période. Personne n'avait écrit QUI fait avancer la période. Un fail-closed
-- sans mécanique de réarmement devient un fail-bloqué au premier passage de
-- mois — la panne était certaine, seule sa date était inconnue.
--
-- LA MÉCANIQUE : `roll_provider_periods()` avance chaque période échue d'un
-- cycle à la fois, en préservant son ANCRAGE (Apify : calendaire 01 → fin de
-- mois ; Pappers : anniversaire 30 → 29). Un cron quotidien à 00:05 UTC
-- l'appelle — les périodes basculent à minuit, le roulement passe cinq
-- minutes après. La fonction est idempotente et ne roule que VERS L'AVANT :
-- une période courante ou future n'est jamais touchée.
--
-- Limite assumée : l'ancrage au 30 dérive en février (Postgres clampe
-- 30/01 + 1 mois à 28/02). Une dérive d'un à deux jours sur un garde-fou
-- INTERNE est acceptable — le compteur du fournisseur fait foi, le nôtre
-- protège la facture, pas la comptabilité.
--
-- Le compteur repart de lui-même : les consommations se comptent par
-- `occurred_at`/`date` dans la période courante, donc rouler la période
-- remet mécaniquement le « utilisé » à zéro pour le nouveau cycle.

CREATE OR REPLACE FUNCTION public.roll_provider_periods()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_apify integer := 0;
  v_pappers integer := 0;
  v_guard integer;
BEGIN
  -- Apify : avancer cycle par cycle jusqu'à couvrir la date du jour.
  v_guard := 0;
  WHILE EXISTS (SELECT 1 FROM public.apify_plan_settings
                 WHERE current_period_end < current_date)
        AND v_guard < 120 LOOP
    UPDATE public.apify_plan_settings
    SET current_period_start = (current_period_end + interval '1 day')::date,
        current_period_end   = (current_period_end + interval '1 day'
                                + interval '1 month' - interval '1 day')::date,
        updated_at = now()
    WHERE current_period_end < current_date;
    v_apify := v_apify + 1;
    v_guard := v_guard + 1;
  END LOOP;

  -- Pappers : même mécanique, ancrage préservé (30 → 29).
  v_guard := 0;
  WHILE EXISTS (SELECT 1 FROM public.pappers_plan_settings
                 WHERE current_period_end < current_date)
        AND v_guard < 120 LOOP
    UPDATE public.pappers_plan_settings
    SET current_period_start = (current_period_end + interval '1 day')::date,
        current_period_end   = (current_period_end + interval '1 day'
                                + interval '1 month' - interval '1 day')::date,
        updated_at = now()
    WHERE current_period_end < current_date;
    v_pappers := v_pappers + 1;
    v_guard := v_guard + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'cycles_avances_apify', v_apify,
    'cycles_avances_pappers', v_pappers,
    'execute_a', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.roll_provider_periods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roll_provider_periods() TO service_role;

COMMENT ON FUNCTION public.roll_provider_periods() IS
  'Avance les periodes de quota Apify et Pappers echues, cycle par cycle, en '
  'preservant leur ancrage. Appelee chaque nuit a 00:05. Sans elle, les gardes '
  'fail-closed deviennent fail-bloquees au passage de mois : six jours de '
  'detection Pappers et quatre jours d enrichissement perdus en septembre 2026.';

DO $$ BEGIN
  PERFORM cron.unschedule('roll-provider-periods')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'roll-provider-periods');
  PERFORM cron.schedule(
    'roll-provider-periods',
    '5 0 * * *',
    'SELECT public.roll_provider_periods()'
  );
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible: roulement des periodes non planifie';
END $$;

-- Rattrapage immédiat : si une période est déjà échue au moment où cette
-- migration s'applique, on ne laisse pas la panne durer jusqu'à minuit.
SELECT public.roll_provider_periods();
