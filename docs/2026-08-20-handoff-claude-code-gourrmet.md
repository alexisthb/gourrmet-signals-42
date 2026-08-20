# Passation autonome — Gourrmet vers Claude Code

**Date :** 20 août 2026

**Destinataire :** Claude Code, Opus 5 UltraCode

**État de départ :** NO-GO local, aucun déploiement live effectué

## Mission terminale

Reprendre le chantier sans rebrief, fermer tous les P0/P1 restants, obtenir un
gate local réellement vert, versionner proprement le travail, puis appliquer le
cutover depuis le projet Lovable connecté. Terminer par l'audit live agrégé
demandé : données et volumes, policies, révision des Edge Functions, crons et
`pg_net`, Vault sans lire les valeurs, quotas/coûts, qualité de résolution,
délivrabilité, sauvegardes et comportement PostgREST au-delà de 1 000 lignes.

Ne jamais déclarer GO à partir d'un build seul. Ne jamais déclencher un scan
payant, un email réel, une restauration ou un appel fournisseur comme smoke
test implicite.

## Décisions produit déjà actées

- Les événements restent éteints ; ils sont retirés de l'UI uniquement.
- Le canal autonome LinkedIn sources/posts/engagers est retiré des routes,
  menus, réglages et documentation visibles.
- LinkedIn/Apify reste un fournisseur interne d'enrichissement de sociétés et
  contacts. Les profils et liens LinkedIn des contacts restent visibles.
- Presse doit couvrir la France entière. Les géozones ne sont qu'un boost de
  priorité, jamais un filtre d'exclusion.
- Toutes les fonctionnalités actives doivent être fiables : signaux, contacts,
  recherches IA, Presse, Pappers, enrichissement et email.
- Resend est le fournisseur de l'outreach commercial. Lovable Email reste
  réservé à l'authentification et au transactionnel non commercial.
- Un coût inconnu reste `NULL`, un dispatch ambigu reste bloqué et visible, et
  aucune mise en file ne doit être présentée comme un succès fournisseur.
- Alexis n'est pas développeur. Ne lui demander ni d'éditer un fichier, ni de
  placer un fragment SQL/JSON. Exécuter soi-même ; si un secret doit être fourni,
  demander uniquement de le copier dans le presse-papier, jamais dans le chat.
- L'accès au projet Lovable a été donné et l'autonomie autorisée. Cela ne
  supprime pas les préflights, la maintenance ni les arrêts fail-closed.

## Dépôt et provenance exacte

```text
Repo        /Users/alexisthobellem/gourrmet-signals-42
Branche     codex/gourrmet-reliability
HEAD        135849fe0b827486d9b6c11c55679616de2a1294
origin/main f4dca95b5cb6ec20d446470001470223080e7e5e
Lovable     projet 71e3e67c-d7d3-4f4f-bf94-f42f632431da
Supabase    ref tzghzftxhxlvliekqiav
```

Commits déjà présents sur la branche :

```text
135849f Retire la source LinkedIn autonome de l interface
99999df Ajoute les contrats de verification du projet
10b91df Plan fiabilisation produit et live Gourrmet
```

### Note de transfert GitHub

Le jeton du Mac n'a pas le scope GitHub `workflow`. La branche distante est
donc publiée comme un snapshot aplati directement sur `origin/main`, en excluant
uniquement `.github/workflows/verify.yml` (absent de `origin/main`). Son SHA
distant diffère volontairement des SHA locaux ci-dessus. Ne chercher ni à
reconstituer ces commits ni à comparer leur histoire : le tree de la branche
distante et ce handoff sont l'autorité de reprise. `npm run verify` reste inclus ;
la CI pourra être ajoutée séparément avec un jeton autorisé.

Le plan écrit avant code est
`docs/plans/2026-08-20-fiabilisation-gourrmet.md`. Il a été commité avant les
modifications sources.

### Garde-fou absolu sur le worktree

Le worktree contient environ 11 800 insertions, 4 300 suppressions, 63 fichiers
suivis modifiés et de nombreux nouveaux fichiers/migrations non suivis. Ces
changements sont le chantier courant, pas des déchets.

