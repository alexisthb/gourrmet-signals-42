# Exploitation et mise en production Gourrmet

Ce runbook couvre le périmètre actif : Presse, Pappers, résolution de sociétés
et contacts, puis outreach email. Les événements et le canal LinkedIn autonome
restent éteints. LinkedIn reste un fournisseur interne d'enrichissement.

## Règles de vérité

- `queued` signifie uniquement « mis en file » ; `sent` signifie que le
  fournisseur a accepté le message ; `delivered`, `bounced` et `complained`
  viennent d'un webhook signé.
- Un article Presse n'est `processed` qu'après une réponse IA valide et toutes
  les écritures attendues. Un claim échoué redevient disponible pour reprise.
- Un job d'enrichissement asynchrone reste `running` jusqu'au résultat terminal
  observé chez Apify/Dropcontact.
- Un coût inconnu reste `NULL`. Il ne doit jamais être remplacé par zéro.
- Une précision, un rappel ou une accuracy sans corpus relu reste `NULL`.

## Avant chaque déploiement

1. Travailler depuis la branche et le SHA annoncés, puis exécuter `npm run verify`
   ET `npm run test:sql`.

   `npm run test:sql` applique les 121 migrations sur un PostgreSQL éphémère,
   les rejoue, puis exécute les tests de contrat tonaux et cron. Ce banc a été
   ajouté après avoir découvert que ces migrations n'avaient jamais été
   exécutées par aucun PostgreSQL : sa première exécution a trouvé trois échecs
   durs qui auraient interrompu le cutover en plein milieu. Ne jamais appliquer
   du SQL live sans qu'il soit vert.

   Limites connues du banc, à ne pas confondre avec une validation complète :
   pg_cron, pg_net, pgmq et supabase_vault y sont des doublures (leur
   comportement runtime n'est donc pas testé), il tourne sur PostgreSQL 16 quand
   la production est en 17, et les migrations héritées d'avant le chantier ne
   sont pas idempotentes — seules les `20260820*` doivent passer les deux passes.
2. Ouvrir une fenêtre de maintenance sans utilisateur actif. Tant que
   l'ancienne révision est encore déployée, laisser d'abord son worker email
   vider les deux files. Cette requête doit retourner deux fois `true` :

   ```sql
   select
     (select count(*) from pgmq.q_auth_emails) = 0 as auth_email_queue_empty,
     (select count(*) from pgmq.q_transactional_emails) = 0 as transactional_email_queue_empty;
   ```

   Si une file ne se vide pas, arrêter le cutover et diagnostiquer l'ancien
   worker ; ne pas désactiver son cron en espérant que la file se résorbe seule.
   Une fois les deux files vides et le site toujours sans écriture, arrêter tous
   les crons concernés, attendre la fin des invocations déjà parties, puis
   contrôler à nouveau les files et les runs :

   ```sql
   select cron.unschedule(jobid)
   from cron.job
   where jobname in (
     'enrichment-worker-tick', 'cron-check-linkedin-enrich-tick',
     'auto-fetch-logos-tick', 'scan-every-4-hours', 'process-email-queue',
     'daily-pappers-anniversary-scan', 'pappers-scan-every-12h',
     'pappers-recovery-every-minute'
   );

   select
     (select count(*) from pgmq.q_auth_emails) = 0 as auth_email_queue_empty,
     (select count(*) from pgmq.q_transactional_emails) = 0 as transactional_email_queue_empty,
     not exists (
       select 1 from public.enrichment_jobs where status = 'running'
     ) as enrichment_workers_quiescent,
     not exists (
       select 1 from public.company_enrichment
       where status in ('linkedin_processing', 'dropcontact_processing')
     ) as async_enrichment_quiescent,
     not exists (
       select 1 from public.pappers_scan_progress where status in ('pending', 'running')
     ) as pappers_workers_quiescent,
     not exists (
       select 1 from public.scan_logs where status = 'running'
     ) as press_scans_quiescent;

   select count(*) = 0 as runtime_crons_disabled
   from cron.job
   where jobname in (
     'enrichment-worker-tick', 'cron-check-linkedin-enrich-tick',
     'auto-fetch-logos-tick', 'scan-every-4-hours', 'process-email-queue',
     'daily-pappers-anniversary-scan', 'pappers-scan-every-12h',
     'pappers-recovery-every-minute'
   );
   ```

   Après au moins une minute sans cron, les six premiers booléens et
   `runtime_crons_disabled` doivent tous être
   `true`. Sinon, ne pas migrer : réactiver consciemment l'ancienne révision si
   elle doit encore drainer une file, ou réconcilier manuellement la tâche avec
   le fournisseur. La migration
   `1710` refusera elle-même tout enrichissement async orphelin plutôt que de le
   rendre irrécupérable.
3. Dans l'éditeur SQL du projet Lovable, appliquer explicitement les deux
   fondations ajoutées avant l'historique déjà déployé :
   `20260112000000_geo_zones_foundation.sql`, puis
   `20260118180000_pappers_runtime_foundation.sql`. Une sélection fondée
   uniquement sur « les migrations plus récentes que la dernière migration
   live » les ignorerait. Ne pas rejouer les autres anciennes migrations.
4. Appliquer ensuite, toujours depuis Lovable, toutes les migrations
   `20260820*.sql` dans l'ordre lexical, jusqu'à
   `20260820179500_tonal_charter_analysis_truth.sql` inclus — donc `1780`,
   `1785`, `1790`, puis `1795`. Avant `1775`,
   vérifier qu'aucun scan Pappers n'est `pending` ou `running`. Cette migration
   retire le cron de recovery s'il existait et ne le recrée pas : il doit rester
   absent pendant tout le cutover Edge. Les migrations `1700` et `1785` laissent
   également les six crons runtime arrêtés. Toute la chaîne SQL doit être terminée
   avant de déployer la nouvelle révision des Edge Functions ; les fonctions de
   file et de mesure utilisent le schéma final.

   Juste avant d'appliquer `1775`, cette requête doit retourner `true` :

   ```sql
   select count(*) = 0 as pappers_workers_quiescent
   from public.pappers_scan_progress
   where status in ('pending', 'running');
   ```

   Si elle retourne `false`, ouvrir l'écran Pappers, mettre le scan actif en
   pause, puis relancer exactement cette requête avant de continuer.

   Toujours avant `1775`, neutraliser une éventuelle activation issue d'un essai
   antérieur, puis vérifier que le cron recovery est absent :

   ```sql
   select cron.unschedule(jobid)
   from cron.job
   where jobname = 'pappers-recovery-every-minute';

   select count(*) = 0 as pappers_recovery_cron_disabled
   from cron.job
   where jobname = 'pappers-recovery-every-minute';
   ```

   La seconde requête doit retourner `true`. Aucun cron recovery Pappers ne doit
   être actif entre ce point et l'étape 9.

   Une fois toute la chaîne SQL appliquée, contrôler que le schéma live porte
   réellement les objets des trois derniers lots. Chaque ligne doit retourner
   `true` ; une seule ligne `false` signifie qu'une migration a été sautée ou a
   échoué en silence, et interdit de déployer les Edge :

   ```sql
   select
     -- 1775 : continuation durable Pappers
     to_regclass('public.pappers_request_cache') is not null as t_pappers_request_cache,
     exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='pappers_scan_progress'
         and column_name='execution_snapshot') as c_execution_snapshot,
     to_regprocedure('public.pappers_execution_snapshot(uuid)') is not null as f_1775_snapshot,
     to_regprocedure('public.pappers_scan_has_ambiguous_request(uuid)') is not null as f_1775_ambiguous,
     to_regprocedure('public.recover_pappers_scan(integer)') is not null as f_1775_recover,
     to_regprocedure('public.handoff_pappers_scan(uuid,uuid,integer)') is not null as f_1775_handoff,
     -- 1790 : générations d'opérations d'enrichissement
     to_regprocedure('public.bind_enrichment_job_route(uuid,uuid,text)') is not null as f_1790_bind,
     to_regprocedure('public.begin_enrichment_dispatch(uuid,uuid,uuid,text,text)') is not null as f_1790_dispatch,
     to_regprocedure('public.enqueue_enrichment_job_authorized(uuid,text,integer,integer,boolean)')
       is not null as f_1790_enqueue,
     -- 1795 : machine tonale
     to_regclass('public.tonal_charter_analysis_runs') is not null as t_tonal_runs,
     to_regprocedure('public.begin_tonal_charter_dispatch(uuid,uuid,text,integer)') is not null as f_1795_seal,
     to_regprocedure('public.sync_tonal_charter_feedback_state(integer)') is not null as f_1795_feedback,
     to_regprocedure('public.reset_tonal_charter()') is not null as f_1795_reset,
     -- 1785 : signature à deux arguments, la version à un seul est retirée
     to_regprocedure('public.configure_gourrmet_runtime_crons(boolean,text[])') is not null as f_crons_domains;
   ```

   Ces signatures ont été relevées sur un schéma réellement construit depuis les
   migrations, pas déduites du texte des fichiers. Si l'une d'elles évolue,
   corriger ce bloc en même temps que la migration.

   Contrôler enfin que la machine tonale démarre bien en `reserved` et non en
   `dispatching` — c'est la différence entre « jamais appelé » et « peut-être
   facturé » :

   ```sql
   select conname, pg_get_constraintdef(oid) as definition
   from pg_constraint
   where conrelid = 'public.tonal_charter_analysis_runs'::regclass
     and conname = 'tonal_charter_analysis_status_valid';
   ```

   La définition doit contenir `reserved`.
5. Dans Lovable, contrôler les noms de secrets sans afficher leur valeur :
   `NEWSAPI_KEY`, `PAPPERS_API_KEY`, `APIFY_API_KEY`,
   `DROPCONTACT_API_KEY`, `PERPLEXITY_API_KEY`, `LOVABLE_API_KEY`,
   `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` et
   `SUPABASE_SERVICE_ROLE_KEY`.
6. Dans Vault, contrôler uniquement la présence de `service_role_key`. Les
   jobs SQL utilisent ce secret pour appeler les Edge Functions avec JWT.
   Si ce secret n'existait pas au passage des migrations de planification,
   rejouer leurs blocs `cron.schedule` depuis Lovable : une planification
   sautée ne se recrée pas automatiquement. Ne jamais rejouer un bloc cron brut :
   utiliser uniquement les deux fonctions d'activation de l'étape 9.
7. Les migrations peuvent être appliquées groupées : si l'allowlist est vide,
   le cutover RLS est explicitement différé. Remplir ensuite
   `internal_access_allowlist` depuis Lovable avec les seuls comptes
   propriétaires approuvés, dont au moins un `admin` ou `super_admin`, puis
   exécuter `select public.apply_internal_access_cutover();`. Aucun identifiant
   de compte ne doit être commité dans Git.
8. Appliquer tous les changements de base exclusivement depuis le projet
   Lovable associé, puis déployer depuis la même révision Git, crons toujours
   arrêtés. Ordre contractuel : `process-email-queue`, puis
   `send-transactional-email` (les deux queues doivent être vides) ; les deux
   fonctions d'enrichissement, le poller, puis `enrichment-worker` ;
   `fetch-pappers`, puis `run-pappers-scan` ; pour Presse,
   `run-full-scan` avant `analyze-articles` (le nouveau caller sait encore parler
   à l'ancienne cible, l'inverse non), puis `fetch-news` et les autres Edge.
   Ne jamais remettre le site en écriture ni déployer les fonctions avant la fin
   de l'étape 4.
9. Seulement après confirmation que toutes ces Edge servent la nouvelle révision,
   vérifier les trois autorités de quota :

   ```sql
   select public.get_pappers_quota_status();
   select public.newsapi_quota_status(
     (select daily_requests from public.newsapi_plan_settings), now()
   );
   select public.apify_actor_run_quota_status(now());
   ```

   Pappers doit avoir `source=configured_and_metered`, NewsAPI une limite et un
   restant mesurés, et Apify `configured=true`, `unit=actor_runs`, une période
   courante et un restant positif. Ces valeurs doivent venir d'un contrat ou
   d'une facture. Un fournisseur non prouvé garde uniquement son propre domaine
   arrêté ; il ne doit jamais couper l'email ou les logos.

   Activer d'abord les deux domaines indépendants :

   ```sql
   select public.configure_gourrmet_runtime_crons(
     true, array['email', 'logos']::text[]
   );
   ```

   Le résultat doit contenir `"status":"scheduled"`, `"enabled":true` et
   `"scheduled_jobs":2`.

   Activer ensuite chaque acquisition dont l'autorité est réellement valide :

   ```sql
   -- Enrichissement : les fournisseurs à prouver dépendent de la ROUTE active,
   -- et d'elle seule.
   --   route `linkedin`  -> Apify + Dropcontact valides. Pappers non requis.
   --   route `waterfall` -> Pappers + Dropcontact valides. Apify NON requis :
   --                        exiger Apify ici bloquerait un enrichissement qui
   --                        ne l'appelle jamais.
   -- Dropcontact est requis dans les deux cas ; ses secrets doivent exister.
   select public.configure_gourrmet_runtime_crons(
     true, array['enrichment']::text[]
   );

   -- Seulement si NewsAPI est valide et les secrets IA Presse existent.
   select public.configure_gourrmet_runtime_crons(
     true, array['press']::text[]
   );

   -- Seulement si Pappers est valide.
   select public.configure_gourrmet_runtime_crons(
     true, array['pappers']::text[]
   );
   select public.configure_pappers_recovery_cron(true);
   ```

   Les résultats doivent tous contenir `"status":"scheduled"` et
   `"enabled":true`. `enrichment` annonce deux jobs ; `press` et `pappers` un
   chacun. Le recovery Pappers n'est activé qu'avec son domaine. Vérifier ensuite
   une seule ligne active pour chaque nom effectivement activé :

   ```sql
   select jobname, count(*) as active_jobs
   from cron.job
   where jobname in (
     'enrichment-worker-tick', 'cron-check-linkedin-enrich-tick',
     'auto-fetch-logos-tick', 'scan-every-4-hours', 'process-email-queue',
     'pappers-scan-every-12h', 'pappers-recovery-every-minute'
   ) and active
   group by jobname
   order by jobname;
   ```

   Si tous les fournisseurs sont valides, la requête retourne exactement sept
   lignes, toutes avec `active_jobs = 1`. En activation partielle, elle retourne
   uniquement les jobs des domaines autorisés : email et logos doivent rester
   présents même si une acquisition est bloquée. Toute ligne dupliquée ou tout
   domaine non autorisé impose de neutraliser avec
   `select public.configure_gourrmet_runtime_crons(false, null);` puis
   `select public.configure_pappers_recovery_cron(false);` et d'arrêter le
   déploiement.

Le préflight doit confirmer que chaque compte approuvé existe et qu'au moins un
admin actif a été désigné :

```sql
select
  count(*) filter (where allowlist.enabled) as approved_accounts,
  count(*) filter (
    where allowlist.enabled and allowlist.role in ('admin', 'super_admin')
  ) as approved_admins,
  count(*) filter (where allowlist.enabled and account.id is null) as missing_accounts
from public.internal_access_allowlist as allowlist
left join auth.users as account on account.id = allowlist.user_id;
```

Si `approved_accounts` ou `approved_admins` vaut zéro, ou si `missing_accounts`
n'est pas zéro, ne pas appeler la procédure de cutover. Elle refusera toute
activation partielle et peut être rejouée après correction de l'allowlist.

Avant tout déploiement Edge, ce contrôle post-migrations doit retourner
uniquement `true`. Il prouve que les deux fondations antidatées et les contrats
finaux ont réellement été créés dans la base ciblée, indépendamment de l'ordre
affiché dans l'historique Lovable :

```sql
select
  to_regclass('public.geo_zones') is not null as geo_zones_ready,
  to_regclass('public.pappers_plan_settings') is not null as pappers_plan_ready,
  to_regclass('public.pappers_scan_progress') is not null as pappers_runtime_ready,
  to_regclass('public.pappers_request_cache') is not null as pappers_cache_ready,
  to_regprocedure('public.recover_pappers_scan(integer)') is not null as pappers_recovery_rpc_ready,
  to_regprocedure('public.configure_pappers_recovery_cron(boolean)') is not null as pappers_cron_switch_ready,
  to_regprocedure('public.configure_gourrmet_runtime_crons(boolean,text[])') is not null as runtime_cron_switch_ready,
  to_regprocedure('public.get_pappers_quota_status()') is not null as pappers_quota_status_ready,
  not exists (
    select 1 from cron.job where jobname = 'pappers-recovery-every-minute'
  ) as pappers_recovery_disabled_during_cutover,
  to_regclass('public.provider_usage_events') is not null as provider_ledger_ready,
  to_regclass('public.provider_dispatch_uncertainty') is not null as provider_dispatch_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_usage_events'
      and column_name = 'dispatch_status'
  ) as provider_dispatch_column_ready,
  to_regclass('public.provider_signal_cost_metrics') is not null as signal_cost_ready,
  to_regclass('public.dropcontact_balance_metrics') is not null as dropcontact_balance_ready,
  to_regprocedure('public.apify_actor_run_quota_status(timestamptz)') is not null as apify_quota_status_ready,
  to_regprocedure('public.reserve_apify_actor_run(text,text,uuid,uuid,jsonb)') is not null as apify_quota_reserve_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'apify_plan_settings'
      and column_name = 'monthly_run_limit'
  ) as apify_run_limit_ready,
  to_regclass('public.internal_access_allowlist') is not null as allowlist_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'raw_articles'
      and column_name = 'dead_lettered_at'
  ) as press_dlq_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scan_logs'
      and column_name = 'lease_token'
  ) as press_fencing_ready;
```

## Configuration des fournisseurs

Les plans et tarifs ne doivent être renseignés qu'à partir du contrat, de
l'API fournisseur ou d'une facture. Pappers et NewsAPI restent non configurés
avec une limite à zéro tant que cette preuve manque. Chaque tarif daté va dans
`provider_cost_rates` avec sa devise, sa source et une preuve JSON non secrète.

Le plafond Apify est exprimé en `actor_runs`, seule unité autoritaire disponible
pour ces appels. Renseigner `monthly_run_limit` et la période depuis une preuve
contractuelle ; `monthly_credits` est historique et n'autorise aucun POST. Le
seed `Starter/5000` intact est neutralisé et un plafond nul, absent ou périmé
bloque le backend.

Resend est réservé à `outreach-message`. Lovable Email reste réservé à
l'authentification et aux autres messages transactionnels. Configurer chez
Resend le webhook suivant :

```text
https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/resend-webhook
```

Événements requis : `email.sent`, `email.delivered`, `email.failed`,
`email.bounced` et `email.complained`. Une adresse en bounce ou plainte est
ajoutée aux suppressions. L'absence du secret de webhook doit provoquer un
échec fermé, jamais accepter un événement non signé.

## Contrôle live agrégé

Les requêtes suivantes ne lisent ni contenu d'email, ni identité, ni secret :

```sql
select * from public.provider_usage_daily_metrics
order by usage_date desc, provider, operation;

select * from public.acquisition_run_cost_metrics
order by started_at desc limit 50;

select * from public.provider_signal_cost_status(null)
order by signal_id, provider;

select public.apify_actor_run_quota_status(now());

select public.dropcontact_balance_status();

select provider, operation, count(*) as unresolved_dispatches
from public.provider_dispatch_uncertainty
group by provider, operation
order by provider, operation;

select * from public.enrichment_resolution_metrics;
select * from public.email_delivery_metrics;
select * from public.press_detection_quality_metrics;

select jobid, jobname, schedule, active
from cron.job order by jobname;

select status, count(*)
from cron.job_run_details
where start_time >= now() - interval '7 days'
group by status;

select status_code, count(*)
from net._http_response
where created >= now() - interval '7 days'
group by status_code;

select name, created_at, updated_at
from vault.decrypted_secrets
order by name;
```

La dernière requête ne doit jamais sélectionner `decrypted_secret`. Les vues
de coût retournent `fully_priced=false` et un coût `NULL` dès qu'un appel n'a
pas de tarif fiable. Les taux de résolution sont des taux opérationnels ; les
colonnes `*_labelled_accuracy` seules mesurent une justesse relue.

Pour Apify, `actor_run_cost` fige le champ fournisseur `usageTotalUsd` au moins
dix secondes après la fin de la run. `measured_cost` expose cette part prouvée ;
`total_cost` reste `NULL` tant que la recherche société synchrone n'a pas de run
identifiable ou qu'un autre événement demeure non tarifé. La borne de mesure
Apify commence au premier événement `actor_run_cost`, pas à l'application de la
migration. Le plafond compte séparément les exécutions historiques observées avant le
cutover et les réservations atomiques après cutover ; une réservation ambiguë
reste comptée et ne doit pas être expirée sans preuve fournisseur.

Pour Dropcontact, le statut agrégé conserve le dernier `credits_left` réellement
présent dans un payload v1. `current` signifie que le dernier appel portait ce
champ ; `stale` qu'un solde antérieur existe mais que le dernier payload ne le
portait pas ; `unavailable` qu'aucun solde valide n'a encore été observé. Le
solde reste `NULL` plutôt que d'être reconstruit à partir des emails trouvés.
Une soumission écrit d'abord une intention `unconfirmed` avec une clé métier
stable, puis finalise cette même ligne après réponse. Toute intention sans
`provider_request_id` exige une réconciliation manuelle et interdit une seconde
soumission payante.

Perplexity et Lovable AI conservent le nombre exact de tokens uniquement quand
le fournisseur le renvoie. Les appels dont le payload ne contient aucun total
restent des requêtes mesurées avec zéro token et un marqueur
`tokens_not_returned`; ils doivent être comptés séparément. Aucun solde de
compte, crédit Workspace ou coût monétaire n'est déduit de ces tokens.

## Réconciliations en attente

Une réconciliation n'est jamais un incident technique à effacer : c'est un
appel dont on ignore s'il a été facturé. La règle est unique et sans exception :
**ne jamais marquer « no charge » sans preuve fournisseur** — une facture, une
réponse d'API, ou une ligne de contrat. En l'absence de preuve, l'état reste
bloqué et visible.

Quatre familles à relever à chaque contrôle :

1. **Dispatches fournisseur ambigus** — `provider_dispatch_uncertainty` liste
   les intentions restées `unconfirmed` : le POST a pu partir sans que la
   réponse revienne. Aucune resoumission automatique n'est autorisée.

   ```sql
   select provider, operation, request_key, occurred_at
   from public.provider_dispatch_uncertainty
   order by occurred_at desc;
   ```

   Résolution : confronter `request_key` au journal du fournisseur. Si l'appel a
   eu lieu, finaliser la ligne existante depuis les valeurs observées. S'il n'a
   pas eu lieu et que le fournisseur le confirme, passer la ligne en
   `reconciled_no_charge` — jamais autrement.

2. **Réservations NewsAPI et Pappers ambiguës** — une fenêtre réservée dont la
   réponse n'est jamais revenue. Pappers n'offre ni clé d'idempotence ni
   récupération de réponse : après envoi et avant mise en cache, l'exactly-once
   automatique est structurellement impossible. Ces fenêtres restent en
   `reconciliation_required` et ne sont rejouées que sur décision humaine.

   ```sql
   select id, scan_type, status, error_message
   from public.pappers_scan_progress
   where status = 'reconciliation_required';

   select public.pappers_scan_has_ambiguous_request(id)
   from public.pappers_scan_progress
   where status in ('pending', 'running');
   ```

3. **DLQ Presse** — les articles dont l'analyse ou l'écriture a échoué. Un
   backlog en `retry_waiting`, `in_flight`, DLQ ou épuisé n'est jamais un scan
   terminé à zéro article.

   ```sql
   select ready, in_flight, retry_waiting, dead_lettered, exhausted_orphan,
          max_attempt_count, next_retry_at, measured_at
   from public.press_article_backlog_metrics;
   ```

   `dead_lettered` et `exhausted_orphan` non nuls exigent un arbitrage avant
   toute relance : ces articles ont déjà consommé des tentatives payantes.

4. **Runs tonals** — la machine 1795 distingue deux expirations, et cette
   distinction porte toute la sécurité de coût :

   - `reserved` expiré : aucune intention durable n'a été écrite, donc aucun
     appel n'a pu partir. La cohorte est simplement reprise, avec une tentative
     incrémentée et une clé fournisseur neuve.
   - `dispatching` expiré : l'intention est durable, le POST a pu partir. La
     cohorte passe en `reconciliation_required` et n'est jamais rejouée seule.

   ```sql
   select id, cohort_key, status, attempt, provider_request_key, error_message
   from public.tonal_charter_analysis_runs
   where status in ('reconciliation_required', 'dispatching')
   order by updated_at desc;
   ```

   Résolution : confronter `provider_request_key` au ledger. Si la dépense est
   confirmée et la réponse en cache, relancer `update-tonal-charter` — il
   finalise depuis la réponse observée sans nouveau POST. Une charte n'est jamais
   appliquée au-dessus d'un ledger `unconfirmed` : la RPC refuse avec le motif
   `ledger_unconfirmed`.

   Un `reset_tonal_charter` déclenché pendant qu'un run est en vol envoie ce run
   en `reconciliation_required` et non en `abandoned`, pour la même raison.

Les intentions non confirmées laissées par des réservations tonales expirées
sont des traces honnêtes, pas des déchets : elles se relèvent dans
`provider_usage_events` avec `dispatch_status = 'unconfirmed'` et
`requests_count = 0`, et se soldent par la procédure 1 ci-dessus.

## PostgREST au-delà de 1 000 lignes

Les listes frontales parcourent désormais des fenêtres explicites via
`Range`. Toute nouvelle lecture exhaustive doit utiliser le même helper et
s'arrêter uniquement sur une page vide : PostgREST peut imposer un plafond
serveur inférieur à la fenêtre demandée, donc une page partielle ne prouve pas
la fin du résultat.
Une limite volontaire (`limit`) est acceptable pour un worker borné, à
condition de ne pas être présentée comme un total. Les agrégats utilisent
`count: exact` avec `head: true`.

## Sauvegardes et reprise

Pour Lovable Cloud, la documentation annonce un snapshot quotidien conservé
jusqu'à environ quatorze jours et une restauration en place en quelques
minutes. Ce n'est ni un PITR, ni un RPO/RTO contractuel. Les objets Storage ne
sont pas inclus. L'export Cloud est limité à un par jour et 5 Go ; il ne couvre
pas Storage, les secrets ni le code Edge.

Objectif d'exploitation proposé, à confirmer après un exercice : RPO 24 h et
RTO 4 h pour la base. Il exige en plus un export séparé et chiffré de Storage,
du code et de l'inventaire des secrets. Une fois par trimestre : restaurer sur
un environnement isolé, neutraliser `pg_cron`/`pg_net`, vérifier les comptes,
les contraintes, les files et un échantillon agrégé, puis mesurer la durée.
Ne jamais tester une restauration directement sur la production.

Sources officielles :

- [Lovable Cloud database](https://docs.lovable.dev/features/database)
- [Lovable advanced settings](https://docs.lovable.dev/features/advanced-settings)
- [Lovable support policy](https://docs.lovable.dev/introduction/support-policy)

## Smoke tests sans coût ni envoi

- Ouvrir les écrans Presse, Pappers, Contacts et Réglages ; vérifier l'absence
  de routes ou cartes LinkedIn autonomes.
- Lire le statut Pappers, puis exécuter uniquement son mode `dryrun`.
- Vérifier que les cinq vues de métriques répondent ; des taux ou coûts `NULL`
  sont valides si les labels/tarifs n'existent pas.
- Envoyer au webhook Resend une signature invalide et attendre un `401` ou
  `400`. Ne jamais utiliser un événement synthétique signé en production.
- Ne lancer ni scan NewsAPI/Pappers/Apify/Dropcontact/Perplexity, ni email réel
  comme simple test de déploiement.
