# Audit plateforme Gourrmet — Rapport synthétisé

> ⚠️ **Fiabilité** : Rapport produit par 12 agents d'audit + synthèse. Les
> sections Critiques/Élevés ont été en grande partie **vérifiées manuellement**
> (EventForm factice, mots de passe en dur, crons non schedulés, handlers no-op
> = confirmés). En revanche le tableau **« Edge Functions orphelines » contient
> des erreurs** : `analyze-articles`, `fetch-news`, `trigger-manus-enrichment`,
> `enrichment-worker`, `presse-maintenance` y sont marquées « Dead » alors
> qu'elles sont bel et bien appelées (par `run-full-scan`, le worker, ou en
> admin). **NE RIEN SUPPRIMER sur la base de ce tableau sans vérification au
> cas par cas.** De même, `cron-check-logos` tourne toutes les 2 min (pas 15),
> et `cron-check-manus` est désormais schedulé (PR #12).


## Résumé exécutif

| Domaine | 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low |
|---------|------------|--------|----------|--------|
| Navigation + Dashboard | 2 | 2 | 2 | 0 |
| Signaux Presse | 2 | 2 | 6 | 1 |
| Signaux Pappers | 2 | 4 | 2 | 2 |
| LinkedIn Engagement | 1 | 3 | 2 | 2 |
| Contacts + Pipeline | 1 | 2 | 3 | 1 |
| Événements + Salon | 4 | 1 | 0 | 0 |
| Admin + Partenaires | 1 | 1 | 4 | 2 |
| Email | 2 | 0 | 0 | 1 |
| Cadeaux + Charte Tonale | 1 | 1 | 2 | 1 |
| Sécurité (CORS, Logs, Secrets) | 2 | 4 | 2 | 0 |
| Enrichissement + Crédits | 2 | 1 | 5 | 0 |
| Crons + Edge Functions | 1 | 3 | 3 | 0 |
| **TOTAL** | **21** | **24** | **31** | **10** |

**État global critique** : La plateforme contient 21 vulnérabilités critiques qui **bloquent des workflows entiers** (événements ne se créent jamais, emails restent en queue infinie, enrichissements zombies, routes cassées, données jamais persistées). Les 24 issues élevées menacent l'intégrité des données ou la sécurité. Corrections prioritaires : données persistantes, authentification crons, déblocage queues. Au-delà de la sécurité, plusieurs modules sont des **coquilles vides ou simulées** (EventForm, EventsScanner, AdminOrders).

---

## 🔴 Critiques — Corrections immédiatement requises

### 1. **EventForm : création d'événements jamais persistée** 
- **Location** : `src/pages/EventForm.tsx:27–40`
- **Impact** : Les utilisateurs créent des événements (bouton clique, toast succès), mais aucune donnée n'est insérée en base. Formulaire fantôme + hook `useCreateEvent` dead code.
- **Fix** : Remplacer `setTimeout(500)` + `toast()` par appel réel `await useCreateEvent().mutateAsync(formData)` ; ajouter gestion erreur avec toast d'échec.

### 2. **Route `/events/:id/edit` manquante — bouton Edit cassé**
- **Location** : `src/pages/EventDetail.tsx:125–129` + `src/App.tsx:88–93`
- **Impact** : Bouton Éditer navigue vers `/events/:id/edit` (404) qui n'existe pas en App.tsx. Impossible d'éditer événements créés.
- **Fix** : Ajouter route `<Route path="/events/:id/edit" element={<EventForm editMode />} />` et adapter EventForm pour charger event via `useParams` + `useEvent(id)`.

### 3. **Tables partenaires/présentations sans politiques RLS — données exposées**
- **Location** : `supabase/migrations/20260619110203_3c298e1f-ee82-4211-8679-e43b6d271590.sql:23–25`
- **Impact** : `partner_houses`, `partner_news`, `presentations` ont perdu leurs politiques RLS sans remplacement. Tout utilisateur authentifié peut lire/modifier/supprimer TOUTES les données (RGPD violation).
- **Fix** : Créer migration RLS immédiate (ex: `20260626_partner_rls_fix.sql`) qui restaure politiques authentified-only pour chaque table.

### 4. **Email infrastructure bloquée — cron process-email-queue jamais créé**
- **Location** : `supabase/migrations/20260616142001_email_infra.sql:295–302`
- **Impact** : Tous les emails restent en queue `email_queue` indéfiniment. Zéro email n'est jamais envoyé malgré mutation réussie (toast faux positif). Lovable API jamais appelée.
- **Fix** : Créer migration SQL avec `SELECT cron.schedule('process-email-queue', '*/5 * * * * *', 'SELECT http_post(...process-email-queue)')` et passer Bearer token via vault.

### 5. **Cron check-manus-enrichments déclaré mais jamais créé — enrichissements bloqués**
- **Location** : `supabase/migrations/20260517150000_cron_state.sql:28–30`
- **Impact** : Table `cron_state` prétend que le cron tourne toutes les 10s, mais aucun `SELECT cron.schedule('check-manus-enrichments'...)` n'existe. Enrichissements Manus restent en `manus_processing` ad infinitum (dépend de polling frontend manuel).
- **Fix** : Créer le cron pg_cron réel ou supprimer l'entrée fake de `cron_state` + utiliser `enrichment-worker-tick` existant.

### 6. **Unsubscribe links manquent des templates email — RGPD violation**
- **Location** : `supabase/functions/_shared/transactional-email-templates/outreach-message.tsx:27,38–89`
- **Impact** : Template email a prop `unsubscribeUrl` mais ne l'affiche jamais en JSX. Aucun lien de désinscription en bas des emails. Violation RGPD + CAN-SPAM.
- **Fix** : (1) Ajouter JSX footer : `<Hr /><Text>Désinscription: <Button href={unsubscribeUrl}>Cliquez</Button></Text>`. (2) Dans `send-transactional-email/index.ts`, passer `unsubscribeUrl` dans templateData : `templateData.unsubscribeUrl = \`${FRONTEND_URL}/unsubscribe?token=${unsubscribeToken}\``.

### 7. **Clés API gérées en DB (Settings) au lieu d'env vars — exposition massive**
- **Location** : `src/pages/Settings.tsx:290–304` + `src/hooks/useTonalCharter.ts:127,217`
- **Impact** : MANUS_API_KEY, APIFY_API_KEY, CLAUDE_API_KEY, etc. sont éditables via UI Settings et stockées en table `settings` (lisible si DB compromise). Risque de fraude : débits Manus/Apify, accès API Pappers/NewsAPI.
- **Fix** : (1) Supprimer handleSaveApiKeys + UI Settings clés API. (2) Déplacer toutes les clés en env vars Supabase Edge Functions. (3) Créer endpoint `/admin/settings-check` (edge function) pour UX : affiche "✓ Clés configurées côté serveur" sans révéler les clés.

### 8. **EventsScanner : scan est simulation (TODO non résolu) — bouton mort**
- **Location** : `src/pages/EventsScanner.tsx:30–37`
- **Impact** : Bouton "Lancer scan" lance `setTimeout(3000)` sans appeler edge function réelle. Aucun événement n'est scanné. Commentaire TODO : "Implémenter une edge function de scan".
- **Fix** : (A) Implémenter edge function réelle `scrape-event-exhibitors` pour CCI Paris IDF, Eventbrite, etc. (B) Ou supprimer la page si non-prioritaire + retirer lien Dashboard.

### 9. **Enrichissement jobs zombies restent bloqués indéfiniment (pas timeout)**
- **Location** : `supabase/migrations/20260517140000_enrichment_jobs_queue.sql:5–30` + `supabase/functions/cron-check-manus/index.ts:72–107`
- **Impact** : Jobs `enrichment_jobs` restent `status='running'` ou `'manus_processing'` à jamais si worker/Manus timeout. Saturation `MAX_ENRICHMENT_CONCURRENCY=3`. Aucun retry auto. Signal bloqué à jamais.
- **Fix** : (1) Ajouter colonne `JOB_TIMEOUT` (ex: 5 min) dans migration. (2) Créer cron nightly qui reset `running > timeout` en `'failed'` pour retry. (3) cron-check-manus : si manusResponse.ok=false + created_at > 6h, update enrichment `status='failed'`.

### 10. **Lien cassé vers `/events/scanner` — bouton Dashboard mort**
- **Location** : `src/pages/Dashboard.tsx:410` + `src/App.tsx:88–93`
- **Impact** : Bouton "Scanner Événements" pointe vers `/events/scanner` (404 car route inexistante). EventsScanner.tsx existe mais non routée.
- **Fix** : Ajouter route `<Route path="/events/scanner" element={<EventsScanner />} />` et importer composant.

### 11. **Lien cassé vers `/pappers/queries` — gestion requêtes Pappers impossible**
- **Location** : `src/pages/PappersDashboard.tsx:95`
- **Impact** : Bouton "Requêtes" Pappers redirige vers route inexistante (404). Aucune page gestion requêtes Pappers implémentée.
- **Fix** : Créer `PappersQueriesPage.tsx` + ajouter routes `/pappers/queries` + `/pappers/queries/:id/edit` dans App.tsx. Ou désactiver bouton si non-implémenté.

### 12. **LinkedInDashboard polling scan infini (pas de timeout final)**
- **Location** : `src/pages/LinkedInDashboard.tsx:52–84`
- **Impact** : Polling `checkScanStatus` tourne indéfiniment si Manus reste en `'manus_processing'`. Fuite mémoire + requêtes inutiles éternelles.
- **Fix** : Ajouter max 60 retries (5 min). Si timeout atteint, afficher "Scan en timeout, veuillez rafraîchir" + arrêter polling.

### 13. **Boutons Pappers scan actifs même si crédits épuisés (isBlocked ignoré)**
- **Location** : `src/pages/PappersDashboard.tsx:102–131` + hook `usePappersCreditsSummary()`
- **Impact** : Même si `isBlocked=true` (limite atteinte), boutons "Lancer scan" + "Arrêter scan" restent activés. Utilisateur déclenche scan coûteux malgré quota épuisé.
- **Fix** : Lire `usePappersCreditsSummary()`, ajouter `disabled={isBlocked || startScan.isPending}` aux boutons. Backend doit aussi re-vérifier (doublon check sécurité).

### 14. **Pipeline Contact status change handler est no-op (perdre les changements)**
- **Location** : `src/components/pipeline/PipelineContactsTab.tsx:54`
- **Impact** : `onStatusChange={() => {}}` vide. Utilisateur change statut contact en Pipeline → aucune mutation n'est appelée → données perdues au refresh.
- **Fix** : Importer `useUpdateContactStatus`, passer handler réel : `onStatusChange={(id, status) => updateStatus.mutate({ contactId: id, status, oldStatus })}`.

### 15. **Mutations log d'interactions sans gestion d'erreur (LinkedInMessageDialog, EmailDialog)**
- **Location** : `src/components/LinkedInMessageDialog.tsx:115,134,161,182` + `src/components/EmailDialog.tsx:136,165,271,305`
- **Impact** : `saveMessageFeedback.mutate()` + `createInteraction.mutate()` sans try-catch. Si Supabase échoue, l'utilisateur ne sait pas. Interactions jamais loggées mais utilisateur croit succès.
- **Fix** : Ajouter `.onError()` handler à mutations avec toast erreur, OU wrapper dans try-catch async.

### 16. **Credentials hardcodés dans Edge Functions (create-clotilde-user, create-initial-users)**
- **Location** : `supabase/functions/create-clotilde-user/index.ts:19–20` + `create-initial-users/index.ts:25–28`
- **Impact** : Mots de passe "Gourrmet2026!!!" en clair dans repo Git. Fonctions one-shot publiques (CORS *) — exposition massive si repo leaked.
- **Fix** : Supprimer passwords hardcodés. Implémenter via Supabase Auth invite link + email verification. Ajouter auth Bearer sur ces fonctions (jamais publiques).

### 17. **Transfert Pappers vers signaux échoue — types capital_increase/transfer jamais traités**
- **Location** : `supabase/functions/run-pappers-scan/index.ts` + `src/hooks/usePappers.ts:288–289`
- **Impact** : Interface PappersQuery définit types `'capital_increase'`, `'transfer'`, mais run-pappers-scan ignore ces types (pas de handler). Toute requête capital_increase/transfer ne scanne jamais. Mappage ambiguë (all → "levee").
- **Fix** : (A) Implémenter handlers complets pour capital_increase + transfer dans run-pappers-scan. (B) Corriger mappage dans usePappers : `capital_increase` → `capital_increase`, `transfer` → `transfer` (pas "levee" fourre-tout).

---

## 🟠 Élevés — Risques sérieux à corriger rapidement

### Navigation & Routes
1. **Lien cassé `/settings/api` — Configuration API inaccessible**
   - `src/pages/Dashboard.tsx:435` — Bouton "Configurer" pointe `/settings/api` (inexistant).
   - **Fix** : Remplacer `/settings/api` par `/settings` (page Settings existe).

2. **Landing page (Index.tsx) liens cassés — Onboarding brisé**
   - `src/pages/Index.tsx:24,38,59,96,179` — Links `/signals/presse` (→404), `/linkedin` (→404, doit être `/engagers`), `/dashboard` (→404, doit être `/`).
   - **Fix** : Corriger tous les liens pour correspondre aux vraies routes App.tsx.

3. **EventsScanner bouton "Sources" sans onClick — bouton mort**
   - `src/pages/EventsScanner.tsx:78–81` — Aucun handler de filtrage.
   - **Fix** : Ajouter state + dialog filtres, onClick handler.

### Enrichissement & Crédits
4. **Enrichment_queue_stats race condition — dépassement concurrence**
   - `supabase/migrations/20260517140000_enrichment_jobs_queue.sql:104–111` — 2 workers peuvent lire `stats.running=0` simultanément et dépiler 2× MAX_ENRICHMENT_CONCURRENCY jobs.
   - **Fix** : Remplacer pré-calc slots par boucle `while dequeue() != NULL`.

5. **ScanProgressCard polling sans retry backoff — charge réseau inutile**
   - `src/components/ScanProgressCard.tsx:24–52,59–62` — Pas de try-catch sur Supabase calls. Polling persiste même si down.
   - **Fix** : Ajouter try-catch, compteur erreurs consécutives (s'arrête après 3–5), backoff exponentiel.

### Sécurité CORS & Auth
6. **CORS ouvert à `*` dans 6+ Edge Functions — vecteur CSRF**
   - `generate-infographic`, `fetch-news`, `trigger-manus-enrichment`, `scan-linkedin-manus`, `scrape-event-exhibitors`, `scrape-linkedin-engagers` + 27 autres.
   - **Fix** : Remplacer corsHeaders hardcodés par helper `corsHeaders(req)` qui respecte env var ALLOWED_ORIGINS.

7. **Crons sans authentification HTTP — exécution non-autorisée possible**
   - `supabase/functions/cron-check-logos/index.ts`, `cron-check-manus/index.ts` — Pas de vérification Authorization header.
   - **Fix** : Ajouter validation Bearer token (service_role secret ou cron-specific token depuis vault).

8. **URLs Supabase hardcodées dans 4 migrations pg_cron**
   - `tzghzftxhxlvliekqiav.supabase.co` — Project ID publié, casse à env autres (prod/dev/client).
   - **Fix** : Utiliser `Deno.env.get('SUPABASE_URL')` ou pg_cron vault pour dynamicité.

### Pappers & Données
9. **Données géographiques manquantes — Pappers code_postal absent**
   - `supabase/functions/fetch-pappers/index.ts:278–289` — company_data ne contient pas code_postal sauvegardé (exists en API Pappers).
   - **Fix** : Ajouter `code_postal: company.siege?.code_postal` lors insertion.

10. **Signaux transférés Pappers perdent localisation**
    - `src/hooks/usePappers.ts:277–296` — Transfer vers `signals` table sans geo_zone_id, location_details.
    - **Fix** : Ajouter fields géo à transfer, remplir depuis company_data.

### Pappers & Crédits
11. **Boutons scan Pappers pas bloqués si crédits épuisés**
    - Même issue que #13 ci-dessus, mais côté Pappers spécifiquement.
    - **Fix** : Lire `usePappersCreditsSummary()`, désactiver boutons si `isBlocked=true`.

### Email & Logging
12. **saveMessageFeedback mutation échoue sans notification (Presse)**
    - `src/components/LinkedInMessageDialog.tsx:115,134` — Pas de .onError().
    - **Fix** : Ajouter .onError() handler avec toast erreur.

### Partenaires
13. **Non-null assertion dangereux sur useParams (PartnerDetail)**
    - `src/pages/PartnerDetail.tsx:295` — `houseId={id!}` sans vérification. Si undefined, crash.
    - **Fix** : Vérifier `id` avant render, afficher error fallback si absent.

---

## 🟡 Moyens — Dettes à gérer dans les prochaines itérations

### Data Integrity & Validation
1. **Données date_start potentiellement nulles non validées (Dashboard)**
   - `src/pages/Dashboard.tsx:95,397` — `new Date(e.date_start)` échoue silencieusement si null.
   - **Fix** : Ajouter check : `e.date_start && new Date(e.date_start) > new Date()`.

2. **SignalNextActionEditor manque date validation (compare dates)**
   - `src/components/SignalNextActionEditor.tsx:112–120` — CalendarComponent accepte dates passées (NextActionEditor non).
   - **Fix** : Ajouter `disabled={(d) => d < new Date()}` pour cohérence.

3. **Absence validation structure fichier présentations**
   - `src/hooks/usePresentations.ts:128–143` — Pas de vérification file size, MIME type strict.
   - **Fix** : Valider côté client : taille < 50MB, MIME type strictement PDF/image.

4. **Gestion edits concurrents partenaires/actualités**
   - `src/components/PartnerHouseDialog.tsx`, `PartnerNewsDialog.tsx` — Pas d'optimistic locking / timestamp check.
   - **Fix** : Ajouter `updated_at` field, vérifier avant update.

### Mutations & Error Handling
5. **updateStatus mutation (ContactsList) sans onError handler**
   - `src/pages/ContactsList.tsx:173` — Si mutation échoue, pas de toast erreur.
   - **Fix** : Ajouter try-catch ou .onError() à mutation.

6. **Enrichissement mutation handleTriggerEnrichment message générique**
    - `src/pages/SignalDetail.tsx:231–272` — Toast erreur toujours "Impossible d'enrichir ce signal".
    - **Fix** : Améliorer message avec `error.message` spécifique.

7. **ContactCard onStatusChange callback async race condition**
    - `src/components/ContactCard.tsx:304–321` — Callback appelée immédiatement, pas d'await.
    - **Fix** : Rendre async, attendre mutation avant return.

8. **Signal Detail status mutation message d'erreur vague**
    - `src/pages/SignalDetail.tsx:808–815` — Toast affiche juste `e instanceof Error ? e.message : 'Erreur inconnue'`.
    - **Fix** : Structurer message : "Pipeline status failed: [détail API]".

### Presse & Signaux
9. **Page SignalsProblemes aucune action de résolution**
    - `src/pages/SignalsProblemes.tsx` — Affiche problèmes mais pas de bouton "Résoudre" rapide.
    - **Fix** : Ajouter menu dropdown per-signal pour changer statut direct (new/ignored/contacted).

10. **Link navigation invalide si signal mal typé (SignalsProblemes)**
    - `src/pages/SignalsProblemes.tsx:17–23` — Confusion entre types presse/pappers.
    - **Fix** : Corriger logique `getSignalRoute()` ou normaliser types.

### LinkedIn Engagement
11. **useScrapeEngagers orpheline jamais appelée**
    - `src/hooks/useEngagers.ts:237` — Fonction dead code, remplacée par Manus flow.
    - **Fix** : Supprimer fonction.

12. **useEnrichEngager importée mais jamais utilisée (LinkedInEngagers)**
    - `src/pages/LinkedInEngagers.tsx:34,82` — Ligne inutile.
    - **Fix** : Supprimer import et déclaration.

13. **Enrichissement batch aucune validation structure retour**
    - `src/hooks/useEngagerEnrichment.ts:53–83` — Si results undefined, toast affiche "0 enrichissements" silencieusement.
    - **Fix** : Vérifier data.results est array, afficher error toast si non.

14. **transferEngagers double-processing possible**
    - `supabase/functions/scrape-linkedin-engagers/index.ts:248–249` + `LinkedInDashboard.tsx:185` — Transfert auto en scrape + bouton manual.
    - **Fix** : Retirer transferEngagers auto de scrape (laisser bouton manual).

15. **Endpoint add_post pas de validation URL LinkedIn**
    - `supabase/functions/scrape-linkedin-engagers/index.ts:121–138` — Accepte n'importe quelle URL.
    - **Fix** : Valider `/linkedin\.com\/(feed|posts|articles)\/`.

### Admin & Présentations
16. **Pages Admin (Commandes, Produits, Clients) non-implémentées**
    - `src/pages/AdminOrders.tsx:14`, `AdminProducts.tsx:13`, `AdminClients.tsx:13` — Coquilles vides "Module en développement".
    - **Fix** : Implémenter CRUD complet, ou retirer routes si non-prioritaire.

17. **Présentation chargement manquant sans feedback erreur**
    - `src/pages/PresentationViewer.tsx:100–112` — Message basique sans contexte cause.
    - **Fix** : Afficher error.message spécifique + "Permission insuffisante" vs "Not found" vs "Erreur réseau".

18. **Présentation vide (file_url null) pas de bouton upload rapide**
    - `src/pages/PresentationViewer.tsx:148–169` — Pas d'affordance pour ajouter fichier.
    - **Fix** : Ajouter bouton "Uploader un fichier" ou rediriger vers édition.

### Cadeaux
19. **Image générée latestCompleted variable dead code (jamais affichée)**
    - `src/components/GiftTemplateSelector.tsx:52` — Variable définie mais jamais utilisée.
    - **Fix** : Ajouter useEffect pour assigner latestCompleted à setResultImage quand complète.

20. **Custom prompt templates jamais transmis au générateur**
    - `src/components/GiftTemplateSelector.tsx:35` — customPrompt ignoré.
    - **Fix** : Passer `customPrompt: template.custom_prompt` à mutate.

21. **État resultImage persiste entre réouvertures dialog (Cadeaux)**
    - `src/components/GiftTemplateSelector.tsx:68–75` — Vieille image affichée à réouverture.
    - **Fix** : Réinitialiser `setResultImage(null)` quand `open=false`.

### Charte Tonale
22. **Rafraîchir charte tonale échoue — pas d'auth token**
    - `src/hooks/useTonalCharter.ts:127` — invoke sans Authorization header → 401.
    - **Fix** : Ajouter Bearer token depuis session auth.

23. **Auto-update charte tonale échoue (après 5 corrections)**
    - `src/hooks/useTonalCharter.ts:217` — Idem, pas de token.
    - **Fix** : Même fix que #22.

---

## ⚪ Mineurs / Dettes techniques

1. **generateGift hook errors sans feedback (GiftTemplateSelector)**
   - Pas de toast erreur si mutation échoue.

2. **SyncStatusBar useCronState hook documentation absente**
   - `src/components/SyncStatusBar.tsx:8` — Hook existe-t-il réellement ? Pas fourni audit.

3. **Cast `as any` dans PartnerNewsDialog masquant erreurs TypeScript**
   - `src/components/PartnerNewsDialog.tsx:45` — Désactive type-checking.

4. **GiftTemplatesTab handleSavePrompt pas de toast d'erreur**
   - `src/components/GiftTemplatesTab.tsx:114–121` — Erreur silencieuse.

5. **Logs Presse exposent PII clients (company names, task IDs)**
   - `supabase/functions/cron-check-manus/index.ts:62,73` — console.log company_name.
   - **Fix** : Remplacer par ID générique.

6. **Logs exposent UUID utilisateur auth**
   - `supabase/functions/fetch-news/index.ts:61` — console.log claimsData.claims.sub.
   - **Fix** : Tronquer ou hasher.

7. **Code postal vide dans Pappers — affiche "undefined" en UI**
   - `supabase/functions/fetch-pappers/index.ts:278–289` — Pas de fallback "N/A".

8. **Pappers query types non documentés (seuls anniversary/nomination supportés)**
   - `supabase/functions/run-pappers-scan/index.ts` — capital_increase/transfer déclarés mais ignorés.
   - **Fix** : Documenter restrictions ou implémenter handlers.

9. **generate-infographic edge function orpheline (dead code)**
   - Jamais appelée depuis UI. Soit supprimer, soit créer UI.

10. **count-pappers-anniversaries orpheline (fonction estimation jamais exposée en UI)**
    - Utile pour pré-scanner, mais inaccessible.

---

## Edge Functions orphelines (candidats suppression)

Jamais appelées depuis UI, crons, ou autres functions. Considérer suppression pour réduire dette maintenance :

| Fonction | Statut | Note |
|----------|--------|------|
| `analyze-articles` | Dead | Jamais invoquée |
| `check-engager-enrichment` | Dead | Idem |
| `count-pappers-anniversaries` | Orpheline utile | Pré-scanner coûts Pappers (exposer en UI ?) |
| `create-clotilde-user` | One-shot | Supprimer après env prod stable |
| `create-initial-users` | One-shot | Idem + sécurité (credentials) |
| `enrich-company-revenue` | Dead | Perplexity API jamais intégrée |
| `enrich-linkedin-engager` | Dead | Remplacé par batch flow |
| `enrichment-worker` | Orpheline utile | Dépile queue, mais invoquée uniquement par `enrichment-worker-tick` cron (vérifie fonctionnement réel) |
| `fetch-news` | Orpheline utile | NewsAPI enrichissement, mais invoqué seulement manuellement ou cron ? (vérifie) |
| `generate-infographic` | Dead | UI jamais créée |
| `handle-email-suppression` | Dead | Jamais appelée [à confirmer] |
| `handle-email-unsubscribe` | Live | Appelée depuis page Unsubscribe (OK) |
| `presse-maintenance` | Dead | Utility one-off, non production |
| `preview-transactional-email` | Dead | Debug-only, jamais appelée [à confirmer] |
| `process-email-queue` | BLOQUÉE | Cron jamais créé (critique fix #4) |
| `scrape-event-exhibitors` | Dead | UI EventsScanner jamais implémentée |
| `send-email` | Dead | Remplacé par `send-transactional-email` |
| `trigger-manus-enrichment` | Dead | Remplacé par `enqueue-enrichment` |
| `wipe-seed-data` | One-shot | Supprimer (danger production) |

**Action** : Audit `enrichment-worker` + `fetch-news` pour confirmer invocation réelle. Supprimer 15+ autres après confirmation.

---

## Crons — État & Risques

| Cron | Status | Fréquence | Invoque | Risques | Fix |
|------|--------|-----------|---------|--------|-----|
| `enrichment-worker-tick` | ✓ Live | 1 min | `enrichment-worker` | Race condition stats | Voir #9 ci-dessus |
| `fetch-pappers` | ✓ Live | Daily | `fetch-pappers` | Crédits pas bloqués | Voir #13 |
| `run-full-scan` | ✓ Live | Daily | `run-full-scan` | TODO |  |
| `cron-check-logos` | ✓ Live | 15 min | `cron-check-logos` (HTTP) | Pas auth + URL hardcoded | Voir #7,#8 |
| `check-manus-enrichments` | ✗ Dead | — | — | Déclaré mais jamais créé | Voir #5 |
| `process-email-queue` | ✗ Dead | — | — | Jamais créé → emails bloqués | Voir #4 |

**Priorités fixes** : (1) Créer `process-email-queue` cron. (2) Créer ou intégrer `check-manus-enrichments` logique. (3) Ajouter auth + dyn URLs à crons HTTP.

---

## Recommandations séquençage correctifs

**Phase 1 — BLOQUEURS (48–72h, 3–4 PR)**

*Objectif* : Débloquer workflows critiques (données persistantes, emails, enrichissements).

- **PR #1 : Persistance Événements + Routes**
  - Implémenter EventForm création réelle (mutate useCreateEvent)
  - Ajouter routes `/events/:id`, `/events/:id/edit`
  - Adapter EventForm mode édition (useParams + useEvent)
  - Vérifier EventsScanner routé + lien Dashboard
  - Tests : Créer un événement → vérifier en BD + éditer → modifier → vérifier changements.

- **PR #2 : Email Infrastructure (cron + unsubscribe)**
  - Créer migration SQL cron `process-email-queue` (pg_cron.schedule + http_post + vault Bearer)
  - Ajouter unsubscribeUrl au template JSX outreach-message + transactional-email flow
  - Générer unsubscribeToken dans send-transactional-email
  - Tests : Envoyer email test → vérifier en queue → attendre cron 5s → vérifier Lovable API appelée + unsubscribe link présent.

- **PR #3 : Enrichissement Timeout + Reset**
  - Ajouter colonne JOB_TIMEOUT migration
  - Créer cron nightly reset jobs stale en 'failed'
  - Implémenter timeout recovery dans cron-check-manus (6h+ failed → update signal + log)
  - Tests : Lancer enrichissement → attendre > 6h sans completion → vérifier status=failed + enrichment_status=failed.

- **PR #4 : Sécurité Clés API (remove from DB)**
  - Supprimer handleSaveApiKeys + fields API Settings.tsx
  - Déplacer toutes clés en env vars `.env.local` (dev) + Supabase secrets (prod)
  - Ajouter endpoint `/admin/settings-check` pour UX (retourne "✓ Configured")
  - Tests : Vérifier update-tonal-charter call réussit sans clé en DB.

**Phase 2 — SÉCURITÉ CRITIQUE (1 semaine, 2–3 PR)**

- **PR #5 : RLS + CORS + Auth Crons**
  - Restaurer politiques RLS partner_houses/partner_news/presentations
  - Centraliser CORS via helper `corsHeaders(req)` in 6+ fonctions (générer-infographic, etc.)
  - Ajouter auth Bearer validation cron-check-logos + cron-check-manus
  - Migrer URLs hardcodées vers env var SUPABASE_URL
  - Audit : Grep `Access-Control-Allow-Origin.*\*`, `tzghzftxhxlvliekqiav`, `Deno.env` check.

- **PR #6 : Logs Sensitive Data Scrub**
  - Retirer PII (company_name, user UUID) de logs cron-check-manus, fetch-news
  - Ajouter commentaires /* Safe: ... */ sur XSS (dangerouslySetInnerHTML)
  - Tests : Vérifier logs ne contiennent PII via grep.

**Phase 3 — DONNÉES + UX (2 semaines, 4–5 PR)**

- **PR #7 : Pipeline Contact + Enrichment State**
  - Implémenter real handler PipelineContactsTab.onStatusChange
  - Lire enrichmentStatus='pending' + désactiver bouton Enrichir (SignalDetail)
  - Ajouter gestion erreur mutations enrichissement (toast + détail)
  - Tests : Modifier statut pipeline → vérifier BD. Enrichir → vérifier pending → vérifier bouton désactivé.

- **PR #8 : Pappers Routes + Crédits Bloquage**
  - Créer PappersQueriesPage + routes `/pappers/queries` + edit
  - Lire usePappersCreditsSummary dans PappersDashboard → désactiver scan buttons si isBlocked
  - Implémenter handlers capital_increase/transfer dans run-pappers-scan OR supprimer types
  - Tests : Dépenser crédits → isBlocked=true → vérifier boutons désactivés.

- **PR #9 : LinkedIn Transfer + Enrichment Batch**
  - Supprimer double-transfer (scrape-linkedin-engagers.transferEngagers + manual button)
  - Valider enrichment batch structure retour + toast erreur
  - Valider add_post URL LinkedIn format
  - Tests : Enrichir batch → vérifier toast succès/erreur.

- **PR #10 : EventForm + EventsScanner Implementation**
  - Implémenter vraie edge function scrape-event-exhibitors (CCI/Eventbrite)
  - Relier bouton Scanner au nouveau flow (pas simulation)
  - Ajouter UI "Sources" filtrage
  - Ajouter bouton Message dans EventDetail (IntegrationEmailDialog)
  - Tests : Scanner événement → vérifier résultats → filtrer source → vérifier UI.

**Phase 4 — CLEANUP DEBT (1 semaine, 1–2 PR)**

- **PR #11 : Dead Code + Dupe Validation**
  - Supprimer orphelines (20 edge functions)
  - Supprimer hooks dead (useScrapeEngagers, useEnrichEngager)
  - Valider dates future (SignalNextActionEditor + Dashboard)
  - Tests : Build sans warnings, grep orphelines = 0.

- **PR #12 : Admin Pages + Partenaires**
  - Implémenter AdminOrders/AdminProducts/AdminClients CRUD OR retirer routes
  - Fixer non-null assertions PartnerDetail
  - Ajouter validation files présentations (size, MIME)
  - Tests : Créer partenaire → vérifier (admin pages opérationnels).

---

## Tableau Récapitulatif Déduplication

| Issue | Domaines | Sévérité | Fix Une Fois | Notes |
|-------|----------|----------|-------------|-------|
| Routes cassées | Nav, Presse, Pappers, Événements | 🔴 🟠 | PR #1, #8, #10 | `/events/scanner`, `/pappers/queries`, `/settings/api`, Dashboard links |
| Clés API en DB | Email, Charte | 🔴 | PR #4 | Déplacer env vars |
| Mutations sans erreur | Presse, LinkedIn, Contacts, Email | 🟠 🟡 | PR #7, #9, #2 | Ajouter .onError() partout |
| Enrichissement zombies | Enrichissement | 🔴 | PR #3 | Timeout + cron reset |
| CORS wildcard | Sécurité (33 fonctions) | 🟠 | PR #5 | Helper centralisé |
| Crons pas d'auth | Sécurité | 🟠 | PR #5 | Bearer token |
| Dead code edges | Crons, Giveaways | 🟡 | PR #11 | 20 fonctions orphelines |
| Pappers crédits | Pappers | 🔴 | PR #8 | isBlocked check + buttons |
| Email processus | Email | 🔴 | PR #2 | Créer cron process-email-queue |
| RLS partner tables | Admin | 🔴 | PR #5 | Restaurer politiques |

---

## Notes & Uncertainties

- [à confirmer] : `fetch-news`, `enrichment-worker` invocation réelle — audit incomplet sur cron appels.
- [à confirmer] : `count-pappers-anniversaries` utilité — documentée mais inaccessible UI ; pré-scanner utile ?
- [à confirmer] : `handle-email-suppression` usage — table `email_suppression_list` existe mais jamais consulted ?
- **Session data** : Beaucoup de composants manquent `.onError()` mutations — pattern systémique = très haute récurrence. Centraliser solution (custom hook `useMutationWithErrorToast`).

---

**Fin d'audit.**