**Interdit :** `git reset --hard`, `git checkout -- .`, nettoyage global,
rebase destructif, suppression de `deno.lock`, ou reprise depuis `main`.

Commencer par :

```bash
cd /Users/alexisthobellem/gourrmet-signals-42
git status --short --branch
git diff --check
git log -5 --oneline --decorate
```

Le résultat attendu est la branche `codex/gourrmet-reliability`, HEAD
`135849f`, avec le grand diff non commité intact.

## Ce qui est déjà livré dans le worktree

### Produit et UI

- Événements et acquisition LinkedIn autonome retirés de l'UI.
- Deep-links LinkedIn retombent sur un écran actif.
- Soldes NewsAPI, Pappers et Apify fail-closed : une erreur RPC ne devient plus
  un faux solde plein.
- Réglages fournisseurs et télémétrie honnêtes pour Apify, Dropcontact,
  Perplexity et Lovable AI.
- Listes principales paginées au-delà du plafond PostgREST.

### Presse

- France entière, pagination NewsAPI par 100, round-robin, curseurs et fenêtres
  durables, budget atomique, canonicalisation et déduplication.
- Claim `SKIP LOCKED`, backoff, DLQ, bail/fencing du scan et modèle/prompt
  versionnés.
- Contrat IA strict : compteurs obligatoires et cohérents ; réponse invalide ne
  marque aucun article traité.
- Écriture métier partielle après réponse fournisseur mise en réconciliation,
  sans rappel automatique payant.
- Dernier correctif local : un backlog `retry_waiting`, `in_flight`, DLQ ou
  exhausted ne peut plus être interprété comme « zéro article, scan terminé ».
  Test ciblé : 11/11 ; `deno check analyze-articles` vert.
- Un nouveau signal d'une société déjà enrichie reçoit désormais son propre job
  par `signal_id` ; l'ancien skip par `company_name` a été supprimé.

### Pappers

- Autorité de quota atomique partagée entre scans et `/entreprise`.
- Plans absents, nuls, périmés ou épuisés bloquent réellement le backend.
- Routes et paramètres API rectifiés ; types de publication sans société ne
  fabriquent plus de faux signaux.
- Machine d'état durable, lease rotatif, une page par invocation, handoff et
  recovery cron explicitement activable après Edge compatible.
- Cache de réponse avant traitement ; une fenêtre fournisseur ambiguë est
  `reconciliation_required` et n'est jamais resoumise automatiquement.
- Limite structurelle honnête : Pappers n'offre pas d'idempotency key ni de
  récupération de réponse ; l'exactly-once automatique est impossible après
  envoi et avant cache.

### Résolution et enrichissement

- Résolution société/contact `resolved|ambiguous|rejected`, score explicable,
  provenance et revue humaine instrumentées.
- Mapping HarvestAPI actuel (`actor.name`, `actor.position`) ; plus de
  `undefined undefined`.
- Personas réellement transmis et utilisés.
- Dropcontact corrélé par `custom_fields`, seulement emails nominatifs pro
  acceptés, qualifications rejetées conservées sans stocker l'adresse rejetée.
- Queue claim/fence terminal, jobs réellement `running` jusqu'au terminal,
  reprise Apify/Dropcontact sans doubles soumissions.
- Migration `20260820179000_enrichment_operation_generations.sql` : génération
  durable = id du job, route provider figée, nouvelle génération uniquement
  après terminal connu + action utilisateur + cooldown ; ambiguïtés fail-closed.
- Gate indépendant de ce lot : 53 tests Deno, 8 checks Edge, typecheck et 8
  tests Vitest verts.

### Email

- `queued`, `sent`, `delivered`, `bounced`, `complained`, `replied` séparés.
- Worker Resend idempotent, webhook Svix signé, transitions monotones,
  suppressions bounce/plainte et cohortes legacy exclues des KPI.
- Le contact passe à `email_sent` seulement après acceptation fournisseur via le
  trigger de `20260820172000_operational_kpis.sql`; le funnel CRM est aligné.
- Une panne de tracking empêche le déplacement en DLQ ; erreurs de lecture des
  queues/workers rendent 5xx/partial au lieu d'un faux 200.

