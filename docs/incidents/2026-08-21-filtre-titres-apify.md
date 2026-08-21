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

## Ce que la correction a rendu — mesuré, pas supposé

Une fois le filtre retiré, les datasets sont revenus à leur volume d'avant :
10, 27, 67, 88, 100, 100 profils par entreprise. La perte s'est alors déplacée
d'un cran, et il a fallu deux corrections de plus (documentées dans leurs
commits respectifs) :

1. **La reconnaissance des intitulés** — 486 profils rejetés sur 492, parce que
   la règle exigeait que tous les mots du persona apparaissent : « Directrice
   Générale » ne correspondait pas à « Directeur Général », ni « Responsable
   Ressources Humaines » à « Responsable RH ». Mesuré sur 300 intitulés réels
   de la base : **31,7 % → 73,0 %**.
2. **Le plafond Dropcontact** — conséquence directe du gain précédent : chaque
   contact retenu coûte un crédit, et une entreprise à 100 profils pouvait en
   consommer 70. Plafonné à 12, personas prioritaires d'abord.

Résultat sur le stock de travail de lundi (19 signaux Pappers) :

| | avant la soirée | après |
|---|---|---|
| contacts | 75 | **108** |
| emails vérifiés | 0 sur les nouveaux | **20** |
| crédits Dropcontact consommés | — | **21** (484 → 463) |

Exemples : JALIOS passe de 1 à 9 contacts, NAMSA de 5 à 13 (dont 11 emails
vérifiés), MGEN UNION de 5 à 10, VECTOR FRANCE de 4 à 9.

Aucune fiche n'a perdu de contact : la fusion répare, elle ne remplace pas.

## Les liens LinkedIn : question tranchée par la mesure

**Le mode de scraping économique ne renvoie jamais le nom public.** Ce n'est pas
un réglage de confidentialité côté personnes, c'est systématique :

| Provenance des contacts | avec URL | identifiant interne |
|---|---|---|
| Voie Apify / HarvestAPI | 778 | **778 — 100 %** |
| Ancienne voie Manus | 623 | **0 — 0 %** |

Essai contrôlé du 2026-08-21, 20:20 UTC, sur JALIOS — mêmes personnes, même
entreprise, seul `profileScraperMode` changé de « Short ($4 per 1k) » à
« Full ($8 per 1k) » :

| Contact | mode économique | mode Full |
|---|---|---|
| Vincent Bouthors, CEO | `/in/ACwAAAAgVEIB31uGmVPvCzo…` | `/in/vincent-bouthors-142862` |
| Aurélia D., Marketing | `/in/ACwAAAatW8wB0mFvjXfqv…` | `/in/aurelia-dostert-marketing-com` |
| Mathieu Brasey, Événementiel | `/in/ACwAABpj-AwBmaNOdvyDR…` | `/in/mathieu-brasey-464342104` |

**Coût réel de l'essai : 0,62 $** (100 profils), conforme à l'estimation.

Deux bénéfices non anticipés, visibles dans le même essai :

- **Le patronyme complet apparaît.** « Aurélia D. » devient identifiable via
  `aurelia-dostert`. En mode économique, LinkedIn tronque le nom de famille — et
  Dropcontact cherche donc un email sur une identité incomplète. C'est une piste
  sérieuse pour le faible taux de récupération d'emails relevé à l'audit.
- **Les intitulés sont bien plus riches**, ce qui sert à la fois la
  reconnaissance des personas et la personnalisation des messages.

### Le montage retenu : deux étages

Basculer tout le scan en mode Full reviendrait à payer huit fois pour rien : on
rapatrie 100 profils et on n'en garde que 4.

| par entreprise | actuel | deux étages | tout en Full |
|---|---|---|---|
| Scan de 100 profils (mode court) | 0,25 $ | 0,25 $ | 0,65 $ |
| Démarrages | 0,04 $ | 0,06 $ | 0,04 $ |
| Profil complet sur les 4 retenus | — | 0,02 $ | — |
| **Total** | **0,29 $** | **0,33 $** | **0,69 $** |

