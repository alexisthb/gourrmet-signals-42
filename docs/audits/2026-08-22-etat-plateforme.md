# État de la plateforme Gourrmet — 22 août 2026

Ce document existe parce qu'il manquait. Toutes les mesures des deux dernières
journées vivaient dans des échanges de conversation : invérifiables, non
rejouables, perdues à la première session close.

Il consigne l'état **mesuré**, distingue ce qui est prouvé de ce qui est
supposé, et nomme ce qui reste ouvert.

---

## 1 · Ce qui est prouvé

Gate exécuté le 22/08, chiffres réels :

| | |
|---|---|
| `typecheck` | ✅ |
| Tests unitaires | 13 / 0 échec |
| Tests edge (Deno) | 169 / 0 échec |
| Lint | 205 erreurs — dette héritée, aucune régression |
| Banc SQL | 167 migrations, 2 passes, 6 fichiers de contrats — **VERT** |

Chaînes métier, mesurées en production :

| Chaîne | Preuve |
|---|---|
| Détection Presse | Scan de 20:00 le 21/08 : 232 articles récupérés, 232 analysés, 1 signal, aucun 401 |
| Détection Pappers | 4 signaux en 24 h |
| Contacts | Stock de lundi passé de 75 à 113 contacts, 24 emails vérifiés, 0 signal vidé |
| URL LinkedIn | Second étage éprouvé sur NAMSA : 4 demandés, 4 appariés, 4 URL publiques, 13 contacts pour 13 noms distincts |
| Logos | 279 → 256 signaux de score ≥ 4 sans logo (23 récupérés) ; 145 tentatives pour 30 logos en 24 h |
| Télémétrie fournisseurs | 579 appels tracés sur 24 h, 99,1 % de succès |

Coût de la journée d'essais : **≈ 4,80 $ Apify**, 21 crédits Dropcontact.

---

## 2 · Ce qui ne fonctionne pas

### Bloquant

**L'envoi d'email.** Resend refuse tout envoi : `403 validation_error`, le
domaine `gourrmet.com` n'est pas vérifié. Ce n'est pas une régression — la même
erreur figure sur un envoi du 26 mai. Tant que le domaine n'est pas vérifié
côté compte Resend, les 19 signaux prêts et les 24 emails vérifiés sont
inutilisables.

À noter : la voie Lovable Emails (`notify.gourrmet.com`) **ne peut pas** servir
de contournement. Le code l'interdit explicitement pour la prospection
commerciale — `resolveEmailProvider` force Resend pour tout ce qui est
`outreach`. Lovable Emails est réservé au transactionnel.

### Important

**La résolution de société** bloque 8 signaux sur 19 du stock de lundi.
`resolveCompanyCandidate` exige un score ≥ 85 avec 12 points d'écart sur le
second. La sévérité est saine — mieux vaut refuser que scraper la mauvaise
entreprise — mais elle laisse ces prospects sans voie d'accès.

**Les visuels chocolat.** Le gabarit « CHAPON BAR À MOUSSE & ESQUIMAU » porte
une image de charrette, pas de chocolat. La classification lit « chapon », en
déduit chocolat, et envoie une consigne affirmant *« The base image shows real
edible chocolate »* — assertion fausse. L'IA appose donc le logo sur la
charrette, en couleurs. **C'est une correction de catalogue, pas de code.**

