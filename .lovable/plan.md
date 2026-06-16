## Objectif

Remplacer l'envoi direct via Resend (qui échoue parce que `gourrmet.com` n'est pas vérifié) par **Lovable Emails** sur le sous-domaine `notify.gourrmet.com`. Patrick conserve l'expéditeur `Clotilde Gautier <clotilde@notify.gourrmet.com>` et bénéficie d'une file d'attente avec retry, suppression list, et logs centralisés.

## Étapes

### 1. Provisionner le domaine email
- Ouvrir le dialogue de setup pour créer `notify.gourrmet.com` (délégation NS vers Lovable, SPF/DKIM/DMARC auto-gérés).
- Patrick devra ajouter 2 enregistrements NS chez son registrar (ns3.lovable.cloud / ns4.lovable.cloud). Propagation jusqu'à 72 h, mais le code peut être déployé sans attendre.

### 2. Mettre en place l'infra email
- Créer les tables `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`, la file pgmq `transactional_emails`, le cron `process-email-queue` et les RPC associés.

### 3. Scaffold du système transactionnel
- Générer la fonction `send-transactional-email`, le handler unsubscribe et un template React Email exemple.
- Créer un template `outreach-message` (kebab-case `.tsx`) qui prend en props : `subject`, `bodyHtml` ou `bodyText`, `senderName`, et qui rend le contenu existant généré par `generate-message` avec la charte (Montserrat/Poppins, corail/turquoise).

### 4. Migrer la fonction `send-email` actuelle
- Remplacer l'appel direct `fetch('https://api.resend.com/emails', ...)` par `supabase.functions.invoke('send-transactional-email', { body: { templateName: 'outreach-message', recipientEmail, idempotencyKey: \`signal-\${signal_id}-\${Date.now()}\`, templateData: { subject, body, senderName } } })`.
- Conserver la persistance dans `emails_sent` pour ne rien casser dans le pipeline (`auto_transition_sent_on_email` trigger, timeline contact, dashboard pipeline). Le `provider_message_id` sera celui retourné par Lovable Emails.
- Gérer les pièces jointes : Lovable Emails ne supporte pas les pièces jointes ; on passera donc par un **lien de téléchargement Supabase Storage** inséré dans le corps de l'email (la majorité des PJ actuelles sont des PDF présentation déjà uploadés dans le bucket `presentations`). Patrick sera averti par un toast si une PJ est jointe.

### 5. Mettre à jour le sender par défaut
- Setting `email_sender` → `Clotilde Gautier <clotilde@notify.gourrmet.com>`.
- Mettre à jour les constantes `SENDER_DOMAIN` (notify.gourrmet.com) et `FROM_DOMAIN` (gourrmet.com display si activé) dans la fonction scaffoldée.

### 6. Page unsubscribe
- Créer `/unsubscribe` dans l'app (lecture token, POST validation), branchée sur `handle-email-unsubscribe`.

### 7. Mémoire & nettoyage
- Mettre à jour `mem://features/email-delivery-system` : Lovable Emails (queue + retry), sender `clotilde@notify.gourrmet.com`, pas de PJ → lien Storage.
- Optionnel : `RESEND_API_KEY` reste en place pour transition, à supprimer plus tard.

## Détails techniques

- Lovable Emails utilise `LOVABLE_API_KEY` (déjà provisionné), pas besoin de nouveau secret.
- File `transactional_emails`, TTL 60 min, retry 5 tentatives → DLQ. Suppression list automatique sur bounce/complaint.
- L'idempotency key empêche les doublons si l'utilisateur clique deux fois sur "Envoyer".
- `EmailDialog.tsx` et `LinkedInMessageDialog.tsx` continuent d'appeler `send-email` côté front ; aucun changement UI requis.
- Trigger SQL `auto_transition_sent_on_email` reste valide tant qu'on continue d'insérer dans `emails_sent` avec `status='sent'`.

## Action requise de Patrick

Après l'implémentation : ajouter 2 enregistrements NS chez le registrar de `gourrmet.com` (instructions fournies dans le dialogue Lovable Emails). Les envois démarrent dès propagation DNS.