Quatre centimes par entreprise, soit ~11 $/mois au rythme d'août — **neuf fois
moins cher** que le basculement global pour le même résultat sur les contacts
qui comptent.

### Construit et prouvé le soir même — avec un détour instructif

Le second étage appelle `harvestapi~linkedin-profile-scraper` sur les seuls
candidats retenus. Trois essais ont été nécessaires, et les deux premiers
valent d'être racontés :

**Essai 1 — l'échec muet.** 4 profils demandés, 4 rendus, HTTP 201, aucune
erreur… et aucune URL réparée. L'appariement les avait tous rejetés sans rien
dire de ce qu'il avait vu. Exactement le travers corrigé partout ailleurs ce
soir : un étage qui échoue en silence se rejoue à l'aveugle.

**Essai 2 — le diagnostic.** Plutôt que de coder autour d'une hypothèse, on a
déployé de quoi lire la réponse réelle. Verdict :

```
identifiants demandés :  ACwAAFO5DxQBxpGlHssB5Xd1UOB47oZsaHIWry4
identifiants rendus   :  ACoAAA0wlgEB_fP8Dzwxi_YCPJTh-lf96y42j4c
```

**Deux espaces d'identifiants différents.** Le fournisseur ne réémet pas celui
qu'on lui donne, il en renvoie un autre. L'appariement par identifiant était
donc structurellement impossible — pas seulement mal codé. Aucune relecture
n'aurait pu le dire ; seule la production le savait. Coût du diagnostic :
quelques centimes.

**Essai 3 — l'appariement par le nom.** La seule preuve disponible est le nom.
Elle suffit sur quatre personnes d'une même entreprise, à condition de REFUSER
les cas ambigus au lieu d'en choisir un : un nom porté par deux demandes, un
profil correspondant à plusieurs candidats, un candidat déjà apparié. Un test
le vérifie avec deux « Marie Dupont » — le code renonce aux deux.

Résultat mesuré sur NAMSA, le pire cas de la base (13 contacts, 13 identifiants
internes) :

| | |
|---|---|
| Profils demandés / appariés / ambigus | 4 / **4** / 0 |
| URL publiques obtenues | **4** (auparavant 0) |
| Contacts / noms distincts | **13 / 13 — aucun doublon** |

Céline Puleo, Joëlle Gault, Sarra Petit et Vincent Legay ont désormais un lien
qui ouvre leur profil.

**Le patronyme tronqué est réparé au passage** : « Aurélia D. » s'apparie à
« Aurélia Dostert » par le prénom et l'initiale, et ressort complet — ce dont
Dropcontact profite directement, puisqu'il cherchait jusque-là un email sur une
identité incomplète.

**Mesure gratuite ajoutée** : le diagnostic compte les profils porteurs d'un
email. En mode « no email », zéro — conforme. Le jour où la question de
remplacer Dropcontact se posera, la réponse sera déjà en base.

### Ce que l'essai a validé au passage

La fusion de contacts s'est comportée exactement comme conçue, sur données
réelles : **10 contacts, 10 noms distincts, zéro doublon.** Trois URL mortes
remplacées en place par le vrai profil, un contact nouveau inséré. C'était
précisément le scénario redouté — un même individu revenant sous une URL de
format différent — et il ne produit pas de doublon.

Point négatif à consigner : sur ces mêmes contacts, **Dropcontact n'a trouvé
aucun email**, y compris avec le patronyme désormais complet. Un cas ne fait pas
une conclusion, mais l'hypothèse « le nom tronqué explique les emails
manquants » n'est pas confirmée par cet essai.

## Une conséquence à arbitrer : 50 liens LinkedIn qui n'ouvrent pas

Sur les 108 contacts, **50 portent une URL à identifiant interne**
(`/in/ACwAA…`), contre 18 avant. Ce n'est pas une régression : ces 32 URL
supplémentaires appartiennent à des contacts qui, sans elles, n'existeraient
pas du tout — `classifyOperationalPersonas` écarte tout profil sans URL.

Vérifié dans les données brutes : HarvestAPI ne renvoie tout simplement pas de
`publicIdentifier` pour ces profils-là, en mode « Short ». L'extracteur retombe
alors sur l'URN, faute de mieux.

