import { useState, useEffect } from 'react';
import { Mail, Send, X, Sparkles, Copy, Check } from 'lucide-react';
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

interface EmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  recipientName: string;
  companyName?: string;
  eventDetail?: string;
}

// Fonction pour formater l'accroche selon le type d'événement
const formatEventContext = (eventDetail?: string, companyName?: string): { hook: string; subject: string } => {
  const company = companyName || 'votre entreprise';
  
  if (!eventDetail) {
    return {
      hook: `J'ai suivi avec attention l'actualité de ${company} et je souhaitais vous féliciter pour vos récents développements.`,
      subject: `Félicitations - Proposition de collaboration avec Gourrmet`
    };
  }

  const event = eventDetail.toLowerCase().trim();

  // Levée de fonds
  if (event.includes('levée') || event.includes('leve') || event.includes('million') || event.includes('financement')) {
    return {
      hook: `Je tenais à vous adresser mes sincères félicitations pour votre récente levée de fonds. C'est une étape majeure qui témoigne de la solidité de votre projet et de la confiance que les investisseurs placent en ${company}.`,
      subject: `Félicitations pour votre levée de fonds - Gourrmet`
    };
  }

  // Nomination
  if (event.includes('nomin') || event.includes('rejoint') || event.includes('nommé') || event.includes('promu')) {
    return {
      hook: `Je vous adresse mes chaleureuses félicitations pour votre récente nomination. C'est une reconnaissance méritée de votre expertise et de votre parcours.`,
      subject: `Félicitations pour votre nomination - Gourrmet`
    };
  }

  // Anniversaire d'entreprise
  if (event.includes('anniversaire') || event.includes('ans') || event.includes('fête')) {
    return {
      hook: `Je vous adresse mes félicitations pour cet anniversaire d'entreprise. C'est un jalon important qui mérite d'être célébré dignement.`,
      subject: `Joyeux anniversaire à ${company} - Gourrmet`
    };
  }

  // Distinction / Prix
  if (event.includes('prix') || event.includes('récompense') || event.includes('distinction') || event.includes('label')) {
    return {
      hook: `Toutes mes félicitations pour cette distinction bien méritée ! C'est une belle reconnaissance de l'excellence de ${company}.`,
      subject: `Félicitations pour votre distinction - Gourrmet`
    };
  }

  // Expansion / Ouverture
  if (event.includes('ouverture') || event.includes('expansion') || event.includes('nouveau') || event.includes('lance')) {
    return {
      hook: `Je vous félicite pour ce nouveau développement ! C'est un signal fort de croissance et d'ambition pour ${company}.`,
      subject: `Félicitations pour votre expansion - Gourrmet`
    };
  }

  // M&A / Acquisition
  if (event.includes('acquisition') || event.includes('rachat') || event.includes('fusion') || event.includes('rapprochement')) {
    return {
      hook: `Je tenais à vous féliciter pour cette opération stratégique. C'est une étape majeure dans le développement de ${company}.`,
      subject: `Félicitations pour cette opération - Gourrmet`
    };
  }

  // Par défaut
  return {
    hook: `J'ai lu avec intérêt l'actualité concernant ${eventDetail}. Permettez-moi de vous adresser mes félicitations pour cette belle nouvelle.`,
    subject: `Félicitations - Proposition de Gourrmet`
  };
};

export function EmailDialog({
  open,
  onOpenChange,
  recipientEmail,
  recipientName,
  companyName,
  eventDetail,
}: EmailDialogProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateTemplate = () => {
    const firstName = recipientName.split(' ')[0];
    const { hook, subject: generatedSubject } = formatEventContext(eventDetail, companyName);
    
    const template = `Bonjour ${firstName},

${hook}

Chez Gourrmet, nous sommes spécialisés dans les cadeaux d'affaires haut de gamme. Nous accompagnons les entreprises dans leurs moments importants avec des créations d'exception :

• Coffrets gastronomiques personnalisés
• Champagnes et grands crus sélectionnés
• Créations sur-mesure à votre image

Si vous souhaitez marquer cet événement avec élégance auprès de vos collaborateurs, partenaires ou clients, je serais ravi d'échanger avec vous sur vos besoins.

Je reste à votre disposition pour un échange téléphonique ou une présentation de nos collections.

Bien cordialement,

Patrick Oualid
Fondateur de Gourrmet
📞 +33 7 83 31 94 43
🌐 www.gourrmet.com`;

    setBody(template);
    setSubject(generatedSubject);
  };

  // Générer le template à l'ouverture
  useEffect(() => {
    if (open && !body) {
      generateTemplate();
    }
  }, [open]);

  // Régénérer quand les props changent
  useEffect(() => {
    if (open) {
      generateTemplate();
    }
  }, [recipientName, companyName, eventDetail]);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Veuillez remplir le sujet et le message');
      return;
    }

    setSending(true);
    
    // Mock sending - simulate network delay
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
    setSubject('');
    setBody('');
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
            Préparez votre email personnalisé basé sur le contexte du signal
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="subject">Sujet</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={generateTemplate}
                className="text-xs text-primary hover:text-primary/80"
              >
                <Sparkles className="h-3 w-3 mr-1" />
                Régénérer template
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

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyEmail}
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
                  Copier l'email
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openMailClient}
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
          <Button onClick={handleSend} disabled={sending} className="bg-primary hover:bg-primary/90">
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Envoi...' : 'Envoyer (démo)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
