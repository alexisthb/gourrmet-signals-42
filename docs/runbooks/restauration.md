# Runbook — Restauration après sinistre

Écrit le 22 août 2026, parce qu'il n'existait pas : les snapshots tournent
chaque nuit vers 04:05 UTC, mais **aucune restauration n'a jamais été
répétée**, et une procédure découverte le jour du sinistre n'est pas une
procédure.

## Ce dont on dispose, mesuré le 22/08

| Élément | État |
|---|---|
| Snapshots automatiques | Quotidiens, ~04:05 UTC (constatés du 11 au 22/08, **trou le 13/08**) |
| PITR (restauration à la seconde) | **Non activé** — option payante Supabase |
| RPO réel (perte de données max) | ~24 h nominal, **~48 h** au pire constaté |
| RTO (durée de remise en service) | **Inconnu — jamais mesuré** |
| Reconstruction du schéma | **Prouvée** : le banc SQL rejoue les 178 migrations sur base vierge, en mode strict, à chaque exécution du Gate |

Traduction métier : au pire, un sinistre efface **jusqu'à deux jours** de
signaux, contacts et interactions. Les données des fournisseurs (Apify,
Dropcontact) sont re-achetables ; les notes et statuts posés par l'opératrice
ne le sont pas.

## La procédure, dans l'ordre

### 1 · Geler avant d'agir

Couper les crons pour qu'aucun automate n'écrive pendant la restauration :

```sql
SELECT public.configure_gourrmet_runtime_crons(false,
  ARRAY['email','enrichment','logos','press','pappers']);
```

Noter l'heure, et ce qui a déclenché la restauration — le post-mortem en aura
besoin.

### 2 · Restaurer le snapshot

Tableau de bord Supabase → **Database → Backups** → choisir le snapshot →
Restore. C'est l'étape longue (le RTO inconnu vit ici). La restauration
remplace TOUTE la base : tout ce qui est postérieur au snapshot disparaît.

### 3 · Rejouer ce que le snapshot n'a pas

Le snapshot date d'avant les dernières migrations ? Les appliquer dans
l'ordre depuis `supabase/migrations/` (tout est idempotent depuis le
2026-08-20 ; le banc le prouve à chaque Gate).

### 4 · Reconstituer ce qui ne vit pas dans la base

Dans l'ordre d'importance :

1. **Secrets des fonctions edge** — les fonctions les lisent depuis
   l'environnement Supabase, PAS depuis la base : ils survivent à une
   restauration de base, mais pas à une recréation de projet. Liste :
   `APIFY_API_KEY`, `DROPCONTACT_API_KEY`, `PAPPERS_API_KEY`,
   `NEWS_API_KEY`, `RESEND_API_KEY`, `PERPLEXITY_API_KEY`,
   `LOVABLE_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_WEBHOOK_SECRET`.
2. **Vault** — deux entrées : `service_role_key`,
   `email_queue_service_role_key`. Sans elles, TOUS les crons échouent en
   silence (les http_post partent sans autorisation valable).
3. **Fonctions edge** — redéployer les 24 depuis `main` (Lovable).
4. **Réglages métier** — les personas se reposent seuls (migration
   `20260822030000`, `ON CONFLICT DO NOTHING`) ; vérifier
   `signal_expiry_days`, `enrichment_sweep_daily_dose`,
   `newsapi_requests_per_run` dans `settings`.

### 5 · Rallumer, puis PROUVER

```sql
SELECT public.configure_gourrmet_runtime_crons(true,
  ARRAY['email','enrichment','logos','press','pappers']);
```

Puis la séquence de preuve — un « succeeded » de cron n'est pas une preuve,
c'est la leçon la plus chère de ce projet :

```sql
SELECT public.pipeline_health_summary();   -- attendu : les 4 chaines produisent
SELECT * FROM public.pipeline_health;      -- aucun verdict MUETTE
SELECT * FROM public.personas_health;      -- 10 fonctions par voie, aucune ABSENT
SELECT * FROM public.enrichment_sweep_readiness;  -- un verdict, pas une erreur
SELECT jobname, schedule FROM cron.job ORDER BY jobname;  -- 9 jobs attendus
```

Attendre le prochain scan Presse (toutes les 4 h) et vérifier qu'il finit
`completed` avec des articles.

## Les deux décisions ouvertes

1. **Activer le PITR** (option payante Supabase) — ramènerait le RPO de ~24 h
   à quelques minutes. C'est LA dépense qui protège les notes de
   l'opératrice, la seule donnée irremplaçable.
2. **Répéter une restauration à blanc** sur un projet Supabase jetable, pour
   mesurer le RTO réel et éprouver ce runbook. Tant que ce n'est pas fait,
   ce document reste un plan, pas une procédure.
