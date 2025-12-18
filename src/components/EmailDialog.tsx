import { useState, useEffect } from 'react';
import { Mail, Send, X, Sparkles, Copy, Check, Loader2 } from 'lucide-react';
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

interface EmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  recipientName: string;
  companyName?: string;
  eventDetail?: string;
  jobTitle?: string;
}

export function EmailDialog({
  open,
  onOpenChange,
  recipientEmail,
  recipientName,
  companyName,
  eventDetail,
  jobTitle,
}: EmailDialogProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

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
        if (data.subject) {
          setSubject(data.subject);
        }
        toast.success('Email généré par Claude Opus');
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
    setSubject(`Félicitations - Gourrmet`);
    setBody(`Bonjour ${firstName},

J'ai suivi avec intérêt l'actualité de ${companyName || 'votre entreprise'}${eventDetail ? ` concernant ${eventDetail}` : ''}. Permettez-moi de vous adresser mes félicitations.

Chez Gourrmet, nous sommes spécialisés dans les cadeaux d'affaires haut de gamme. Nous accompagnons les entreprises dans leurs moments importants avec des créations d'exception :

• Coffrets gastronomiques personnalisés
• Champagnes et grands crus sélectionnés
• Créations sur-mesure à votre image

Si vous souhaitez marquer cet événement avec élégance, je serais ravi d'échanger avec vous.

Bien cordialement,

Patrick Oualid
Fondateur de Gourrmet
📞 +33 7 83 31 94 43
🌐 www.gourrmet.com`);
  };

  // Générer automatiquement à l'ouverture
  useEffect(() => {
    if (open && !body) {
      generateWithAI();
    }
  }, [open]);

  // Reset quand fermé
  useEffect(() => {
    if (!open) {
      setSubject('');
      setBody('');
    }
  }, [open]);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Veuillez remplir le sujet et le message');
      return;
    }

    setSending(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    console.log('[MOCK EMAIL]', {
      to: recipientEmail,
      subject,
      body,
      timestamp: new Date().toISOString(),
    });

    toast.success(`Email envoyé à ${recipientName}`, {
      description: '(Mode démo - email non réellement envoyé)',
    });

    setSending(false);
    onOpenChange(false);
  };

  const copyEmail = () => {
    const fullEmail = `Sujet: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(fullEmail);
    setCopied(true);
    toast.success('Email copié dans le presse-papier');
    setTimeout(() => setCopied(false), 2000);
  };

  const openMailClient = () => {
    const mailtoLink = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
            <Input value={`${recipientName} <${recipientEmail}>`} disabled className="bg-muted" />
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
            {sending ? 'Envoi...' : 'Envoyer (démo)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
