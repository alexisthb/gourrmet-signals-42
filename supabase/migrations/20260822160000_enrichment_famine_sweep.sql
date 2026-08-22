-- LE BALAYAGE DE LA FAMINE, AVEC SES GARDE-FOUS FOURNISSEURS.
--
-- Consigné le 22/08 : `enqueue-enrichment` n'est invoqué que par une action de
-- l'opératrice. Aucun cron ne balaie le stock. Un signal détecté, évalué, jugé
-- à fort potentiel, mais sur lequel personne n'a cliqué, attend indéfiniment —
-- et rien ne le signale, puisque aucune tentative n'échoue.
--
-- Cette lacune est restée ouverte pour une raison chiffrée : vider les 225
-- signaux jamais demandés engageait ~65 $ chez Apify et 900 crédits Dropcontact
-- pour un solde de 438. C'était une dépense, donc une décision humaine.
--
-- DEUX DÉCISIONS DU 2026-08-22 L'ONT RENDUE FINANÇABLE.
--
--   • L'horizon commercial de 60 jours (20260822130000) a écarté 215 des 225
--     signaux jamais demandés : leur accroche était morte de toute façon.
--     Reste 10 signaux, soit ~20 runs Apify et ~40 crédits Dropcontact.
--   • Le plafond Apify recalibré (20260822140000) a rendu 449 runs disponibles
--     au lieu de 49.
--
-- Ce qui coûtait 65 $ en coûte environ 3. Le balayage devient automatisable.
--
-- POURQUOI UNE FONCTION DÉDIÉE PLUTÔT QU'UN CRON SUR `drain_enrichment_backlog`.
--
-- `drain_enrichment_backlog` exige un rôle applicatif : appelée par pg_cron,
-- elle échouerait sur son propre contrôle d'accès. Surtout, elle ne consulte
-- AUCUN solde fournisseur — elle a été écrite pour une main humaine qui sait ce
-- qu'elle engage. Un automate, lui, doit vérifier avant de dépenser.
--
-- LES DEUX RÉSERVES, ET CE QU'ELLES PROTÈGENT.
--
-- Un signal frais vaut plus qu'un signal de 50 jours : son événement est récent,
-- son accroche vive. Le balayage ne doit donc JAMAIS consommer la capacité
-- nécessaire aux détections de la semaine. D'où une réserve intouchable sur
-- chaque fournisseur, sous laquelle le balayage s'abstient et le dit.

INSERT INTO public.settings (key, value)
VALUES ('enrichment_sweep_daily_dose', '5')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sweep_enrichment_famine(
  p_dose integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Chaque entreprise enrichie consomme DEUX runs Apify (recherche d'employés,
  -- puis étage profils) et jusqu'à QUATRE crédits Dropcontact
  -- (MAX_CONTACTS_PER_COMPANY).
  RUNS_PAR_SIGNAL    constant integer := 2;
  CREDITS_PAR_SIGNAL constant integer := 4;
  -- Réserves intouchables, gardées pour les signaux frais de la semaine.
  RESERVE_APIFY       constant integer := 100;
  RESERVE_DROPCONTACT constant integer := 150;

  v_dose integer;
  v_apify_restant integer;
  v_credits_restants integer;
  v_s record;
  v_r jsonb;
  v_mis_en_file integer := 0;
  v_refuses integer := 0;
BEGIN
  v_dose := coalesce(
    p_dose,
    nullif(btrim((SELECT value::text FROM public.settings
                   WHERE key = 'enrichment_sweep_daily_dose'), '"'), '')::integer,
    5
  );
  -- Une dose nulle désarme le balayage ; une dose énorme le transforme en
  -- facture. Les deux se refusent plutôt que de se deviner.
  IF v_dose < 1 OR v_dose > 25 THEN
    RAISE EXCEPTION 'Dose hors bornes (1 a 25) : un balayage se dose'
      USING ERRCODE = '22023';
  END IF;

  -- ═══ Garde-fou Apify ═══
  SELECT coalesce((public.apify_actor_run_quota_status(now())->>'remaining')::integer, 0)
    INTO v_apify_restant;
  IF v_apify_restant < RESERVE_APIFY + v_dose * RUNS_PAR_SIGNAL THEN
    RETURN jsonb_build_object(
      'balaye', false,
      'motif', 'Quota Apify sous la reserve : ' || v_apify_restant ||
               ' runs restants, reserve de ' || RESERVE_APIFY ||
               ' gardee pour les signaux frais',
      'mis_en_file', 0
    );
  END IF;

  -- ═══ Garde-fou Dropcontact ═══
  SELECT coalesce(credits_left::integer, 0) INTO v_credits_restants
  FROM public.dropcontact_balance_metrics WHERE provider = 'dropcontact' LIMIT 1;
  IF v_credits_restants < RESERVE_DROPCONTACT + v_dose * CREDITS_PAR_SIGNAL THEN
    RETURN jsonb_build_object(
      'balaye', false,
      'motif', 'Solde Dropcontact sous la reserve : ' || v_credits_restants ||
               ' credits, reserve de ' || RESERVE_DROPCONTACT ||
               ' gardee pour les signaux frais',
      'mis_en_file', 0
    );
  END IF;

  -- Les meilleurs d'abord, et uniquement ceux que PERSONNE n'a jamais demandés :
  -- un signal déjà tenté sans résultat ne se soigne pas en le retentant à
  -- l'identique. `enrichment_backlog` borne déjà à l'horizon commercial.
  FOR v_s IN
    SELECT id, company_name FROM public.enrichment_backlog
    WHERE situation LIKE 'JAMAIS DEMANDE%'
    LIMIT v_dose
  LOOP
    v_r := public.enqueue_enrichment_job_authorized(v_s.id, 'contacts', 5, 0, false);
    IF v_r->>'state' = 'enqueued' THEN
      v_mis_en_file := v_mis_en_file + 1;
    ELSE
      v_refuses := v_refuses + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'balaye', true,
    'dose', v_dose,
    'mis_en_file', v_mis_en_file,
    'refuses', v_refuses,
    'apify_restant_avant', v_apify_restant,
    'credits_dropcontact_avant', v_credits_restants,
    'execute_a', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_enrichment_famine(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_enrichment_famine(integer) TO service_role;

COMMENT ON FUNCTION public.sweep_enrichment_famine(integer) IS
  'Met en file une dose bornee de signaux que PERSONNE n a jamais demandes, dans '
  'l horizon commercial, apres verification des soldes Apify ET Dropcontact. '
  'S abstient et le dit si un solde passe sous sa reserve : un signal frais vaut '
  'mieux qu un signal ancien, et la capacite de la semaine ne se prete pas.';

-- 06:42 UTC : après le scan Pappers de 02:00 et l'expiration de 04:12, de sorte
-- que le balayage voie un stock déjà nettoyé de ses signaux périmés.
DO $$ BEGIN
  PERFORM cron.unschedule('sweep-enrichment-famine')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-enrichment-famine');
  PERFORM cron.schedule(
    'sweep-enrichment-famine',
    '42 6 * * *',
    'SELECT public.sweep_enrichment_famine()'
  );
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible: balayage de famine non planifié';
END $$;
