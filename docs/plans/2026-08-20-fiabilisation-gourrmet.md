# Fiabilisation produit et live de Gourrmet

## Objectif

Rendre fiable la chaîne métier `signal -> société -> contact opérationnel ->
email vérifié -> envoi réel -> retour commercial`, tout en élargissant au
maximum la couverture Presse, en unifiant Pappers et en retirant uniquement de
l'interface le canal autonome LinkedIn sources/posts/engagers. Les événements
restent éteints.

## Décisions actées

- Un succès métier n'est enregistré qu'après le résultat réel : aucun statut
  `sent`, `completed` ou `processed` anticipé.
- Le module autonome LinkedIn disparaît des routes, menus, réglages et
  documentation visibles. LinkedIn reste utilisé en interne pour
  l'enrichissement de sociétés et de contacts.
- La Presse vise la couverture la plus large possible dans un budget d'appels
  explicite : pages de 100, pagination reprise, rotation équitable des requêtes
  et conservation des erreurs pour relance.
- Pappers n'a plus qu'un moteur et une seule machine d'état. Les anciens points
  d'entrée deviennent des adaptateurs vers ce moteur.
- Une société ou un email n'est déclaré résolu/vérifié qu'avec une preuve et
  un niveau de confiance stockés.
- Resend devient le fournisseur de l'outreach commercial. Lovable Email reste
  réservé aux emails d'authentification et transactionnels.
- Les migrations sont idempotentes pour réconcilier le schéma live existant et
  une reconstruction neuve depuis Git.
- Aucun email réel, scan payant, restauration ou suppression de données n'est
  déclenché pendant la vérification.

## Approche

Le chantier est découpé en lots correctifs distincts et vérifiables. On pose
d'abord les contrats de vérité et les migrations, puis les moteurs Presse et
Pappers, ensuite l'enrichissement et l'email, enfin l'interface, la pagination
et l'exploitation. Les changements live seront appliqués via Lovable seulement
après validation locale des migrations et fonctions.

## Étapes

1. Ajouter un socle de tests et des commandes `typecheck`/`test`, puis écrire
   les tests de contrat qui reproduisent les faux succès actuels.
2. Réconcilier le schéma : créer/versionner les quatre tables absentes des
   migrations, ajouter les tables de runs/usage/événements email nécessaires,
   les index d'idempotence et une rétention bornée pour cron/pg_net.
3. Retirer de l'UI seulement le canal LinkedIn autonome : routes, navigation,
   panneaux de réglages, historique et promesses documentaires. Conserver les
   profils LinkedIn et l'enrichissement LinkedIn/Dropcontact.
4. Élargir Presse : `pageSize=100`, pagination avec curseur, budget journalier
   partagé, retry/backoff, canonicalisation des URL, claim atomique des
   articles et DLQ/reprise si l'IA ou l'écriture échoue.
5. Unifier Pappers dans un module partagé : mêmes requêtes, fenêtres,
   pagination, géozones, priorités, seuils et comptage de crédits ; rendre les
   actions start/pause/resume/stop réellement coopératives.
6. Durcir la résolution société/contact : score de correspondance explicable,
   rejet des candidats ambigus, personas réellement transmis, contrôle strict
   des emails Dropcontact et persistance de la provenance.
7. Séparer mise en file, envoi, livraison, bounce, plainte et réponse email ;
   router l'outreach vers Resend, rendre le worker idempotent et ajouter le
   webhook fournisseur sans envoyer de message pendant les tests.
8. Ajouter un ledger fournisseur unifié et les métriques par run/signal pour
   NewsAPI, Pappers, Apify, Dropcontact, Perplexity, Resend et Lovable AI.
9. Paginer toutes les listes et transferts pouvant dépasser 1 000 lignes,
   vérifier `Content-Range`, et éviter les `.in()` ou payloads non bornés.
10. Durcir le live sans réactiver les événements : policies par rôle, stockage,
    inscription publique, fonctions sans JWT, rétention, alertes et runbook de
    sauvegarde/restauration incluant Storage.
11. Déployer migrations et Edge Functions via Lovable, effectuer uniquement
    des smoke tests non payants/non émetteurs, puis comparer Git, fonctions et
    schéma live.

## Fichiers et zones attendus

- `package.json`, configuration Vitest et `.github/workflows/*`
- `src/App.tsx`, `src/components/AppSidebar.tsx`
- `src/pages/Settings.tsx`, `src/pages/Documentation.tsx`
- `src/pages/*SignalsList.tsx`, `src/pages/ContactsList.tsx`
- `src/hooks/usePappers*.ts`, `src/hooks/useSignals.ts`,
  `src/hooks/useContacts.ts`, `src/hooks/useSettings.ts`
- `supabase/functions/fetch-news/*`, `analyze-articles/*`, `run-full-scan/*`
- `supabase/functions/fetch-pappers/*`, `run-pappers-scan/*`
- `supabase/functions/_shared/apify-linkedin.ts`, `_shared/dropcontact.ts`
- `supabase/functions/enrichment-worker/*`,
  `cron-check-linkedin-enrich/*`, `enrich-contacts-linkedin/*`
- `supabase/functions/send-transactional-email/*`,
  `process-email-queue/*` et nouveau webhook Resend
- nouvelles migrations `supabase/migrations/20260820*.sql`
- `docs/runbooks/*` pour sauvegarde, restauration et exploitation

La liste précise sera ajustée dans ce plan si l'implémentation montre qu'un
autre fichier est nécessaire.

## Vérification

- Tests rouges puis verts sur chaque contrat métier critique.
- `npm run typecheck`
- `npm test -- --run`
- `npm run lint`
- `npm run build`
- vérification statique des Edge Functions et migrations dans une base locale
  ou éphémère si disponible ; sinon qualification explicite de la limite.
- contrôle UI : aucune entrée autonome LinkedIn, mais enrichissement et liens
  de profils toujours présents.
- simulations sans fournisseur : parse invalide Presse repris, pause/stop
  Pappers observés, échec email ne passant jamais à `sent`, webhook idempotent.
- après déploiement : inventaire SQL agrégé, policies, fonctions, jobs et
  compteurs, sans lire de PII ni de secret.

## Risques et hors-scope

- Les soldes et contrats fournisseurs restent impossibles à valider sans accès
  à leurs comptes ; aucun appel payant ne sera utilisé comme test implicite.
- Resend nécessite une clé valide et un secret de webhook live. Le code peut
  être livré avant la configuration de ce secret, mais l'outreach restera
  désactivé tant que la preuve de configuration manque.
- Le RTO réel exige un exercice de restauration ; il ne sera pas simulé sur la
  base de production.
- Les modèles Presse et de résolution ne peuvent recevoir une métrique de
  précision/rappel sans corpus labellisé. Le chantier livre l'instrumentation
  et l'échantillonnage, pas une qualité inventée.
- Les événements, salons, partenaires et présentations ne sont pas réactivés ou
  refondus dans ce chantier.