Ces contacts restent utiles — nom, fonction, et souvent email vérifié :
« Damien BRIOTET, Directeur site, email vérifié », « Gaëlle Lacroix, Training &
HR administration Specialist, email vérifié ». La prospection Gourrmet part par
email, pas par LinkedIn.

Reste que **présenter comme un lien quelque chose qui n'ouvre rien fait perdre
du temps à l'opératrice**. Trois options, à trancher :

- ne pas stocker d'URL opaque (colonne à NULL, URN conservé en `raw_data`) —
  l'écran n'affiche plus de faux lien ;
- marquer le contact (`linkedin_url_status`) et laisser l'interface décider ;
- passer l'acteur en mode de scraping complet, qui expose probablement le nom
  public — mais le coût par profil augmente, et cela n'a pas été mesuré.

Non tranché ce soir : cela change ce que l'opératrice voit, et le comportement
réel de ces URL n'a pas pu être vérifié depuis cet environnement (egress
bloqué). Un aller-retour de trente secondes dans un navigateur suffit à
décider.

## Problèmes voisins, distincts, encore ouverts

Le rejeu des 19 signaux de lundi a fait apparaître deux échecs qui n'ont rien à
voir avec ce filtre et qui restent à traiter :

### La résolution de société bloque 8 signaux sur 19, et la normalisation n'y suffit pas

Deux corrections ont été apportées et **mesurées comme insuffisantes** — c'est
important de l'écrire, sinon quelqu'un les refera :

1. `normalizeCompanyName` n'était pas appliqué sur la voie réellement empruntée
   (il l'était sur l'autre). Corrigé : la recherche part désormais avec
   « AKKODIS HIGH TECH » et « YOKOHAMA TWS » au lieu des noms légaux complets,
   et la requête envoyée est tracée dans `raw_data.company_search_query`.
2. La forme juridique placée devant le nom (« SAS D'AVAUX ») n'était pas
   retirée non plus. Corrigé.

**Résultat après déploiement : les 8 signaux échouent toujours.** La recherche
société renvoie zéro candidat pour « AKKODIS HIGH TECH », « C SAGE »,
« MGEN ACTION SANITAIRE ET SOCIALE », et des candidats trop proches pour
« PRISMA », « COULIDOOR », « FIBER ACADEMY ». La normalisation était nécessaire,
elle n'est pas suffisante.

### La piste qui reste, et pourquoi elle n'a pas été prise

Le site web de chaque entreprise est **déjà en base** (`company_enrichment.website`)
et porte la marque :

| Nom légal Pappers | Site connu | Marque |
|---|---|---|
| AKKODIS HIGH TECH SAS | akkodis.com | Akkodis |
| MGEN ACTION SANITAIRE ET SOCIALE | mgen.fr | MGEN |
| YOKOHAMA TWS FRANCE SAS | yokohama-tws.com | Yokohama TWS |
| PRISMA | gestamp.com | Gestamp |
| C SAGE SARL | adhap.fr | Adhap |
| SAS D'AVAUX | champsdavaux.com | Champs d'Avaux |

Chercher par ce nom-là ne coûte aucun appel supplémentaire — il remplacerait la
requête actuelle, pas s'y ajouterait.

Ce n'est pas fait, et c'est délibéré : **pour trois de ces entreprises, le
domaine désigne une autre entité** que celle du signal. `gestamp.com` est la
maison mère de PRISMA ; `adhap.fr` est le réseau dont C SAGE est une agence.
Les contacts remontés seraient ceux du groupe, pas de l'établissement détecté.
Selon que Gourrmet vise l'établissement ou le groupe, c'est exactement ce qu'on
veut ou exactement ce qu'on ne veut pas — et c'est une décision commerciale,
pas technique.

Un essai sur trois entreprises tranche en dix minutes. Ce qu'il faudrait
ajouter en même temps : `query_source: 'legal_name' | 'website_brand'` dans la
provenance, pour qu'un contact obtenu par ce chemin reste identifiable comme
tel.
