import { useState, useEffect, useRef } from 'react';
import { Mail, Send, X, Sparkles, Copy, Check, Loader2, Gift, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSaveMessageFeedback, calculateDiffPercentage } from '@/hooks/useTonalCharter';
import { useCreateInteraction } from '@/hooks/useContactInteractions';
import { GiftTemplateSelector } from '@/components/GiftTemplateSelector';

interface EmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  recipientName: string;
  companyName?: string;
  eventDetail?: string;
  jobTitle?: string;
  contactId?: string;
  signalId?: string;
  hasLogo?: boolean;
}

export function EmailDialog({
  open,
  onOpenChange,
  recipientEmail,
  recipientName,
  companyName,
  eventDetail,
  jobTitle,
  contactId,
  signalId,
  hasLogo,
}: EmailDialogProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [editableEmail, setEditableEmail] = useState(recipientEmail);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasLoggedGeneration, setHasLoggedGeneration] = useState(false);
  const [giftDialogOpen, setGiftDialogOpen] = useState(false);
  const [attachedGiftUrl, setAttachedGiftUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const originalBodyRef = useRef<string>('');
  const originalSubjectRef = useRef<string>('');
  const saveMessageFeedback = useSaveMessageFeedback();
  const createInteraction = useCreateInteraction();

  const firstName = recipientName.split(' ')[0];

  // Générer avec Claude Opus
  const generateWithAI = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-message', {
        body: {
          type: 'email',
          recipientName,
          recipientFirstName: firstName,
          companyName,
          eventDetail,
          jobTitle,
        },
      });

      if (error) throw error;

      if (data?.message) {
        setBody(data.message);
        originalBodyRef.current = data.message;
        if (data.subject) {
          setSubject(data.subject);
          originalSubjectRef.current = data.subject;
        }
        toast.success('Email généré avec votre style');
      }
    } catch (error: any) {
      console.error('Error generating email:', error);
      if (error.message?.includes('429')) {
        toast.error('Limite de requêtes atteinte. Réessayez plus tard.');
      } else {
        toast.error('Erreur lors de la génération. Utilisation du template par défaut.');
        setDefaultTemplate();
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const setDefaultTemplate = () => {
    setSubject(`Félicitations - GOUЯRMET`);
    setBody(`Chère Madame, Cher Monsieur,

J'ai suivi avec intérêt l'actualité de ${companyName || 'votre entreprise'}${eventDetail ? ` concernant ${eventDetail}` : ''}. Permettez-moi de vous adresser mes félicitations.

Chez GOUЯRMET, nous accompagnons les entreprises dans leurs moments importants avec des cadeaux d'affaires haut de gamme et des animations sur-mesure :

• Coffrets gastronomiques personnalisés
• Bougies et chocolats moulés à vos couleurs
• Bars à mousse, à cocktails ou à glace

Je serais ravie d'imaginer ensemble un cadeau ou un évènement à votre image.

Bien cordialement,

Clotilde GAUTIER
Chargée d'évènements, GOUЯRMET
📱 +33 7 83 31 94 43
✉️ clotilde@gourrmet.com
🌐 www.gourrmet.com`);
  };

  // Générer automatiquement à l'ouverture et logger l'interaction
  useEffect(() => {
    if (open && !body) {
      generateWithAI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Log email generation when body is set for the first time
  useEffect(() => {
    if (body && contactId && !hasLoggedGeneration) {
      createInteraction.mutate({
        contactId,
        actionType: 'email_generated',
        newValue: subject || undefined,
        metadata: { company_name: companyName, event_detail: eventDetail }
      });
      setHasLoggedGeneration(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, contactId, hasLoggedGeneration]);

  // Reset quand fermé
  useEffect(() => {
    if (!open) {
      setSubject('');
      setBody('');
      originalBodyRef.current = '';
      originalSubjectRef.current = '';
      setHasLoggedGeneration(false);
      setAttachedGiftUrl(null);
      setEditableEmail(recipientEmail);
    }
  }, [open]);

  const saveFeedbackIfNeeded = () => {
    if (!originalBodyRef.current || !body) return;
    
    const diffPercent = calculateDiffPercentage(originalBodyRef.current, body);
    if (diffPercent > 5) {
      saveMessageFeedback.mutate({
        message_type: 'email',
        original_message: originalBodyRef.current,
        edited_message: body,
        original_subject: originalSubjectRef.current,
        edited_subject: subject,
        context: { job_title: jobTitle, company_name: companyName, event_detail: eventDetail },
      });
      toast.success('Préférence enregistrée', { description: 'Votre style s\'améliore !' });
    }
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Veuillez remplir le sujet et le message');
      return;
    }

    if (!editableEmail || !editableEmail.includes('@')) {
      toast.error('Adresse email du destinataire invalide');
      return;
    }

    setSending(true);
    saveFeedbackIfNeeded();

    try {
      const safeCompany = (companyName || 'gourrmet').replace(/[^a-zA-Z0-9]+/g, '_');
      const giftAttachment = attachedGiftUrl
        ? [{ filename: `cadeau_${safeCompany}.png`, url: attachedGiftUrl }]
        : undefined;

      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to: editableEmail,
          subject,
          body,
          signal_id: signalId,
          contact_id: contactId,
          attachments: giftAttachment,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Email envoyé à ${recipientName}`);

      if (contactId) {
        createInteraction.mutate({
          contactId,
          actionType: 'email_sent',
          newValue: subject,
          metadata: { recipient: editableEmail, company_name: companyName, email_log_id: data?.log_id }
        });
      }

      onOpenChange(false);
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error('Erreur lors de l\'envoi', {
        description: error.message || 'Vérifiez la configuration mail (Resend + domaine gourrmet.com).',
      });
    } finally {
      setSending(false);
    }
  };

  const copyEmail = () => {
    saveFeedbackIfNeeded();
    const fullEmail = `Sujet: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(fullEmail);
    setCopied(true);
    toast.success('Email copié dans le presse-papier');
    
    // Log the copy action
    if (contactId) {
      createInteraction.mutate({
        contactId,
        actionType: 'email_copied',
        metadata: { subject }
      });
    }
    
    setTimeout(() => setCopied(false), 2000);
  };

  const openMailClient = () => {
    saveFeedbackIfNeeded();
    const mailtoLink = `mailto:${editableEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoLink, '_blank');
    toast.success('Client mail ouvert');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Envoyer un email
          </DialogTitle>
          <DialogDescription>
            Email généré par Claude Opus, personnalisé selon le contexte
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Destinataire</Label>
            <Input 
              value={editableEmail} 
              onChange={(e) => setEditableEmail(e.target.value)}
              placeholder="email@exemple.com"
            />
          </div>

          {eventDetail && (
            <div className="text-xs bg-primary/10 text-primary px-3 py-2 rounded-lg">
              <strong>Contexte :</strong> {eventDetail}
            </div>
          )}

          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Claude Opus rédige votre email...</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="subject">Sujet</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={generateWithAI}
                    disabled={isGenerating}
                    className="text-xs text-primary hover:text-primary/80"
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    Régénérer avec IA
                  </Button>
                </div>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objet de l'email..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Votre message..."
                  rows={14}
                  className="text-sm"
                />
              </div>
            </>
          )}

          {/* Gift Attachment Section */}
          {signalId && (
            <div className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Gift className="h-4 w-4 text-primary" />
                  Pièce jointe cadeau
                </p>
                {!attachedGiftUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setGiftDialogOpen(true)}
                    disabled={!hasLogo}
                    className="text-xs"
                  >
                    <Gift className="h-3 w-3 mr-1" />
                    {hasLogo ? 'Générer un visuel' : 'Logo requis'}
                  </Button>
                )}
              </div>
              {attachedGiftUrl && (
                <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-2">
                  <img
                    src={attachedGiftUrl}
                    alt="Cadeau"
                    className="h-16 w-16 rounded object-cover border cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setPreviewOpen(true)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">Visuel personnalisé</p>
                    <p className="text-xs font-medium truncate">{companyName}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = attachedGiftUrl;
                        a.download = `cadeau_${companyName?.replace(/\s+/g, '_')}.png`;
                        a.target = '_blank';
                        a.click();
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAttachedGiftUrl(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
              {/* Image Preview Dialog */}
              {attachedGiftUrl && (
                <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                  <DialogContent className="sm:max-w-[90vw] max-h-[90vh] p-2">
                    <DialogHeader className="sr-only">
                      <DialogTitle>Aperçu du visuel</DialogTitle>
                    </DialogHeader>
                    <img
                      src={attachedGiftUrl}
                      alt="Aperçu cadeau"
                      className="w-full h-auto max-h-[85vh] object-contain rounded"
                    />
                  </DialogContent>
                </Dialog>
              )}
            </div>
          )}

          {/* Gift Template Selector Dialog */}
          {signalId && (
            <GiftTemplateSelector
              signalId={signalId}
              companyName={companyName || ''}
              hasLogo={!!hasLogo}
              open={giftDialogOpen}
              onOpenChange={setGiftDialogOpen}
              onImageGenerated={(url) => {
                setAttachedGiftUrl(url);
                setGiftDialogOpen(false);
              }}
            />
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyEmail}
              disabled={isGenerating || !body}
              className="flex-1"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2 text-success" />
                  Copié !
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copier
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openMailClient}
              disabled={isGenerating || !body}
              className="flex-1"
            >
              <Mail className="h-4 w-4 mr-2" />
              Ouvrir client mail
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Fermer
          </Button>
          <Button 
            onClick={handleSend} 
            disabled={sending || isGenerating || !body} 
            className="bg-primary hover:bg-primary/90"
          >
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Envoi...' : 'Envoyer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
