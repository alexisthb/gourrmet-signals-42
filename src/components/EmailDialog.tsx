import { useState } from 'react';
import { Mail, Send, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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

  const generateTemplate = () => {
    const template = `Bonjour ${recipientName.split(' ')[0]},

J'ai remarqué que ${companyName || 'votre entreprise'} ${eventDetail ? `vient de ${eventDetail.toLowerCase()}` : 'connaît une actualité intéressante'}.

[Votre message personnalisé ici]

Cordialement,
[Votre nom]`;
    setBody(template);
    setSubject(`Opportunité de collaboration avec ${companyName || 'votre entreprise'}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Envoyer un email
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Destinataire</Label>
            <Input value={`${recipientName} <${recipientEmail}>`} disabled />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Sujet</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet de l'email..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="body">Message</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={generateTemplate}
                className="text-xs"
              >
                Générer template
              </Button>
            </div>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Votre message..."
              rows={10}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Annuler
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Envoi...' : 'Envoyer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
