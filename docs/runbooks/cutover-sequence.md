# Séquence de mise en service — ordre vérifié

Complément opératoire au `production-readiness.md` : la liste exacte, ordonnée,
des migrations à appliquer, et la preuve qu'elle passe.

## Vérification réalisée le 2026-08-20

Une copie de la base de production a été reconstruite en local (les 97
migrations antérieures au chantier, sur PostgreSQL 16 avec doublures pour
pg_cron / pg_net / pgmq / Vault), puis la séquence ci-dessous y a été appliquée
dans cet ordre exact.

**Résultat : 26 sur 26, aucune erreur.**

Rejouer cette vérification : `npm run test:sql`.

## L'ordre, sans interprétation

Les deux fondations antidatées d'abord — une sélection fondée sur « les
migrations plus récentes que la dernière migration live » les ignorerait :

1. `20260112000000_geo_zones_foundation.sql`
2. `20260118180000_pappers_runtime_foundation.sql`

Puis les 24 migrations du chantier, dans l'ordre lexical :

3. `20260820123000_email_delivery_truth.sql`
4. `20260820160000_provider_ledger_and_runtime_hardening.sql`
5. `20260820162000_contact_resolution_truth.sql`
6. `20260820162500_pappers_atomic_quota_and_leases.sql`
7. `20260820163000_press_claims.sql`
8. `20260820165000_internal_access_allowlist.sql`
9. `20260820170000_internal_access_and_cron_auth.sql`
10. `20260820171000_enrichment_queue_truth.sql`
11. `20260820172000_operational_kpis.sql`
12. `20260820172500_email_verified_kpis.sql`
13. `20260820173000_provider_quota_and_cost_truth.sql`
14. `20260820173500_press_run_and_quality_truth.sql`
15. `20260820174000_resolution_metrics_truth.sql`
16. `20260820174500_provider_plan_singletons.sql`
17. `20260820175000_enrichment_batch_truth.sql`
18. `20260820175500_internal_access_cutover.sql`
19. `20260820176000_quality_benchmark_history.sql`
20. `20260820176500_apify_cost_per_signal_truth.sql`
21. `20260820177000_dropcontact_balance_truth.sql`
22. `20260820177500_pappers_durable_continuation.sql`
23. `20260820178000_apify_atomic_run_quota.sql`
24. `20260820178500_provider_dispatch_truth.sql`
25. `20260820179000_enrichment_operation_generations.sql`
26. `20260820179500_tonal_charter_analysis_truth.sql`

## Points d'arrêt obligatoires

- **Avant l'étape 22 (`1775`)** : aucun scan Pappers ne doit être `pending` ou
  `running`, et le cron `pappers-recovery-every-minute` doit être absent.
- **Avant toute étape** : les deux files email doivent être vides, drainées par
  l'ANCIEN worker, crons ensuite arrêtés, invocations en vol terminées.
- **Après l'étape 26** : exécuter le bloc de readiness du
  `production-readiness.md` (14 assertions). Une seule à `false` interdit de
  déployer les Edge Functions.

## Ordre non négociable

SQL complet **avant** les Edge Functions. `main` ne repasse sur le code du
chantier qu'une fois la chaîne SQL terminée : le code attend ces objets, et une
app publiée avant eux interroge des tables qui n'existent pas.

## Si la séquence s'interrompt

Chaque fichier s'applique dans sa propre transaction : une interruption laisse
la base à une frontière nette, jamais au milieu d'une migration. Reprendre au
fichier suivant. Les migrations du chantier sont rejouables — réappliquer un
fichier déjà passé est sans effet.
