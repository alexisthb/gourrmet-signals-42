-- ÉPINGLER LE search_path DE TOUTES LES FONCTIONS PUBLIQUES.
--
-- Le scan de sécurité du 2026-08-22 relève « function_search_path_mutable »
-- sur les fonctions héritées. Le motif d'attaque est classique : une fonction
-- SECURITY DEFINER sans search_path épinglé résout ses objets dans le schéma
-- de l'APPELANT ; quiconque peut créer un objet homonyme plus tôt dans le
-- chemin fait exécuter son code avec les privilèges du propriétaire.
--
-- Sur cette plateforme à deux comptes de confiance, l'exploitabilité est
-- aujourd'hui théorique — mais toutes les fonctions récentes épinglent déjà
-- `public, pg_catalog`, et laisser deux régimes cohabiter garantit que le
-- prochain audit re-signalera les mêmes lignes.
--
-- CE QUE CE BALAYAGE NE TOUCHE PAS, ET POURQUOI :
--   • les fonctions d'EXTENSIONS (pg_trgm, unaccent… installées dans public,
--     autre avertissement du même scan) — elles appartiennent à leur
--     extension, et les reconfigurer casserait leur mise à jour ;
--   • les fonctions en C ou internes — le search_path ne les concerne pas ;
--   • les fonctions qui ONT déjà un search_path — quel qu'il soit : un choix
--     explicite existant n'est pas réécrit par un balayage.
--
-- Le filet : le banc SQL rejoue toute la chaîne puis exécute les contrats,
-- qui APPELLENT les chaînes principales — un épinglage qui casserait une
-- résolution d'objet se verrait au banc, pas en production.

DO $$
DECLARE
  f record;
  n integer := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND l.lanname IN ('sql', 'plpgsql')
      -- Jamais les fonctions appartenant à une extension.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
      -- Jamais celles qui ont déjà fait un choix explicite.
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', f.signature);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path épinglé sur % fonction(s) publique(s)', n;
END $$;
