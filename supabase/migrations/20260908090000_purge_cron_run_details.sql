-- LE JOURNAL DES TÂCHES AUTOMATIQUES NE DOIT PLUS ÉTOUFFER LA BASE.
--
-- Panne vécue le 08/09 au matin : l'opératrice ne pouvait plus se connecter,
-- l'application restant bloquée sur « Connexion… ». Le site était sain, le
-- code intact, la CI verte — c'est la base qui ne répondait plus (8 lectures
-- sur 10 en time-out), toutes les connexions du pooler en attente alors que
-- deux requêtes seulement s'exécutaient. Un serveur étranglé, pas une requête
-- folle.
--
-- Cause mesurée : `cron.job_run_details` — le journal que pg_cron écrit à
-- CHAQUE exécution — pesait 540 Mo pour 570 573 lignes remontant au 10/06,
-- soit la plus grosse table de toute la base, cinq fois le poids des articles
-- de presse et cent fois celui des données métier. pg_cron ne purge JAMAIS ce
-- journal de lui-même. Avec trois tâches à la minute, il grossit d'environ
-- 6 000 lignes par jour : sur une instance de petite taille, ce seul journal
-- occupait le cache et condamnait le reste aux entrées-sorties disque.
--
-- Le redémarrage a rendu le service, la purge a rendu 516 Mo (540 Mo -> 24 Mo).
-- Mais un redémarrage ne soigne pas une cause : sans cette tâche, le journal
-- repousse au même rythme et la panne revient. C'est donc ici, et non dans un
-- runbook, que la leçon se consigne.
--
-- Ce qu'on garde délibérément : sept jours de tout, et QUATRE-VINGT-DIX jours
-- d'échecs. Un échec vaut un diagnostic longtemps après ; un succès ne vaut
-- que le temps de vérifier que la chaîne tourne. Les deux rétentions sont
-- bornées : aucune ne peut croître sans fin.

CREATE OR REPLACE FUNCTION public.purge_cron_run_details(
  p_succes_jours integer DEFAULT 7,
  p_echecs_jours integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_succes_supprimes integer := 0;
  v_echecs_supprimes integer := 0;
BEGIN
  IF p_succes_jours < 1 OR p_echecs_jours < p_succes_jours THEN
    RAISE EXCEPTION 'Rétention invalide : succès % j, échecs % j',
      p_succes_jours, p_echecs_jours USING ERRCODE = '22023';
  END IF;

  DELETE FROM cron.job_run_details
  WHERE status = 'succeeded'
    AND start_time < now() - make_interval(days => p_succes_jours);
  GET DIAGNOSTICS v_succes_supprimes = ROW_COUNT;

  DELETE FROM cron.job_run_details
  WHERE status <> 'succeeded'
    AND start_time < now() - make_interval(days => p_echecs_jours);
  GET DIAGNOSTICS v_echecs_supprimes = ROW_COUNT;

  RETURN jsonb_build_object(
    'succes_supprimes', v_succes_supprimes,
    'echecs_supprimes', v_echecs_supprimes,
    'lignes_restantes', (SELECT count(*) FROM cron.job_run_details),
    'poids', pg_size_pretty(pg_total_relation_size('cron.job_run_details'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_cron_run_details(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_cron_run_details(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.purge_cron_run_details(integer, integer) IS
  'Purge le journal pg_cron (cron.job_run_details), que pg_cron ne nettoie '
  'jamais seul : 540 Mo et 570 000 lignes au 08/09, cause mesuree de '
  'l etranglement de la base. Garde 7 jours de succes et 90 jours d echecs.';

-- Planifiée à 3h33, en dehors des fenêtres déjà occupées (2h00 scan Pappers,
-- 3h17 purge de l'historique opérationnel, 4h12 expiration des signaux) : deux
-- gros balayages simultanés sur une petite instance, c'est se recréer la panne
-- qu'on est en train de réparer.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-cron-run-details')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-run-details');
    PERFORM cron.schedule(
      'purge-cron-run-details',
      '33 3 * * *',
      $sql$SELECT public.purge_cron_run_details()$sql$
    );
  END IF;
END
$cron$;