### Coûts, quotas, qualité et exploitation

- Ledger fournisseur unifié, intentions `unconfirmed`, tarifs datés et coûts
  par run/signal.
- Apify : quota autoritaire en `actor_runs` et coût exact depuis
  `usageTotalUsd` ; ancien seed fictif neutralisé.
- Dropcontact : dernier `credits_left` observé, avec états
  `current|stale|unavailable|not_started`.
- Tables/vues de qualité Presse et résolution versionnées par modèle/dataset.
- Allowlist d'accès interne et cutover RLS différé/rejouable.
- Runbook de production dans `docs/runbooks/production-readiness.md`.

## État immédiat : NO-GO et P1 ouverts

Le dernier gate contradicteur ne trouve plus de P0, mais les P1 suivants doivent
être fermés avant tout commit final ou live.

## Addendum — audit live reçu de Claude Code

Claude a confirmé en lecture seule que la production sert encore
`f4dca95` et n'a effectué aucune mutation. Conserver ces mesures comme un
snapshot daté, à rafraîchir avant le rapport final :

- 19 signaux Pappers réellement `ready` + `new`, et non 32 ;
- 810 signaux Pappers non transférés, dont 687 âgés de plus de sept jours ;
- 424 visuels générés au total, aucun depuis le 30 juillet ;
- la consigne `PURE WHITE` était déjà présente dans 224 prompts stockés depuis
  le 26 juin : son absence en production n'était pas la cause des logos colorés.

Cause logo encore ouverte dans `generate-gift-image` : la classification par
mots-clés rate `CHAPON BAR À MOUSSE & ESQUIMAU`, classe à tort
`PLANTIN COFFRET TRUFFE` comme chocolat et ne reconnaît l'autre template Chapon
que grâce au mot « moules ». La correction attendue doit partir de la marque
`chapon` et retirer au minimum les faux signaux `truffe`/`praliné`, avec tests de
contrat sur les sept templates réels sans stocker d'image ni appeler le
fournisseur.

Claude a aussi signalé trois requêtes `.in()` trop longues et une lecture
Pappers plafonnée à 1 000. Elles sont **déjà corrigées dans ce worktree local** :

- `PipelineSignalsTab` et `PipelineContactsTab` utilisent `chunkValues(...,100)`
  et vérifient les erreurs ;
- `EnrichmentProgressModal` combine chunks et `collectAllPages` ;
- `usePappers` pagine exhaustivement la jointure `source_name='Pappers'`.

Les revalider par test, mais ne pas réintroduire un deuxième correctif concurrent.

### 1. Machine tonale 1795 incomplète

Une implémentation partielle vient d'être ajoutée dans :

- `supabase/migrations/20260820179500_tonal_charter_analysis_truth.sql`
- `supabase/functions/_shared/lovable-ai-usage.ts`
- `supabase/functions/update-tonal-charter/index.ts`
- `src/hooks/useTonalCharter.ts`

Intention : cohorte stable modèle + IDs de feedback, lease, cache de réponse
avant application, génération manuelle distincte. Elle n'est **pas encore
validée** et conserve quatre défauts :

1. `claim_tonal_charter_analysis` crée directement `dispatching`. Si le ledger
   échoue avant l'INSERT d'intention, aucun POST n'a eu lieu mais l'expiration
   condamne la cohorte en `reconciliation_required`. Ajouter un état `reserved`
   récupérable, puis une transition fenced `reserved -> dispatching/calling`
   uniquement après intention ledger durable. Une expiration `reserved` peut
   être reprise ; seule une expiration `calling` est ambiguë.
2. `onResponseObserved` cache avant la finalisation du ledger. Si la
   finalisation échoue, une reprise peut appliquer la charte avec
   `provider_usage_events` encore `unconfirmed`, `requests_count=0`, `units=0`.
   Avant `complete_tonal_charter_analysis`, exiger le ledger `confirmed` ; si la
   réponse est cachée, finaliser la même ligne depuis le payload/status/token
   observés sans nouveau POST, sinon rester fail-closed.