**Les domaines corrompus.** L'enrichissement `lovable_ai` a écrit des adresses
inventées : `herms.com` pour Hermès, `cooprative-u.com` pour Coopérative U,
`crdit-agricole.com`, `safranelectronics&defense.com` (avec une esperluette,
invalide dans un nom d'hôte). La chaîne logo y est désormais insensible — elle
essaie toujours aussi le nom translittéré correctement — mais les adresses
restent en base pour tout autre consommateur.

À noter : `presse_wipe_mocks` classe ces enrichissements comme **données
factices** (`enrichment_source IN ('mock','lovable_ai')`). Les purger
supprimerait aussi leurs contacts : décision métier, non prise.

---

## 3 · La famine silencieuse

Le point le plus insidieux, mesuré le 22/08 :

| Situation | Signaux | Attente la plus longue |
|---|---|---|
| **Jamais demandés** — aucun job n'a jamais existé | **225** | **220 jours** |
| Tentés sans résultat | 290 | 219 jours |

`enqueue-enrichment` n'est invoqué que par une action de l'opératrice. **Aucun
cron ne balaie le stock.** Un signal détecté, évalué, jugé à fort potentiel,
mais sur lequel personne n'a cliqué, attend indéfiniment — et rien ne le
signale, puisque aucune tentative n'échoue.

C'est pire qu'une panne : une panne finit par se voir.

La vue `enrichment_backlog` le rend visible. La fonction
`drain_enrichment_backlog(limite, motif)` permet de le vider par doses de 50
maximum, avec motif écrit. **Aucun cron ne l'appelle** : vider les 225
coûterait environ 65 $ chez Apify et 900 crédits Dropcontact pour un solde de
451. Cette dépense se décide.

---

## 4 · La dette de preuve

Ce qui *semble* fait mais n'a jamais été mesuré. Catégorie la plus dangereuse,
parce qu'elle ressemble à du travail terminé.

| Point | Pourquoi ce n'est pas prouvé |
|---|---|
| **`generate-message`** | Jamais exécutée. `signals.email_draft` est vide sur **toute** la base. Un appel externe renvoie 401 (garde interne voulu) : seul un clic dans l'interface l'éprouvera |
| **Chaîne d'envoi** | Bloquée chez Resend, donc jamais parcourue de bout en bout. Le premier envoi réel éprouvera d'un coup domaine, SPF/DKIM, signature Svix et idempotence — sur de vrais prospects |
| **Rendu chocolat monochrome** | La classification est testée sur les 7 gabarits réels, mais aucun visuel n'a été **regardé** après correction |
| **URL LinkedIn réparées** | Pas un seul clic de vérification : l'accès web sortant est bloqué depuis l'environnement de travail |
| **Ratio de détection Presse** | 1 signal pour 232 articles. Le banc de qualité existe (`press_detection_quality_metrics`) mais aucun corpus relu ne le nourrit. Filtre trop strict ou normal ? Inconnu |
| **Rendement email 21 %** | 24 emails vérifiés sur 113 contacts. L'unique hypothèse instruite — patronyme tronqué — a été **réfutée** par l'essai JALIOS. Aucune cause de rechange |
| **Stocks toxiques** | 74 enrichissements « 0 employés scannés », 150 `completed` sans contacts, 227 contacts `lovable_ai` hors quarantaine. Relevés le 21/08, **jamais traités** |

---

## 5 · Vulnérabilités npm — qualification

`npm audit` remonte 4 vulnérabilités, **aucune n'expose la production** :

| Paquet | Gravité | Qualification |
|---|---|---|
| `vite` | haute | Outil de **build et de développement**. N'est pas embarqué dans le bundle servi. Les avis concernent le serveur de développement, qui ne tourne jamais en production |
| `esbuild` | modérée | Transitif de `vite`, même raisonnement |
| `react-router` / `react-router-dom` | modérée | Embarqué côté client. À surveiller ; la montée de version majeure casse l'API de routage et demande une passe dédiée |

**Décision : pas de montée de version majeure dans ce lot.** Le risque de casser
le routage la veille d'une reprise d'activité dépasse celui des avis eux-mêmes.
À reprendre dans un lot dédié, avec le temps de tester les parcours.

---

## 6 · Les instruments posés

Ce qui permet désormais de voir sans qu'un humain y pense :

- **`pipeline_health`** — le rendement de chaque chaîne sur 24 h, pas son
  activité. Distingue MUETTE (rien ne tourne), TUYAU VIDE (ça tourne, ça ne
  produit rien) et RENDEMENT FAIBLE. C'est la réponse aux deux incidents de la
  semaine, où `cron.job_run_details` affichait « succeeded » pendant que six
  chaînes étaient mortes.
- **`pipeline_health_summary()`** — le même verdict en une ligne, le plus grave
  devant.
- **`personas_health`** — combien de fonctions chaque voie recherche. Une liste
  perdue ou rétrécie ne provoque aucune erreur : elle se voit uniquement ici.
- **`enrichment_backlog`** — ce qui dort, depuis quand, et pourquoi.

Aucun de ces instruments n'envoie d'alerte ni ne coupe quoi que ce soit. Un
garde-fou qui coupe une chaîne sur un faux positif coûte plus cher que le
silence qu'il remplace. Ils rendent l'anomalie **lisible** ; la décision reste
humaine.

**À lire en premier après toute mise en service ou tout changement touchant
l'entrée d'un fournisseur :**

```sql
SELECT public.pipeline_health_summary();
SELECT * FROM public.pipeline_health;
```

---

## 7 · Ce qui appartient à une décision humaine

Ces points ne sont pas des oublis. Ils sont ouverts parce qu'ils engagent un
arbitrage qui n'est pas technique.

1. **Vérifier le domaine chez Resend** — seul geste qui débloque la prospection.
2. **Remplacer l'image du gabarit CHAPON** — décision catalogue.
3. **Purger ou non les enrichissements `lovable_ai`** — supprime aussi des
   contacts.
4. **Vider le backlog des 225** — engage ≈ 65 $ et 900 crédits Dropcontact.
5. **Résolution de société par la marque du site** — `chooseCompanySearchQuery`
   est câblée avec un garde-fou : elle ne bascule que sur les libellés
   administratifs de trois mots ou plus. Étendre aux noms courts remonterait les
   contacts du groupe (`gestamp.com` pour PRISMA) plutôt que ceux de
   l'établissement. Choix commercial.
6. **Fusionner les doublons de contacts hérités** — choisir la ligne à garder
   engage ses notes et son historique d'échanges.
7. **Comparer les emails HarvestAPI et Dropcontact** — le mode à 12 $/1000
   existe et le diagnostic compte déjà les profils porteurs d'un email.
