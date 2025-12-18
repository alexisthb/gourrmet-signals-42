import { useState } from 'react';
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
    const eventText = eventDetail 
      ? eventDetail.toLowerCase().replace(/^(a |le |la |les |l')/, '')
      : 'cette belle actualité';
    
    return `Bonjour, je suis Patrick Oualid, fondateur de @Gourrmet !

Bravo pour ${eventText} ! Si vous fêtez cet évènement, nous serions ravis d'être vos partenaires pour cette formidable occasion.

Je me tiens à votre disposition ici, par téléphone au +33 7 83 31 94 43 ou par mail patrick.oualid@gourrmet.com.

Sinon, vous pouvez retrouver la description de tous nos extraordinaires produits sur le nouveau site www.gourrmet.com.

À très vite !`;
  };

  const [message, setMessage] = useState(generateTemplate());

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
            <Linkedin className="h-5 w-5 text-blue-600" />
            Message LinkedIn
          </DialogTitle>
          <DialogDescription>
            Préparez votre message puis copiez-le avant d'ouvrir LinkedIn
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Destinataire: <strong className="text-foreground">{recipientName}</strong></span>
            {companyName && <span className="text-xs">@ {companyName}</span>}
          </div>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Votre message..."
            rows={10}
            className="resize-none"
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
                  <Check className="h-4 w-4 mr-2 text-green-500" />
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
          <Button onClick={copyAndOpen} className="bg-blue-600 hover:bg-blue-700">
            <Linkedin className="h-4 w-4 mr-2" />
            Copier & Ouvrir LinkedIn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
