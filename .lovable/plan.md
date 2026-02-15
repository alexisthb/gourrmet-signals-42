

# Module "Cadeaux Personnalises" - Plan d'implementation

## Resume

Creation d'un module permettant de recuperer automatiquement le logo d'une entreprise prospectee, puis de generer des photos de mise en scene personnalisees en remplacant le logo existant par celui de l'entreprise, via l'API Lovable AI (modele `google/gemini-3-pro-image-preview`).

---

## Etape 1 : Migration base de donnees

Creer une migration SQL unique comprenant :

- **Colonne `company_logo_url`** (text, nullable) sur la table `signals`
- **Colonne `company_logo_url`** (text, nullable) sur la table `contacts`
- **Table `gift_templates`** : id, name, description, image_url, display_order, is_active, created_at
- **Table `generated_gifts`** : id, signal_id, template_id, company_name, company_logo_url, original_image_url, generated_image_url, prompt_used, status (pending/processing/completed/failed), error_message, created_at
- **Buckets Storage** : `company-logos` (public), `gift-templates` (public), `generated-gifts` (public)
- **Policies RLS** : acces authentifie en lecture/ecriture sur les nouvelles tables et buckets

---

## Etape 2 : Edge Function `fetch-company-logo`

- Recoit `{ signalId, companyName, sourceUrl? }`
- Extrait le domaine depuis `sourceUrl`
- Tente Clearbit Logo API (`https://logo.clearbit.com/{domain}`)
- Fallback : Google Favicon API (`https://www.google.com/s2/favicons?domain={domain}&sz=128`)
- Telecharge l'image, upload dans le bucket `company-logos`
- Met a jour `signals.company_logo_url` avec l'URL publique du bucket
- Ajouter dans `supabase/config.toml`

---

## Etape 3 : Edge Function `generate-gift-image`

- Recoit `{ signalId, templateId }`
- Recupere le logo (`signals.company_logo_url`) et l'image template (`gift_templates.image_url`)
- Cree un enregistrement `generated_gifts` avec status `processing`
- Appelle Lovable AI Gateway avec le modele `google/gemini-3-pro-image-preview` :
  - Envoie l'image template + le logo en multi-modal
  - Utilise le prompt fourni par l'utilisateur (a transmettre a l'etape suivante)
- Upload l'image generee dans le bucket `generated-gifts`
- Met a jour `generated_gifts` avec l'URL et le status `completed` (ou `failed`)
- Gestion des erreurs 429/402
- S'inspire du pattern existant dans `generate-infographic/index.ts`
- Ajouter dans `supabase/config.toml`

---

## Etape 4 : Interface d'administration des templates (Settings)

- Nouvel onglet "Cadeaux" dans la page Settings existante
- Upload des 8 photos templates vers le bucket `gift-templates`
- Formulaire : nom, description, image (drag-and-drop ou file input)
- Grille d'apercu avec reordonnancement (display_order) et activation/desactivation
- Suppression possible

---

## Etape 5 : Affichage logo sur la fiche Signal

Modifier `SignalDetail.tsx` :
- Afficher le logo de l'entreprise dans le header si `company_logo_url` est renseigne
- Bouton "Recuperer le logo" si absent, qui appelle `fetch-company-logo`
- Indicateur de chargement pendant la recuperation
- Hook `useFetchCompanyLogo` pour encapsuler l'appel

---

## Etape 6 : Selecteur de templates et generation

- Nouveau composant `GiftTemplateSelector.tsx` :
  - Dialog/Sheet accessible depuis la fiche signal (bouton "Cadeau personnalise")
  - Grille 2x4 des templates actifs
  - Au clic : confirmation puis appel a `generate-gift-image`
  - Loader pendant la generation (quelques secondes)
  - Affichage du resultat avec options : telecharger, copier, regenerer
- Hook `useGiftTemplates` pour charger les templates
- Hook `useGenerateGift` pour declencher et suivre la generation

---

## Etape 7 : Historique des cadeaux generes

- Section dans la fiche signal montrant les cadeaux generes pour ce signal
- Hook `useGeneratedGifts(signalId)` pour recuperer l'historique
- Miniatures cliquables avec date et template utilise
- Option de re-generation avec un autre template

---

## Details techniques

### Fichiers a creer
| Fichier | Role |
|---------|------|
| `supabase/migrations/xxx.sql` | Schema DB + buckets + RLS |
| `supabase/functions/fetch-company-logo/index.ts` | Recuperation logo |
| `supabase/functions/generate-gift-image/index.ts` | Generation image IA |
| `src/hooks/useCompanyLogo.ts` | Hook fetch logo |
| `src/hooks/useGiftTemplates.ts` | Hook CRUD templates |
| `src/hooks/useGeneratedGifts.ts` | Hook generation + historique |
| `src/components/GiftTemplateSelector.tsx` | Selecteur de templates |
| `src/components/GiftResultViewer.tsx` | Affichage resultat |

### Fichiers a modifier
| Fichier | Modification |
|---------|-------------|
| `src/pages/SignalDetail.tsx` | Logo + bouton cadeau |
| `src/pages/Settings.tsx` | Onglet admin templates |
| `supabase/config.toml` | 2 nouvelles functions |

### Dependances
- Aucune nouvelle dependance npm requise
- Utilise `LOVABLE_API_KEY` deja configure
- Clearbit Logo API : gratuite, sans cle API
- Google Favicon API : gratuite, sans cle API

