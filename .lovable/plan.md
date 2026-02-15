

# Refonte du fallback logo : utiliser le vrai Manus (agent IA)

## Probleme actuel

La fonction `fetchLogoViaManus` n'utilise pas du tout Manus. Elle appelle Gemini (Lovable AI) pour deviner un domaine, puis retombe sur Clearbit/Google Favicon -- les memes sources qui echouent. Le vrai Manus (api.manus.ai) est un agent autonome capable de naviguer sur le web, trouver le vrai logo d'une entreprise, et le telecharger.

## Solution

Utiliser l'API Manus (meme pattern que `trigger-manus-enrichment`) pour demander a l'agent de :
1. Trouver le site officiel de l'entreprise
2. Telecharger le logo en haute qualite (PNG/SVG, fond transparent si possible)
3. Deposer le fichier en sortie (output_file)

Comme Manus est **asynchrone** (la tache prend quelques minutes), il faut :
- Lancer la tache Manus et stocker le `task_id`
- Creer une edge function de polling pour verifier le statut
- Recuperer le fichier logo depuis l'output de Manus une fois termine

## Architecture

```text
Bouton "Forcer IA" sur fiche signal
  |
  v
fetch-company-logo (forceAI=true)
  |
  v
Appel api.manus.ai/v1/tasks avec prompt logo
  |
  v
Stocke manus_task_id dans signals (nouveau champ logo_manus_task_id)
Retourne au frontend : "Recherche Manus lancee"
  |
  v
Frontend poll check-logo-manus-status toutes les 10s
  |
  v
check-logo-manus-status :
  - GET api.manus.ai/v1/tasks/{task_id}
  - Si completed : telecharge l'image output_file
  - Upload dans bucket company-logos
  - Met a jour signals.company_logo_url
  - Retourne { status: "completed", logoUrl }
```

## Etapes d'implementation

### 1. Migration DB

Ajouter une colonne `logo_manus_task_id` (text, nullable) sur la table `signals` pour stocker l'ID de tache Manus en cours.

### 2. Modifier `fetch-company-logo/index.ts`

Remplacer `fetchLogoViaManus` (qui utilise Gemini) par un vrai appel a l'API Manus :

- **Prompt Manus** : "Trouve le logo officiel de l'entreprise {companyName}. Telecharge-le en haute qualite (PNG ou SVG, minimum 200x200px, fond transparent si possible). Retourne le fichier image en output."
- **Appel** : `POST https://api.manus.ai/v1/tasks` avec `API_KEY` header (meme pattern que `scan-linkedin-manus`)
- **Retour** : `{ status: "manus_processing", manus_task_id: "..." }` (status 202)

Le pipeline reste :
1. Clearbit (rapide, synchrone)
2. Si echec + `forceAI` ou fallback auto : lancer Manus (asynchrone)
3. Google Favicon reste en tout dernier recours si Manus n'est pas disponible

### 3. Creer `check-logo-manus-status/index.ts`

Nouvelle edge function qui :
- Recoit `{ signalId }`
- Lit `logo_manus_task_id` depuis le signal
- Appelle `GET https://api.manus.ai/v1/tasks/{task_id}` pour verifier le statut
- Si `completed` :
  - Parcourt `output` pour trouver le `output_file` de type image
  - Telecharge l'image depuis `fileUrl`
  - Upload dans le bucket `company-logos`
  - Met a jour `signals.company_logo_url`
  - Efface `logo_manus_task_id`
  - Retourne `{ status: "completed", logoUrl }`
- Si en cours : retourne `{ status: "processing" }`
- Ajouter dans `supabase/config.toml`

### 4. Modifier le hook `useCompanyLogo.ts`

- Quand le backend retourne `status: "manus_processing"`, demarrer un polling (setInterval 10s) qui appelle `check-logo-manus-status`
- Afficher un toast "Manus recherche le logo..." avec un indicateur de chargement
- Quand le polling retourne `completed`, invalider les queries et afficher le logo

### 5. Modifier l'UI `SignalDetail.tsx`

- L'option "Forcer recherche IA" dans le dropdown lance le flow Manus
- Pendant le processing : afficher un spinner/badge "Recherche en cours..." sur le logo
- Quand termine : le logo s'affiche automatiquement

## Details techniques

### Fichiers a creer
| Fichier | Role |
|---------|------|
| `supabase/functions/check-logo-manus-status/index.ts` | Polling du statut Manus + recuperation du logo |

### Fichiers a modifier
| Fichier | Modification |
|---------|-------------|
| `supabase/functions/fetch-company-logo/index.ts` | Remplacer le fallback Gemini par un vrai appel Manus |
| `src/hooks/useCompanyLogo.ts` | Ajouter le polling pour les taches Manus async |
| `src/pages/SignalDetail.tsx` | Indicateur visuel "recherche en cours" |

### Migration SQL
| Changement | Detail |
|------------|--------|
| `signals.logo_manus_task_id` | Colonne text nullable pour stocker l'ID de tache Manus |

### Pas de nouvelles dependances

Le pattern Manus est deja implemente dans le projet (`trigger-manus-enrichment`, `check-manus-status`). On reutilise exactement la meme logique.

### Credits Manus

Il faudra verifier les credits Manus avant de lancer la tache (meme pattern que `scan-linkedin-manus` avec `manus_plan_settings` et `manus_credit_usage`).