3. `useResetCharter` supprime les feedbacks puis remet la charte à zéro en deux
   requêtes client. Créer une RPC transactionnelle qui fence/abandonne les runs
   tonals non terminaux, supprime les feedbacks et réinitialise la charte ; l'UI
   ne doit appeler que cette RPC.
4. `save-message-feedback` ignore encore des erreurs de `count`/UPDATE et
   déclenche uniquement sur `count % 5 === 0`. Deux inserts concurrents peuvent
   sauter le seuil. Vérifier chaque erreur et déclencher quand il existe au moins
   cinq feedbacks nouveaux depuis la dernière cohorte/charte ; la claim 1795
   déduplique les appels concurrents.

La migration doit rester rejouable, service-only, avec `search_path` fixé,
fencing sur toutes les mutations et procédure explicite de réconciliation.

### 2. Runbook incomplet

`docs/runbooks/production-readiness.md` a déjà été corrigé pour :

- vider les queues email avant de couper l'ancien worker ;
- déployer `process-email-queue` avant `send-transactional-email` ;
- ordonner `run-full-scan` avant `analyze-articles` ;
- inclure 1790 ;
- activer les crons par domaines indépendants au lieu de couper l'email si un
  quota d'acquisition manque.

Il reste à :

- inclure `20260820179500_tonal_charter_analysis_truth.sql` dans l'ordre ;
- ajouter au readiness les RPC 1790 au minimum :
  `bind_enrichment_job_route`, `enqueue_enrichment_job_authorized`,
  `begin_enrichment_dispatch` ;
- ajouter les table/RPC 1795 finales ;
- corriger la matrice d'activation : route `linkedin` = Apify + Dropcontact ;
  route `waterfall` = Pappers + Dropcontact. Ne pas exiger Apify pour waterfall ;
- documenter les réconciliations `provider_dispatch_uncertainty`, réservations
  NewsAPI/Pappers ambiguës, DLQ Presse et runs tonals. Ne jamais marquer
  « no charge » sans preuve fournisseur.

### 3. Contrat TypeScript Supabase incomplet

Synchroniser `src/integrations/supabase/types.ts` après stabilisation SQL. Le
fichier est déjà fortement enrichi mais il manque encore au moins les objets de
`1775` signalés avant la dernière passe :

- table `pappers_request_cache` ;
- `pappers_scan_progress.execution_snapshot` ;
- RPC `pappers_execution_snapshot`, `pappers_scan_has_ambiguous_request`,
  `recover_pappers_scan`, `handoff_pappers_scan`,
  `mark_pappers_request_dispatched`, `complete_pappers_search_request`.

Ajouter également la signature actuelle
`configure_gourrmet_runtime_crons(boolean,text[])`, tous les objets 1790 et les
objets 1795 finaux. Retirer tout cast `(rpc as any)` devenu inutile.

### 4. Fonction de crons par domaines à contre-vérifier

`20260820178500_provider_dispatch_truth.sql` vient d'être modifiée :

```sql
configure_gourrmet_runtime_crons(boolean, text[])
```

Domaines autorisés : `email`, `enrichment`, `logos`, `press`, `pappers`.
Chaque appel ne désactive/réactive que ses propres jobs. Revoir statiquement la
syntaxe PL/pgSQL, l'idempotence, les signatures REVOKE/GRANT, la sélection des
jobs et les attentes du runbook. Aucun PostgreSQL local n'a encore exécuté ce
SQL.

### 5. Le gate contradicteur doit être rejoué

Les derniers correctifs ont été écrits pendant le gate. Il faut reprendre une
passe complète du diff, pas seulement vérifier les quatre points connus.
Chercher prioritairement : faux succès, kill/retry, fenêtres POST -> preuve,
double coût, leases expirés, mismatch Edge/SQL/types, plafond PostgREST,
activation live et métriques qui excluent les échecs.

## Ordre de reprise recommandé

1. Lire ce handoff, le plan et le runbook. Ne toucher ni au live ni aux
   fournisseurs.
