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
| Logos | Rendement mesuré par présence de piste : **99,8 %** quand le signal a un site ou un domaine (498 logos sur 499 signaux tentés), **66,7 %** par le nom d'entreprise seul (317 sur 475). 815 des 974 signaux tentés portent un logo |
| Télémétrie fournisseurs | 579 appels tracés sur 24 h, 99,1 % de succès |

Coût de la journée d'essais : **≈ 6,40 $ Apify** mesurés, 21 crédits Dropcontact.

### Vérification indépendante du 22/08 après-midi

Un agent tiers a rejoué onze contrôles en lecture seule. Résultats retenus :

| Contrôle | Résultat |
|---|---|
| Pagination NewsAPI après correctif | **16/16 requêtes abouties, `pages_failed 0`, aucun 426, toutes les pages suivantes à 1.** 560 articles trouvés, 85 nouveaux |
| Horizon commercial | `signal_expiry_preview` : archiverait **0**, préserverait **597**. La vue confirme la fonction sur des chiffres réels |
| Famine | « JAMAIS DEMANDE » à **0**, attente maximale ramenée de 220 à **51 jours** |
| Crons du 22/08 | `expire-stale-signals` et `sweep-enrichment-famine` présents et actifs |
| Voie Presse | **Aucune requête active silencieuse.** « Internationalisation - Premier bureau étranger », muette depuis le 14/01, est `is_active = false` — extinction volontaire, pas panne |
| Chaînes | Aucune MUETTE ni TUYAU VIDE. Logos à 24 % de rendement, 20 contacts en 12 h |

Ce qui reste non prouvé de ce lot : la ligne `scan_logs` en `completed`.
`fetch-news` n'écrit pas dans `scan_logs` — c'est `run-full-scan`, appelé par le
cron de 16:00 UTC, qui l'ouvre. Le comportement de pagination, lui, est prouvé :
le statut du scan en découle mécaniquement de `pages_failed`.

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

### Corrigé le 22/08 après-midi

**La pagination NewsAPI.** Chaque scan `scan-every-4-hours` se terminait en
`failed` — « Fetch partiel: 1 page(s) en échec » — tout en produisant
normalement ses articles. `computeNextCheckpoint` plafonnait à 10 000 résultats,
limite du plan *Business* ; le compte est sur *Developer*, plafonné à 100. Une
requête sur 28 a ramené une page 1 pleine, le code en a déduit une page 2, et
NewsAPI a répondu 426. La branche d'erreur réécrivant `next_page` sur la page
qui venait d'échouer, le curseur s'est figé : chaque scan retentait la même page
condamnée. Une requête de veille muette 16 heures, une requête gaspillée par
scan sur un budget de 100, et un scan sain affiché en rouge.

Le plafond est désormais une donnée (`newsapi_plan_settings.max_results_per_query`)
et un 426 est traité pour ce qu'il est : une fin de pagination, pas une panne.

**Le plafond Apify.** `monthly_run_limit` valait 200 — en *runs* — quand
`plan_name` annonçait un budget de 200 *dollars*. Les deux unités avaient été
confondues au réglage. Avec 151 runs consommés pour 6,40 $ mesurés, le garde-fou
coupait à ~3 % du budget qu'il devait protéger. Il restait 49 runs, soit ~24
entreprises, pour les neuf derniers jours du mois : l'enrichissement se serait
arrêté en milieu de semaine, proprement et silencieusement. Porté à 600 runs, un
plafond qui tient dans le budget de 200 $ **même sous l'hypothèse de coût la
plus défavorable** (0,165 $/run → ~99 $).

À noter : 301 des 354 événements Apify du mois ne portent aucun coût enregistré.
Le 6,40 $ ne couvre que les 53 événements tarifés — c'est de là que venait
l'écart entre « 53 runs » (événements facturés) et « 151 runs » (autorité de
quota). La télémétrie de coût reste incomplète.

### À surveiller cette semaine

**Le quota Pappers est tendu.** 430,8 crédits consommés sur 500 depuis le
30 juillet, soit **69,2 pour tenir jusqu'au 29 août** à ~9 crédits/jour. Ça
passe, sans marge : un rattrapage ou une journée chargée l'épuise avant la fin
de période, et la détection Pappers s'éteindrait alors en milieu de semaine.
Contrairement au plafond Apify, ce plafond-ci correspond à un abonnement réel —
il ne se relève pas d'un UPDATE.

