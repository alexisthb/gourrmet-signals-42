import { useState, useEffect, useRef } from 'react';
import { Linkedin, Copy, Check, ExternalLink, Sparkles, Loader2, Gift, Download, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSaveMessageFeedback, calculateDiffPercentage } from '@/hooks/useTonalCharter';
import { useCreateInteraction } from '@/hooks/useContactInteractions';
import { GiftTemplateSelector } from '@/components/GiftTemplateSelector';

interface LinkedInMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedinUrl: string;
  recipientName: string;
  companyName?: string;
  eventDetail?: string;
  jobTitle?: string;
  contactId?: string;
  signalId?: string;
  hasLogo?: boolean;
}

export function LinkedInMessageDialog({
  open,
  onOpenChange,
  linkedinUrl,
  recipientName,
  companyName,
  eventDetail,
  jobTitle,
  contactId,
  signalId,
  hasLogo,
}: LinkedInMessageDialogProps) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasLoggedGeneration, setHasLoggedGeneration] = useState(false);
  const [giftDialogOpen, setGiftDialogOpen] = useState(false);
  const [attachedGiftUrl, setAttachedGiftUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const originalMessageRef = useRef<string>('');
  const saveMessageFeedback = useSaveMessageFeedback();
  const createInteraction = useCreateInteraction();

  const firstName = recipientName.split(' ')[0];

  const generateWithAI = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-message', {
        body: {
          type: 'inmail',
          recipientName,
          recipientFirstName: firstName,
          companyName,
          eventDetail,
          jobTitle,
        },
      });

      if (error) throw error;

      if (data?.message) {
        setMessage(data.message);
        originalMessageRef.current = data.message;
        toast.success('Message généré avec votre style');
      }
    } catch (error: any) {
      console.error('Error generating message:', error);
      if (error.message?.includes('429')) {
        toast.error('Limite de requêtes atteinte. Réessayez plus tard.');
      } else {
        toast.error('Erreur lors de la génération. Utilisation du template par défaut.');
        const defaultMsg = getDefaultTemplate();
        setMessage(defaultMsg);
        originalMessageRef.current = defaultMsg;
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const getDefaultTemplate = () => {
    return `Bonjour ${firstName},

J'ai suivi avec intérêt l'actualité de ${companyName || 'votre entreprise'}${eventDetail ? ` concernant ${eventDetail}` : ''}. Toutes mes félicitations !

Chez Gourrmet, nous accompagnons les entreprises dans leurs moments importants avec des cadeaux d'affaires haut de gamme.

Si vous souhaitez marquer cet événement avec élégance, je serais ravi d'en discuter.

📞 +33 7 83 31 94 43
📧 patrick.oualid@gourrmet.com
🌐 www.gourrmet.com

Patrick Oualid
Fondateur de Gourrmet`;
  };

  const saveFeedbackIfNeeded = () => {
    if (!originalMessageRef.current || !message) return;
    
    const diffPercent = calculateDiffPercentage(originalMessageRef.current, message);
    if (diffPercent > 5) {
      saveMessageFeedback.mutate({
        message_type: 'inmail',
        original_message: originalMessageRef.current,
        edited_message: message,
        context: { job_title: jobTitle, company_name: companyName, event_detail: eventDetail },
      });
      toast.success('Préférence enregistrée', { description: 'Votre style s\'améliore !' });
    }
  };

  useEffect(() => {
    if (open && !message) {
      generateWithAI();
    }
  }, [open]);

  // Log LinkedIn message generation
  useEffect(() => {
    if (message && contactId && !hasLoggedGeneration) {
      createInteraction.mutate({
        contactId,
        actionType: 'linkedin_message_generated',
        metadata: { company_name: companyName, event_detail: eventDetail }
      });
      setHasLoggedGeneration(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, contactId, hasLoggedGeneration]);

  useEffect(() => {
    if (!open) {
      setMessage('');
      originalMessageRef.current = '';
      setHasLoggedGeneration(false);
      setAttachedGiftUrl(null);
    }
  }, [open]);

  const copyMessage = () => {
    saveFeedbackIfNeeded();
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('Message copié dans le presse-papier');
    
    // Log the copy action
    if (contactId) {
      createInteraction.mutate({
        contactId,
        actionType: 'linkedin_message_copied',
      });
    }
    
    setTimeout(() => setCopied(false), 2000);
  };

  const openLinkedIn = () => {
    window.open(linkedinUrl, '_blank');
    toast.info('Collez le message dans la fenêtre LinkedIn');
  };

  const copyAndOpen = () => {
    saveFeedbackIfNeeded();
    navigator.clipboard.writeText(message);
    toast.success('Message copié !');
    
    // Log the copy action
    if (contactId) {
      createInteraction.mutate({
        contactId,
        actionType: 'linkedin_message_copied',
      });
    }
    
    setTimeout(() => {
      window.open(linkedinUrl, '_blank');
      onOpenChange(false);
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Linkedin className="h-5 w-5 text-[#0077B5]" />
            Message LinkedIn
          </DialogTitle>
          <DialogDescription>
            Message généré par Claude Opus, personnalisé selon le contexte
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Destinataire: <strong className="text-foreground">{recipientName}</strong></span>
            {companyName && <span className="text-xs bg-muted px-2 py-1 rounded">{companyName}</span>}
          </div>

          {eventDetail && (
            <div className="text-xs bg-primary/10 text-primary px-3 py-2 rounded-lg">
              <strong>Contexte :</strong> {eventDetail}
            </div>
          )}

          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Claude Opus rédige votre message...</p>
            </div>
          ) : (
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Votre message..."
              rows={12}
              className="resize-none text-sm"
            />
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
              onClick={generateWithAI}
              disabled={isGenerating}
              className="text-primary border-primary/30 hover:bg-primary/10"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Régénérer
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyMessage}
              disabled={isGenerating || !message}
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
              onClick={openLinkedIn}
              disabled={isGenerating}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button 
            onClick={copyAndOpen} 
            disabled={isGenerating || !message}
            className="bg-[#0077B5] hover:bg-[#005885]"
          >
            <Linkedin className="h-4 w-4 mr-2" />
            Copier & Ouvrir LinkedIn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
