# Le tuyau à contacts s'est vidé le jour de la mise en service — 2026-08-21

## Ce qui s'est passé

Le lot de fiabilisation avait ajouté deux champs à l'entrée de la run Apify
`harvestapi~linkedin-company-employees` :

```js
jobTitles,      // les libellés de personas, jusqu'à 50
searchQuery,    // '"Assistant(e) de direction" OR "Office Manager" OR …'
```

Mis en service aujourd'hui. Effet immédiat sur le nombre de profils rapatriés
par entreprise :

| | profils remontés par run |
|---|---|
| **avant** (15–20 août, sans filtre serveur) | 6, 9, 22, 23, 47, 51, 74, 97, 100, 100 |
| **après** (21 août, avec filtre serveur) | 0, 0, 0, 0, 0, 0, 1, 1, 1, 13 |

L'acteur honore donc bien ces champs — contrairement à ce qu'affirmait le
commentaire en tête du fichier, issu d'un diagnostic du 14/07 : *« le filtre par
titre CÔTÉ SERVEUR est ignoré par l'acteur ».* Le lot de fiabilisation a ajouté
un filtre que ce même fichier déclarait inutile, sans le mesurer.

Et il ne pouvait que réduire : les libellés français des personas
(« Assistant(e) de direction », « Secrétaire Général », « DAF / CFO ») ne
correspondent quasiment jamais aux intitulés réels que les gens écrivent sur
leur profil LinkedIn. C'est précisément pour cela que le tri se faisait côté
client, avec normalisation d'accents et correspondance par termes.

## Pourquoi personne ne l'a vu

Rien n'était en erreur. La run Apify **réussissait**. Le dataset revenait
**vide**. L'enrichissement en concluait, honnêtement, « aucun profil
opérationnel résolu ». Et le job passait en `completed` — délibérément, puisque
techniquement il s'était bien déroulé et qu'un rejeu n'aurait rien changé.

Vu du tableau de bord : 100 % de succès. Vu de l'opératrice : plus aucun
contact. Entre le 16 et le 20 août, **22 enrichissements sur 27 n'ont ramené
aucun contact.**

Un test verrouillait même le comportement fautif :

```
Deno.test("les personas configures sont vraiment transmis a HarvestAPI", …)
```

Il vérifiait que le filtre était bien envoyé. Il passait au vert pendant que le
tuyau se vidait — parce qu'il testait une intention, pas un effet.

## Correction

`buildEmployeeSearchInput` n'envoie plus aucun filtre de titre. On rapatrie
jusqu'à 100 employés et on trie les personas côté client, comme le diagnostic du
14/07 le prescrivait. Le test verrouille désormais **l'absence** de ces champs,
avec la mesure en commentaire — pour que le prochain qui aura l'idée de
« filtrer à la source » tombe d'abord sur les chiffres.

Fonctions redéployées le 2026-08-21 à 19:05 UTC : `enrich-contacts-linkedin`,
`cron-check-linkedin-enrich`, `enrichment-worker`.

## Ce que ça laisse comme leçon

Un test qui affirme *« le paramètre est bien transmis »* ne dit rien de ce que
le fournisseur en fait. Ici, la seule mesure qui comptait — combien de profils
reviennent — n'existait nulle part, alors qu'elle était déjà écrite en base
(`company_enrichment.raw_data.employees_scanned`). Elle est maintenant la
première chose à regarder après tout changement touchant l'entrée d'un acteur
Apify :

```sql
SELECT updated_at::date, company_name,
       (raw_data->>'employees_scanned')::int AS profils
FROM public.company_enrichment
WHERE raw_data ? 'employees_scanned'
ORDER BY updated_at DESC LIMIT 30;
```

Une colonne de zéros là où il y avait des dizaines : le tuyau est fermé, quoi
que disent les statuts.

## Problèmes voisins, distincts, encore ouverts

Le rejeu des 19 signaux de lundi a fait apparaître deux échecs qui n'ont rien à
voir avec ce filtre et qui restent à traiter :

- **`company_rejected` / `company_ambiguous`** — `resolveCompanyCandidate` exige
  un score ≥ 85 avec 12 points d'écart sur le second. NAMSA, YOKOHAMA TWS FRANCE
  SAS, SAS D'AVAUX, C SAGE SARL, AKKODIS HIGH TECH SAS, PRISMA, FIBER ACADEMY,
  MGEN ACTION SANITAIRE ET SOCIALE, COULIDOOR n'y arrivent pas. La sévérité est
  saine — mieux vaut refuser que scraper la mauvaise société — mais elle laisse
  9 signaux sur 19 sans voie d'accès. Piste : accepter une résolution
  `ambiguous` quand un humain confirme, plutôt que d'abandonner.
- **Le nom légal Pappers** (« YOKOHAMA TWS FRANCE SAS ») matche mal la page
  LinkedIn. `normalizeCompanyName` retire déjà les suffixes juridiques ; il ne
  sait pas retrouver la marque quand elle diffère du nom légal.