**`requireInternalAccess` vérifie qu'un rôle existe, jamais lequel.** Ligne 133
de `_shared/internal-auth.ts` : `if (!role) return 403`, puis acceptation. Toute
ligne dans `user_roles`, quelle qu'en soit la valeur, ouvre l'accès aux
fonctions internes — dont `fetch-news`, qui consomme le budget NewsAPI du jour.
Constaté le 22/08 : un appel avec le compte de l'opératrice, rôle `user`, a
abouti.

Sur un outil interne à deux personnes, le risque réel est faible et **la
correction n'a pas été faite délibérément** : toucher à l'authentification la
veille d'une reprise d'activité risque de couper l'accès de l'opératrice le
lundi matin. À reprendre dans un lot dédié. Ce qui est consigné ici, c'est qu'une
fonction nommée `requireInternalAccess` se lit comme plus stricte qu'elle ne
l'est.

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

## 3 · La famine silencieuse — **résolue le 22/08 à 12:45**

Le point le plus insidieux. État initial :

| Situation | Signaux | Attente la plus longue |
|---|---|---|
| **Jamais demandés** — aucun job n'a jamais existé | **225** | **220 jours** |
| Tentés sans résultat | 290 | 219 jours |

`enqueue-enrichment` n'était invoqué que par une action de l'opératrice. **Aucun
cron ne balayait le stock.** Un signal détecté, évalué, jugé à fort potentiel,
mais sur lequel personne n'avait cliqué, attendait indéfiniment — et rien ne le
signalait, puisque aucune tentative n'échouait. Pire qu'une panne : une panne
finit par se voir.

Le blocage n'était pas technique mais budgétaire : vider les 225 coûtait ~65 $
chez Apify et 900 crédits Dropcontact pour un solde de 438.

**Deux décisions d'Alexis l'ont débloqué.**

L'**horizon commercial de 60 jours** a écarté 215 des 225 : un signal de veille
est un événement daté, et féliciter une entreprise pour une levée vieille de
sept mois ferme la conversation plutôt qu'elle ne l'ouvre. Restaient 10 signaux,
soit ~20 runs Apify et ~40 crédits — environ 3 $.

Le **plafond Apify recalibré** (§ 2 bis) a rendu 449 runs disponibles au lieu
de 49.

`sweep_enrichment_famine` balaie désormais chaque jour une dose bornée (5 par
défaut, 25 au maximum), **après vérification des soldes Apify ET Dropcontact**,
en gardant une réserve intouchable de 100 runs et 150 crédits. Le motif de cette
réserve : un signal frais vaut plus qu'un signal de 50 jours, et la capacité de
la semaine ne se prête pas. Sous la réserve, le balayage s'abstient **et le
dit** — il ne dépense pas et n'échoue pas en silence.

État après balayage :

| Situation | Signaux |
|---|---|
| **Jamais demandés** | **0** |
| Tentés sans résultat, dans l'horizon | 215 |

Ces 215 ne se soignent pas en les retentant à l'identique : un job a déjà tourné
sans rien produire. Ils relèvent de la résolution de société (§ 2), pas du
balayage.

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

Ce qui permet désormais de voir sans qu'un humain y pense.

**Une limite à connaître avant de s'en servir :** `enrichment_sweep_readiness`
appelle `apify_actor_run_quota_status`, accordée à `{postgres, service_role,
authenticated}`. Elle répond donc depuis l'application et depuis les crons, mais
échoue pour tout rôle d'introspection tiers — constaté le 22/08 avec le rôle
`sandbox_exec` d'un agent de vérification. Ce n'est pas un défaut à corriger :
élargir le droit affaiblirait la frontière sans bénéfice en production, et
recopier le calcul du quota dans la vue créerait deux sources de vérité qui
divergeraient. Un outil de diagnostic externe doit lire `apify_plan_settings`
et `provider_quota_reservations` directement.

Liste :

- **`pipeline_health`** — le rendement de chaque chaîne sur 24 h, pas son
  activité. Distingue MUETTE (rien ne tourne), TUYAU VIDE (ça tourne, ça ne
  produit rien) et RENDEMENT FAIBLE. C'est la réponse aux deux incidents de la
  semaine, où `cron.job_run_details` affichait « succeeded » pendant que six
  chaînes étaient mortes.
