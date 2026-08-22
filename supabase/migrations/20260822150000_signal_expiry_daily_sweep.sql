-- LE BALAYAGE QUOTIDIEN DE L'HORIZON COMMERCIAL.
--
-- La migration 20260822130000 pose la règle des 60 jours et la fonction qui
-- l'applique. Sans balayage, elle ne serait qu'un nettoyage daté : le stock
-- se reconstituerait exactement à l'identique, et dans deux mois quelqu'un
-- redécouvrirait des signaux de 220 jours affichés comme « nouveaux ».
--
-- C'est le motif exact de la famine silencieuse consignée le 22/08 : une
-- fonction correcte qui existe en base et que RIEN N'APPELLE. On ne le refait
-- pas le jour où on le documente.
--
-- 04:12 UTC : après le scan Pappers de 02:00, avant la reprise de l'activité.
-- Une minute non ronde pour ne pas se ranger derrière la file des crons qui
-- démarrent tous à l'heure pile.
--
-- Ce balayage n'engage AUCUNE dépense fournisseur : il ne fait que masquer des
-- signaux périmés et sans contacts. C'est ce qui le rend automatisable sans
-- autorisation humaine, contrairement à `drain_enrichment_backlog`.

DO $$ BEGIN
  PERFORM cron.unschedule('expire-stale-signals')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-signals');
  PERFORM cron.schedule(
    'expire-stale-signals',
    '12 4 * * *',
    'SELECT public.expire_stale_signals()'
  );
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible: expiration des signaux non planifiée';
END $$;
