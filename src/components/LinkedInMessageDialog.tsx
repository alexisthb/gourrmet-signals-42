import { useState, useEffect } from 'react';
import { Linkedin, Copy, Check, ExternalLink } from 'lucide-react';
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

interface LinkedInMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedinUrl: string;
  recipientName: string;
  companyName?: string;
  eventDetail?: string;
}

// Fonction pour formater l'accroche selon le type d'événement
const formatEventHook = (eventDetail?: string): string => {
  if (!eventDetail) {
    return "J'ai suivi avec intérêt l'actualité de votre entreprise";
  }

  const event = eventDetail.toLowerCase().trim();

  // Levée de fonds
  if (event.includes('levée') || event.includes('leve') || event.includes('million') || event.includes('financement')) {
    return `Toutes mes félicitations pour cette levée de fonds ! C'est une étape importante qui témoigne de la confiance des investisseurs dans votre projet`;
  }

  // Nomination
  if (event.includes('nomin') || event.includes('rejoint') || event.includes('nommé') || event.includes('promu')) {
    return `Félicitations pour cette nomination ! C'est une reconnaissance bien méritée de votre expertise`;
  }

  // Anniversaire d'entreprise
  if (event.includes('anniversaire') || event.includes('ans') || event.includes('fête')) {
    return `Félicitations pour cet anniversaire ! C'est un jalon important qui mérite d'être célébré`;
  }

  // Distinction / Prix
  if (event.includes('prix') || event.includes('récompense') || event.includes('distinction') || event.includes('label')) {
    return `Bravo pour cette distinction ! C'est une belle reconnaissance de votre excellence`;
  }

  // Expansion / Ouverture
  if (event.includes('ouverture') || event.includes('expansion') || event.includes('nouveau') || event.includes('lance')) {
    return `Félicitations pour ce développement ! C'est un signe fort de croissance et d'ambition`;
  }

  // M&A / Acquisition
  if (event.includes('acquisition') || event.includes('rachat') || event.includes('fusion') || event.includes('rapprochement')) {
    return `Félicitations pour cette opération stratégique ! C'est une étape majeure dans votre développement`;
  }

  // Par défaut - formulation générique mais naturelle
  return `J'ai lu avec intérêt l'actualité concernant ${eventDetail}. Toutes mes félicitations pour cette belle nouvelle`;
};

export function LinkedInMessageDialog({
  open,
  onOpenChange,
  linkedinUrl,
  recipientName,
  companyName,
  eventDetail,
}: LinkedInMessageDialogProps) {
  const [copied, setCopied] = useState(false);

  const generateTemplate = () => {
    const firstName = recipientName.split(' ')[0];
    const eventHook = formatEventHook(eventDetail);
    
    return `Bonjour ${firstName},

${eventHook}.

Chez Gourrmet, nous accompagnons les entreprises dans leurs moments importants avec des cadeaux d'affaires haut de gamme : coffrets gastronomiques, champagnes d'exception, créations sur-mesure...

Si vous souhaitez marquer cet événement avec élégance, je serais ravi d'en discuter avec vous.

📞 +33 7 83 31 94 43
📧 patrick.oualid@gourrmet.com
🌐 www.gourrmet.com

À très bientôt,
Patrick Oualid
Fondateur de Gourrmet`;
  };

  const [message, setMessage] = useState(generateTemplate());

  // Régénérer le template quand les props changent
  useEffect(() => {
    setMessage(generateTemplate());
  }, [recipientName, companyName, eventDetail]);

  const copyMessage = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('Message copié dans le presse-papier');
    setTimeout(() => setCopied(false), 2000);
  };

  const openLinkedIn = () => {
    window.open(linkedinUrl, '_blank');
    toast.info('Collez le message dans la fenêtre LinkedIn');
  };

  const copyAndOpen = () => {
    navigator.clipboard.writeText(message);
    toast.success('Message copié !');
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
            Préparez votre message puis copiez-le avant d'ouvrir LinkedIn
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

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Votre message..."
            rows={12}
            className="resize-none text-sm"
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyMessage}
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
                  Copier le message
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openLinkedIn}
              className="flex-1"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Ouvrir LinkedIn
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button onClick={copyAndOpen} className="bg-[#0077B5] hover:bg-[#005885]">
            <Linkedin className="h-4 w-4 mr-2" />
            Copier & Ouvrir LinkedIn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