- **`pipeline_health_summary()`** — le même verdict en une ligne, le plus grave
  devant.
- **`personas_health`** — combien de fonctions chaque voie recherche. Une liste
  perdue ou rétrécie ne provoque aucune erreur : elle se voit uniquement ici.
- **`enrichment_backlog`** — ce qui dort, depuis quand, et pourquoi. Borné à
  l'horizon commercial : ne propose plus d'engager une dépense sur une accroche
  morte.
- **`expire_stale_signals(horizon, simulation)`** — l'horizon commercial, avec
  un mode simulation qui compte sans rien modifier. Archive le poids mort,
  **préserve tout signal porteur de contacts** quel que soit son âge, et ne
  réécrit jamais un statut commercial.
- **`sweep_enrichment_famine(dose)`** — le balayage de la famine, qui consulte
  les soldes Apify et Dropcontact avant d'engager quoi que ce soit et s'abstient
  en le disant s'ils passent sous leur réserve.

Ce que ces deux dernières apprennent : un automate qui dépense doit vérifier
avant, et une abstention doit se lire. `drain_enrichment_backlog` reste réservée
à la main humaine — elle ne consulte aucun solde, ce qui est acceptable pour
quelqu'un qui sait ce qu'il engage, et ne l'est pas pour un cron.

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

## 6 bis · Réponses au second audit externe (22/08 soir)

Un audit indépendant (lecture seule sur `f61fcbf` + live) a prononcé quatre
NO-GO. Tous vérifiés dans le code — les huit constats techniques étaient
exacts — puis traités le soir même :

