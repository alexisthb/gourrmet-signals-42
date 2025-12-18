import { useState } from 'react';
import { Copy, Check, ExternalLink, Star, MapPin, Mail, Linkedin, Send, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EmailDialog } from '@/components/EmailDialog';
import { LinkedInMessageDialog } from '@/components/LinkedInMessageDialog';

export interface Contact {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  job_title: string | null;
  location?: string | null;
  email_principal?: string | null;
  email_alternatif?: string | null;
  linkedin_url?: string | null;
  is_priority_target: boolean;
  priority_score: number;
  outreach_status: string;
  companyName?: string;
  eventDetail?: string;
}

interface ContactCardProps {
  contact: Contact;
  onStatusChange: (id: string, status: string) => void;
  className?: string;
}

const OUTREACH_STATUS_OPTIONS = [
  { value: 'new', label: '🆕 Nouveau' },
  { value: 'linkedin_sent', label: '💬 LinkedIn envoyé' },
  { value: 'email_sent', label: '📧 Email envoyé' },
  { value: 'responded', label: '💬 A répondu' },
  { value: 'meeting', label: '📅 RDV planifié' },
  { value: 'converted', label: '✅ Converti' },
  { value: 'not_interested', label: '❌ Pas intéressé' },
];

export function ContactCard({ contact, onStatusChange, className }: ContactCardProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [linkedInDialogOpen, setLinkedInDialogOpen] = useState(false);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const initials = `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`.toUpperCase() || contact.full_name?.[0]?.toUpperCase() || '?';

  return (
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-sm', className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-muted-foreground font-medium">
            {initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{contact.full_name}</span>
              {contact.is_priority_target && (
                <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 px-1.5 py-0.5 rounded">
                  🎯 Cible
                </span>
              )}
            </div>
            {contact.job_title && (
              <div className="text-sm text-muted-foreground">{contact.job_title}</div>
            )}
            {contact.location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                <MapPin className="h-3 w-3" />
                {contact.location}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {[...Array(5)].map((_, i) => (
            <Star
              key={i}
              className={cn(
                'h-4 w-4',
                i < contact.priority_score
                  ? 'text-amber-400 fill-amber-400'
                  : 'text-muted-foreground/20'
              )}
            />
          ))}
        </div>
      </div>

      {/* Coordonnées */}
      <div className="border-t border-border pt-3 space-y-2">
        {contact.email_principal && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              <span className="truncate max-w-[200px]">{contact.email_principal}</span>
            </span>
            <button
              onClick={() => copyToClipboard(contact.email_principal!, 'email_principal')}
              className="flex items-center gap-1 text-primary hover:text-primary/80 text-xs"
            >
              {copied === 'email_principal' ? (
                <>
                  <Check className="h-3 w-3" />
                  Copié
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copier
                </>
              )}
            </button>
          </div>
        )}
        {contact.email_alternatif && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground/70">
              <Mail className="h-3.5 w-3.5" />
              <span className="truncate max-w-[200px]">{contact.email_alternatif}</span>
              <span className="text-xs">(alt)</span>
            </span>
            <button
              onClick={() => copyToClipboard(contact.email_alternatif!, 'email_alt')}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs"
            >
              {copied === 'email_alt' ? (
                <>
                  <Check className="h-3 w-3" />
                  Copié
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copier
                </>
              )}
            </button>
          </div>
        )}
        {contact.linkedin_url && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Linkedin className="h-3.5 w-3.5" />
              LinkedIn
            </span>
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              Ouvrir
            </a>
          </div>
        )}
      </div>

      {/* Statut outreach */}
      <div className="border-t border-border pt-3 mt-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Statut :</span>
            <Select
              value={contact.outreach_status}
              onValueChange={(value) => onStatusChange(contact.id, value)}
            >
              <SelectTrigger className="h-7 text-xs w-auto min-w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTREACH_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1 sm:ml-auto">
            {contact.linkedin_url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLinkedInDialogOpen(true)}
                className="h-7 text-xs"
              >
                <MessageSquare className="h-3 w-3 mr-1" />
                InMail
              </Button>
            )}
            {contact.email_principal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmailDialogOpen(true)}
                className="h-7 text-xs"
              >
                <Send className="h-3 w-3 mr-1" />
                Email
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Email Dialog */}
      <EmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        recipientEmail={contact.email_principal || ''}
        recipientName={contact.full_name}
        companyName={contact.companyName}
        eventDetail={contact.eventDetail}
      />

      {/* LinkedIn Message Dialog */}
      {contact.linkedin_url && (
        <LinkedInMessageDialog
          open={linkedInDialogOpen}
          onOpenChange={setLinkedInDialogOpen}
          linkedinUrl={contact.linkedin_url}
          recipientName={contact.full_name}
          companyName={contact.companyName}
          eventDetail={contact.eventDetail}
        />
      )}
    </div>
  );
}
