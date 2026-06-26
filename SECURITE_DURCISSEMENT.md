# Durcissement sécurité — checklist de clôture

Synthèse des actions de sécurité **manuelles** restantes après l'audit, avec pour
chacune : ce que c'est, pourquoi, les étapes exactes, et le risque. L'objectif est
de pouvoir tout terminer sans surprise.

Trois items « A » de l'audit sont traités ici : **A3 (CORS)** est codé et livré ;
**A1 (auth crons)** et **A2 (URLs dynamiques)** sont **volontairement documentés
plutôt qu'appliqués automatiquement** — explication détaillée plus bas.

---

## A3 — CORS centralisé ✅ (codé, PR `claude/closeout-cors`)

Avant, chaque Edge Function renvoyait `Access-Control-Allow-Origin: *` en dur
(~35 copies). Désormais une seule source : `supabase/functions/_shared/cors.ts`.

**Comportement actuel : inchangé (`*`)** tant que la variable n'est pas définie.

### Action pour durcir (1 variable, durcit les 35 fonctions)

Dans **Supabase → Project Settings → Edge Functions → Secrets** (ou Lovable) :

```
ALLOWED_ORIGINS = https://<votre-app>.lovable.app,https://<domaine-custom>
```

- non définie → `*` (comme aujourd'hui) ;
- définie → seules ces origines sont acceptées, sur **toutes** les fonctions.

Aucun redéploiement de code nécessaire (les fonctions relisent la variable au
prochain démarrage à froid).

---

## A1 — Authentification des crons ⚠️ (NON appliqué — recommandation : ne pas le faire en l'état)

`cron-check-manus` et `cron-check-logos` sont aujourd'hui en `verify_jwt = false`
et appelés par pg_cron **sans header `Authorization`** → ce sont des endpoints
publics. L'idée d'A1 était de passer en `verify_jwt = true` + Bearer service_role
(comme `process-email-queue`).

### Pourquoi je ne l'ai pas appliqué automatiquement

1. **Régression certaine du front.** `src/components/EnrichmentProgressModal.tsx`
   appelle `supabase.functions.invoke('cron-check-manus')` (bouton « rafraîchir »).
   Le front n'a que le JWT *authenticated* de l'utilisateur, pas *service_role*.
   Passer en `verify_jwt = true` + exigence service_role **casserait ce bouton (401)**.
2. **Risque de re-casser le pipeline.** Un `verify_jwt = true` déployé sans que le
   header Bearter + le secret vault soient parfaitement synchronisés → les crons
   prennent 401 → plus aucun contact/logo Manus finalisé. C'est exactement le bug
   « Manus en continu » corrigé précédemment. Et je **ne peux pas tester** les
   migrations cron ici.
3. **Valeur faible.** Ces endpoints ne font qu'un travail *borné* : re-poller des
   tâches Manus déjà en file (aucune entrée contrôlée par l'attaquant, aucune PII).
   Le pire abus possible = du polling supplémentaire.

### Si vous voulez quand même le faire (étapes exactes)

1. Garder un accès *authenticated* pour le bouton front : dans
   `cron-check-manus/index.ts` et `cron-check-logos/index.ts`, autoriser
   `role IN ('service_role','authenticated')` **au lieu** d'exiger uniquement
   `service_role`.
2. `config.toml` : passer `verify_jwt = true` pour les deux fonctions.
3. Migration cron : ajouter le header `Bearer` (comme `process-email-queue`,
   `20260619150000`) — créer d'abord le secret vault :
   ```sql
   SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'cron_service_role_key');
   ```
   puis dans le corps du cron :
   ```sql
   headers := jsonb_build_object(
     'Content-Type','application/json',
     'Authorization','Bearer ' || COALESCE(
       (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_service_role_key'),''))
   ```
4. Déployer **dans cet ordre** : secret vault → migration cron → code fonctions →
   `config.toml`. Vérifier qu'un contact Manus se finalise toujours après.

---

## A2 — URLs des crons en dur ⚠️ (NON appliqué — valeur marginale)

Le project-ref `tzghzftxhxlvliekqiav` est codé en dur dans 8 emplacements
(migrations pg_cron). L'idée d'A2 était de le lire depuis le vault.

### Constat

- Le ref est **cohérent partout** et le pipeline tourne (emails, logos, contacts)
  → ce n'est **pas** un bug, juste de l'hygiène.
- ⚠️ **Divergence à noter** : `supabase/config.toml` déclare
  `project_id = "gqhbxgchoaxnafnqkmne"`, **différent** du ref utilisé par les crons
  (`tzghzftxhxlvliekqiav`). Le ref des crons est le bon (c'est celui qui marche en
  prod) ; `config.toml` est probablement un artefact de scaffold Lovable obsolète.
  À confirmer côté Supabase, mais sans impact tant que les crons utilisent le ref
  correct.

### Recommandation

Ne pas introduire d'indirection vault pour 8 sites alors que le seul bénéfice
(éviter une casse lors d'une *future* migration de projet) est hypothétique et que
re-planifier tous les crons sur une infra non testable ici est risqué. Si le projet
est un jour migré, un simple rechercher/remplacer du ref dans `supabase/migrations/`
suffit.

---

## Récapitulatif des actions manuelles restantes

| # | Action | Où | Risque si oublié |
|---|--------|-----|------------------|
| 1 | Définir `ALLOWED_ORIGINS` | Secrets Edge | CORS reste `*` (actuel) |
| 2 | Clés API en **secrets** (pas en DB) : `MANUS_API_KEY`, `APIFY_API_KEY`, `NEWSAPI_KEY`, `PAPPERS_API_KEY`, `PERPLEXITY_API_KEY`, `RESEND_API_KEY`, `LOVABLE_API_KEY` | Secrets Edge | Clés exposées en clair dans la table `settings` |
| 3 | Après (2), purger les clés de la table `settings` — **mais** plusieurs fonctions lisent encore `settings` (`trigger-manus-enrichment`, `check-manus-status`, `run-pappers-scan`, `enrich-linkedin-engager`, `transfer-engagers-to-contacts`). Vérifier qu'elles tombent bien sur l'env avant de purger. | DB + code | Fonctions sans clé → scans KO |
| 4 | Régénérer les mots de passe compromis (`Gourrmet2026!!!` / `Gourrmet26!` ont fuité dans le repo) + définir `SETUP_DEFAULT_PASSWORD` / `SETUP_SECRET` | Auth + Secrets | Comptes compromis |
| 5 | Secret vault `email_queue_service_role_key` pour le cron d'emails (`20260619150000`) | Vault | Emails jamais dépilés |
| 6 | Merger les PRs de clôture ouvertes (CORS, navigation, dead-code, UI, clés API…) | GitHub | Correctifs non déployés |

> Note : les items 2 à 5 ont leur **code** déjà en place (lecture via env, RLS,
> suppression de l'UID d'édition des clés). Il ne reste que la **configuration**
> côté Supabase, qui ne peut se faire que depuis votre console.