| Constat | Réponse |
|---|---|
| **P0 · L'envoi contournait la vérification** (41 adresses vérifiées sur 4 704, 40 introuvables, bouton actif dès qu'une adresse existe) | Garde `assessOutreachRecipient` dans `send-transactional-email` : fiche contact obligatoire, adresse identique à la fiche, statut `verified` exigé. `not_found` est un mur nommé. 6 contrats Deno l'appellent. Le bouton UI dit désormais « À vérifier » ou « Introuvable » au lieu de promettre |
| **P0 · Emails structurellement faux** (double salutation/signature, lien `-recos` en 404) | Le template n'écrit plus ni salutation ni signature — le corps généré les porte, conformes à la charte et relus par l'opératrice. Le générateur a interdiction d'inventer des URL ; `recoLink` supprimé du code. Graphie unifiée `GOUЯRMET` (le template écrivait `GOURЯMET`) |
| **P1 · « LinkedIn envoyé » sans preuve** | Le statut n'avance qu'après la question « Avez-vous réellement envoyé ? ». Les 49 `linkedin_sent` HISTORIQUES restent des affirmations non prouvées — les corriger serait réécrire le passé ; seuls les nouveaux marquages sont fiables |
| **P1 · Gate mécaniquement rouge** (pipefail + eslint exit 1, 11/11 échecs) | ESLint écrit son rapport en fichier, seul un crash échoue le step (205 recomptées à l'identique en local). `npm ci` validé et adopté, `npm run build` ajouté au gate |
| **P1 · Banc SQL trop indulgent** | Passe 1 (base vierge) désormais STRICTE : tout échec est fatal, hérité compris — une base vide qui ne se reconstruit pas est un plan de reprise inexistant. Et le partage chantier/hérité se fait par date (≥ 2026-08-20), plus par le glob `2026082*` qui aurait classé septembre en « hérité » |
| **P1 · Cron Pappers live ≠ code** | Le live (quotidien) avait raison : 500 crédits/période à ~9/scan ne financent pas une cadence 12 h. Encodé dans `configure_gourrmet_runtime_crons`, job renommé `pappers-scan-daily`, `cron_state` et tableau de bord alignés, contrat qui interdit le retour à 12 h |
| **P1 · Contacts recharge tout toutes les 10 s** | Refetch porté à 60 s, rendu paginé par 60 avec compteur. La virtualisation complète reste un chantier d'interface si le stock décuple |
| **P2 · Récupération de chunks une seule fois par session** | La garde se réarme sur chaque import RÉUSSI — et uniquement là : la réarmer au montage aurait créé une boucle infinie de rechargements sur un déploiement réellement cassé. Error Boundary globale ajoutée (fin de la page blanche muette) |

**Restent côté live, hors de portée du dépôt** : la suppression des trois
fonctions Manus fantômes (`trigger-manus-enrichment`, `check-manus-status`,
`cron-check-manus` — retirées du code au commit `8a623e5` mais toujours
déployées, deux sans JWT) et du secret `MANUS_API_KEY` ; et l'application de la
migration `20260822190000`. Les deux passent par Lovable.

**Le finding « Security Definer View » (5 occurrences), traité.** Les cinq
vues pointées étaient exactement les cinq créées dans les vingt-quatre heures —
les vingt antérieures suivaient toutes la convention `security_invoker`. La
bascule n'était pas un simple ALTER × 5 : `provider_usage_events` est réservée
aux admins, et deux vues la lisaient en direct — en invoker, un opérateur
non-admin aurait vu « appels_fournisseurs : MUETTE » et un solde Dropcontact à
zéro, des chiffres faux sans une erreur. Les agrégats passent désormais par
deux fonctions DEFINER à périmètre étroit (`provider_calls_pulse_24h`,
`latest_dropcontact_credits` — des compteurs, jamais les lignes), et le
contrat 80 rend la convention mécanique : toute future vue definer fera
échouer le banc, et les cinq vues sont testées **dans la peau d'un authentifié
non-admin**, à l'identique de ce que voit postgres.

Au passage, ce contrat a corrigé le banc lui-même : le bootstrap ne répliquait
pas les privilèges par défaut de Supabase (`GRANT ... TO authenticated` sur
les tables, la RLS filtrant ensuite), donc le banc refusait en
« permission denied » ce que la production filtre par policy.

**Vérifié en production le 22/08 au soir**, depuis la session authentifiée de
l'opératrice (non-admin) : 20 vues, zéro en mode definer ; le scan de sécurité
ne remonte plus aucun finding critique ; `pipeline_health` affiche les 646
appels fournisseurs (pas « MUETTE ») et `enrichment_sweep_readiness` lit le
solde Dropcontact réel (424, pas 0). La bascule n'a aveuglé personne.

Restent 7 avertissements non critiques, tous préexistants : `search_path`
mutable sur d'anciennes fonctions, extensions installées dans `public`, et la
protection « mots de passe fuités » désactivée — ce dernier est un réglage du
tableau de bord Supabase (Auth → protection des mots de passe compromis), pas
du code. À reprendre dans le lot sécurité qui accompagnera l'ouverture
multi-utilisateur.

**Constats de l'audit volontairement NON traités ce soir** : la couverture
qualité Presse (0 relecture — c'est un travail d'annotation humaine, pas de
code), le coût par signal non calculable (`provider_cost_rates` vide — chantier
de télémétrie dédié), les 5 doublons de contacts, la restauration jamais testée,
et les policies RLS larges pour `authenticated` (cohérentes avec un outil
interne à deux comptes ; à reprendre AVANT toute ouverture multi-utilisateur).

## 7 · Ce qui appartient à une décision humaine

Ces points ne sont pas des oublis. Ils sont ouverts parce qu'ils engagent un
arbitrage qui n'est pas technique.

1. **Vérifier le domaine chez Resend** — seul geste qui débloque la prospection.
2. **Remplacer l'image du gabarit CHAPON** — décision catalogue.
3. **Purger ou non les enrichissements `lovable_ai`** — supprime aussi des
   contacts.
4. ~~**Vider le backlog des 225**~~ — **tranché le 22/08.** Horizon commercial
   de 60 jours (215 écartés), plafond Apify recalibré, balayage automatique des
   10 restants sous garde-fous fournisseurs. Coût réel : ~3 $ au lieu de 65 $.
   Voir § 3.
5. **Résolution de société par la marque du site** — `chooseCompanySearchQuery`
   est câblée avec un garde-fou : elle ne bascule que sur les libellés
   administratifs de trois mots ou plus. Étendre aux noms courts remonterait les
   contacts du groupe (`gestamp.com` pour PRISMA) plutôt que ceux de
   l'établissement. Choix commercial.
6. **Fusionner les doublons de contacts hérités** — choisir la ligne à garder
   engage ses notes et son historique d'échanges.
7. **Comparer les emails HarvestAPI et Dropcontact** — le mode à 12 $/1000
   existe et le diagnostic compte déjà les profils porteurs d'un email.
