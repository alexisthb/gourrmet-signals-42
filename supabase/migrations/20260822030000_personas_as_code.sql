-- Les personas de recherche de contacts n'existaient QUE dans la table
-- `settings` de la base de production. Élargis le 2026-08-21 de 4 à 10
-- fonctions côté Presse, ils n'avaient pour seule trace que la prose de
-- docs/decisions/2026-08-21-personas-elargis.md.
--
-- Le risque, relevé à l'audit du 22/08 : une restauration de base, un
-- rafraîchissement d'environnement, une remise à plat des réglages — et la
-- plateforme recherche à nouveau 4 fonctions en croyant en chercher 10. Sans
-- une seule erreur nulle part. Les enrichissements continueraient de réussir,
-- simplement en ne remontant que des office managers. C'est le motif exact de
-- la journée : ça tourne, ça ne produit pas ce qu'on croit.
--
-- Cette migration fait des personas une donnée VERSIONNÉE, rejouable et
-- reconstructible depuis le dépôt.
--
-- POURQUOI `ON CONFLICT DO NOTHING` ET NON `DO UPDATE` : les personas sont un
-- réglage métier, ajustable par l'opératrice depuis l'interface. Une migration
-- qui écraserait ses choix à chaque déploiement serait pire que le problème
-- qu'elle corrige. On pose la valeur SI ELLE MANQUE — reconstruction après
-- perte — et on ne touche jamais à une liste existante.
--
-- `personas_linkedin` est ajouté ici, alors qu'il n'a jamais existé en base :
-- la voie LinkedIn retombait silencieusement sur les 7 DEFAULT_PERSONAS du
-- code, c'est-à-dire l'ancien ciblage étroit, le jour où cette source serait
-- réactivée.

INSERT INTO public.settings (key, value)
VALUES (
  'personas_pappers',
  '[
  {"name":"Assistant(e) de direction","isPriority":true},
  {"name":"Office Manager","isPriority":true},
  {"name":"Responsable Communication","isPriority":true},
  {"name":"Responsable RH","isPriority":true},
  {"name":"Directeur Général","isPriority":true},
  {"name":"Responsable Événementiel","isPriority":true},
  {"name":"Directeur Marketing","isPriority":false},
  {"name":"DAF / CFO","isPriority":false},
  {"name":"Responsable Achats","isPriority":false},
  {"name":"Secrétaire Général","isPriority":false}
]'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value)
VALUES (
  'personas_presse',
  '[
  {"name":"Assistant(e) de direction","isPriority":true,"color":"amber"},
  {"name":"Office Manager","isPriority":true,"color":"violet"},
  {"name":"Responsable Communication","isPriority":true,"color":"pink"},
  {"name":"Responsable RH","isPriority":true,"color":"emerald"},
  {"name":"Directeur Général","isPriority":true,"color":"blue"},
  {"name":"Responsable Événementiel","isPriority":true,"color":"rose"},
  {"name":"Directeur Marketing","isPriority":false,"color":"cyan"},
  {"name":"DAF / CFO","isPriority":false,"color":"slate"},
  {"name":"Responsable Achats","isPriority":false,"color":"orange"},
  {"name":"Secrétaire Général","isPriority":false,"color":"stone"}
]'
)
ON CONFLICT (key) DO NOTHING;

-- Absent de la base jusqu'ici : la voie LinkedIn retombait sur les
-- DEFAULT_PERSONAS du code, sept fonctions dont deux prioritaires seulement.
INSERT INTO public.settings (key, value)
VALUES (
  'personas_linkedin',
  '[
  {"name":"Assistant(e) de direction","isPriority":true},
  {"name":"Office Manager","isPriority":true},
  {"name":"Responsable Communication","isPriority":true},
  {"name":"Responsable RH","isPriority":true},
  {"name":"Directeur Général","isPriority":true},
  {"name":"Responsable Événementiel","isPriority":true},
  {"name":"Directeur Marketing","isPriority":false},
  {"name":"DAF / CFO","isPriority":false},
  {"name":"Responsable Achats","isPriority":false},
  {"name":"Secrétaire Général","isPriority":false}
]'
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Le contrôle qui manquait : savoir, en une requête, si les personas ont été
-- perdus ou rétrécis. Une liste réduite à l'ancien ciblage ne provoque aucune
-- erreur — elle se voit uniquement au nombre de fonctions recherchées.

CREATE OR REPLACE VIEW public.personas_health AS
SELECT
  cle,
  coalesce(jsonb_array_length(s.value::jsonb), 0) AS fonctions,
  coalesce((
    SELECT count(*) FROM jsonb_array_elements(s.value::jsonb) e
    WHERE (e->>'isPriority')::boolean
  ), 0) AS prioritaires,
  CASE
    WHEN s.value IS NULL THEN 'ABSENT — la voie retombe sur les personas du code'
    WHEN jsonb_array_length(s.value::jsonb) < 10 THEN
      'RETRECI — ' || jsonb_array_length(s.value::jsonb) ||
      ' fonctions au lieu des 10 attendues'
    ELSE 'OK'
  END AS verdict
FROM (VALUES ('personas_presse'), ('personas_pappers'), ('personas_linkedin')) AS v(cle)
LEFT JOIN public.settings s ON s.key = v.cle;

REVOKE ALL ON public.personas_health FROM PUBLIC, anon;
GRANT SELECT ON public.personas_health TO service_role, authenticated;

COMMENT ON VIEW public.personas_health IS
  'Etat des listes de personas : combien de fonctions cherchees par voie. Une '
  'liste perdue ou retrecie ne provoque AUCUNE erreur — les enrichissements '
  'continuent de reussir en ne remontant que des office managers. Cette vue est '
  'le seul moyen de le voir.';