2. Stabiliser 1795 et ses tests rouges puis verts.
3. Corriger `save-message-feedback` et le reset transactionnel.
4. Mettre à jour runbook + readiness jusqu'à 1795.
5. Synchroniser intégralement `types.ts` avec 1775–1795.
6. Refaire le gate P0/P1 Edge + SQL + produit.
7. Lancer toutes les validations ci-dessous.
8. Découper le grand diff en commits cohérents sans perdre une ligne, pousser la
   branche, ouvrir/merger la PR seulement après gate vert.
9. Faire le préflight live agrégé puis le cutover Lovable exactement selon le
   runbook. Laisser chaque domaine fournisseur non prouvé arrêté.
10. Rendre l'audit live final avec mesures, inconnues explicites et verdict.

## Validation locale obligatoire

Charger le runtime Deno fourni par l'environnement si `deno` n'est pas dans le
PATH, puis exécuter :

```bash
cd /Users/alexisthobellem/gourrmet-signals-42
npm run verify
find supabase/functions -name index.ts -print0 | \
  xargs -0 -n1 deno check --frozen --lock=deno.lock
npm run lint
git diff --check
```

Résultat attendu : typecheck, Vitest, tous les tests Edge, build et tous les
`deno check` verts. Pour lint, comparer au baseline historique documenté de 206
erreurs et 14 warnings : aucune nouvelle erreur n'est acceptable ; l'objectif
reste de réduire le total. Relancer aussi `npm audit` et qualifier précisément
les vulnérabilités, sans mise à jour majeure aveugle.

Contrôles supplémentaires :

```bash
find supabase/migrations -maxdepth 1 -type f -printf '%f\n' | \
  cut -d_ -f1 | sort | uniq -d
git grep -nE '(service_role|api[_-]?key|secret).{0,30}(=|:).{8,}' -- \
  ':!package-lock.json' ':!docs/2026-08-20-handoff-claude-code-gourrmet.md'
```

Le premier contrôle ne doit imprimer aucun timestamp dupliqué. Le second est
une alerte à examiner, pas une preuve automatique de fuite. Ne jamais afficher
la valeur d'un secret live.

## Cutover Lovable : règles non négociables

- Aucun SQL live tant que le gate local est NO-GO.
- Vérifier d'abord la présence d'un backup Lovable récent, sans restauration.
- Maintenance sans utilisateur ; drainer les queues avec l'ancien worker avant
  de le couper ; attendre les runs en vol.
- Appliquer les deux fondations antidatées explicitement, puis toutes les
  migrations 20260820 dans l'ordre lexical jusqu'à la dernière stabilisée.
- SQL complet avant Edge, crons tous arrêtés.
- Déployer les Edge dans l'ordre du runbook.
- Configurer l'allowlist puis appliquer le cutover RLS seulement avec au moins
  un admin approuvé existant.
- Prouver les plans/soldes depuis contrats, API ou factures. Une absence reste
  zéro/bloquée ; ne rien inventer.
- Activer email/logos indépendamment. N'activer Presse, Pappers ou
  enrichissement que si leur route et leurs fournisseurs sont prêts.
- Smoke tests sans coût et sans envoi uniquement.
- Comparer ensuite révisions Git/Edge, policies, fonctions, jobs, historique
  `pg_net`, Vault par noms, ledgers et métriques agrégées.

## Ce qui n'a jamais été fait dans cette session

- Aucune migration live.
- Aucun déploiement Edge live.
- Aucun appel payant NewsAPI, Pappers, Apify, Dropcontact, Perplexity ou Lovable.
- Aucun email Resend/Lovable envoyé.
- Aucun compte créé et aucune donnée personnelle lue.
- Aucun secret affiché.
- Aucun restore, suppression ou mutation de sauvegarde.

## Critère de sortie

La tâche est terminée uniquement si :

1. aucun P0/P1 local ne subsiste ;
2. tous les tests/contrats passent ;
3. migrations, Edge, types et runbook décrivent la même révision ;
4. le live a été appliqué depuis Lovable avec les domaines admissibles ;
5. les fonctions/jobs/policies déployés correspondent au Git mergé ;
6. les coûts, taux et soldes non mesurables restent explicitement `NULL` ou
   `non mesuré` ;
7. l'audit live final sépare preuve, hypothèse et décision produit.
