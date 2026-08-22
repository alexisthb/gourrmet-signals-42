-- Contrats de sécurité des vues (20260822210000).
--
-- Deux promesses, nées du scan du 2026-08-22 qui a trouvé CINQ vues en mode
-- definer — exactement les cinq créées dans les vingt-quatre heures
-- précédentes, par le même auteur, alors que les vingt vues antérieures
-- suivaient toutes la convention invoker.
--
-- 1. LA CONVENTION EST MÉCANIQUE : plus aucune vue publique en mode definer.
--    Une convention qui repose sur la mémoire d'un auteur vient d'être
--    démontrée inefficace cinq fois de suite.
--
-- 2. LA BASCULE N'AVEUGLE PERSONNE : en mode invoker, une policy restrictive
--    sur une table sous-jacente ne produit AUCUNE erreur — elle filtre, et la
--    vue affiche des zéros faux. Ces assertions consultent donc les vues DANS
--    LA PEAU D'UN COMPTE AUTHENTIFIÉ NON-ADMIN, et exigent les vrais chiffres.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

-- ═══ 1. Aucune vue publique hors convention ═══
DO $$
DECLARE v_hors_convention text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_hors_convention
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                   WHERE option_name = 'security_invoker'), 'off')
        NOT IN ('on', 'true', '1');

  ASSERT v_hors_convention IS NULL,
    'Vue(s) en mode definer, hors convention du depot : ' || v_hors_convention
    || '. Ajouter WITH (security_invoker = on) — et si un mode definer est '
    || 'reellement voulu, amender CE contrat en le justifiant.';

  RAISE NOTICE 'OK — toutes les vues publiques sont en security_invoker';
END $$;

-- ═══ 2. Les vues disent vrai pour un authentifié non-admin ═══
-- provider_usage_events est réservée aux admins. Sans les agrégats DEFINER
-- (provider_calls_pulse_24h, latest_dropcontact_credits), un opérateur
-- non-admin verrait « appels_fournisseurs : MUETTE » et un solde Dropcontact
-- à zéro — des mensonges sans erreur.
-- L'assertion est COMPARATIVE, pas absolue : ce qu'un authentifié voit doit
-- être IDENTIQUE à ce que postgres (RLS ignorée) voit. C'est la promesse
-- exacte de la bascule invoker — « n'aveugler personne » — et elle reste
-- vraie quel que soit l'état laissé par les contrats précédents, qui mutent
-- les personas pour tester les verdicts ABSENT/RETRECI.
DO $$
DECLARE
  v_ref text;
  v_vu text;
  v_solde integer;
  v_executions bigint;
BEGIN
  -- Le témoin, posé en tant que postgres (la RLS ne s'applique pas ici).
  DELETE FROM public.provider_usage_events WHERE operation = 'zz_contract_probe';
  INSERT INTO public.provider_usage_events (provider, operation, success, metadata)
  VALUES ('dropcontact', 'zz_contract_probe', true,
          jsonb_build_object('credits_left', 314));

  -- Les références, vues par postgres.
  SELECT string_agg(cle || '=' || fonctions, ',' ORDER BY cle) INTO v_ref
  FROM public.personas_health;

  -- La peau d'un compte authentifié SANS rôle admin : auth.uid() est NULL,
  -- donc has_role(...) est faux, donc la policy admin-only filtre tout.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT executions INTO v_executions
  FROM public.pipeline_health WHERE chaine = 'appels_fournisseurs';
  ASSERT coalesce(v_executions, 0) >= 1,
    'pipeline_health doit voir les appels fournisseurs SANS role admin — '
    'sinon la chaine parait MUETTE a l operateur (obtenu: '
    || coalesce(v_executions::text, 'NULL') || ')';

  SELECT string_agg(cle || '=' || fonctions, ',' ORDER BY cle) INTO v_vu
  FROM public.personas_health;
  ASSERT v_vu IS NOT DISTINCT FROM v_ref,
    'personas_health doit montrer la MEME chose a un authentifie qu a '
    'postgres — un ecart signifie qu une RLS filtre en silence (postgres: '
    || coalesce(v_ref, 'NULL') || ' / authentifie: ' || coalesce(v_vu, 'NULL') || ')';

  SELECT dropcontact_restant INTO v_solde
  FROM public.enrichment_sweep_readiness;
  ASSERT v_solde = 314,
    'le solde Dropcontact doit traverser la policy admin via l agregat '
    'DEFINER (attendu 314, obtenu: ' || coalesce(v_solde::text, 'NULL') || ')';

  SELECT count(*)::text INTO v_vu FROM public.signal_expiry_preview;
  ASSERT v_vu = '1', 'signal_expiry_preview doit rendre sa ligne unique en invoker';

  -- Un SELECT qui ne lève pas d'erreur suffit ici : le contenu dépend des
  -- fixtures des autres contrats.
  SELECT count(*)::text INTO v_vu FROM public.enrichment_backlog;

  EXECUTE 'RESET ROLE';
  DELETE FROM public.provider_usage_events WHERE operation = 'zz_contract_probe';

  RAISE NOTICE 'OK — les cinq vues disent vrai dans la peau d un non-admin';
END $$;

-- ═══ 3. Plus aucune fonction publique au search_path flottant ═══
-- Même logique que les vues : la convention est mécanique ou elle n'est pas.
-- Une fonction SECURITY DEFINER au search_path flottant résout ses objets
-- dans le schéma de l'appelant — le détournement classique de privilèges.
DO $$
DECLARE v_flottantes text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_flottantes
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE ns.nspname = 'public'
    AND p.prokind = 'f'
    AND l.lanname IN ('sql', 'plpgsql')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
      WHERE c LIKE 'search_path=%'
    );

  ASSERT v_flottantes IS NULL,
    'Fonction(s) publique(s) sans search_path epingle : ' || coalesce(v_flottantes, '')
    || '. Ajouter SET search_path = public, pg_catalog a leur definition.';

  RAISE NOTICE 'OK — toutes les fonctions publiques ont un search_path epingle';
END $$;
