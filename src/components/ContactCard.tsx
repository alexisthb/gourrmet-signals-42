import { useState } from 'react';
import { Copy, Check, ExternalLink, Star, MapPin, Mail, Linkedin, MessageSquare, Phone } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

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
  phone?: string | null;
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
  { value: 'new', label: 'Nouveau', color: 'bg-muted text-muted-foreground' },
  { value: 'linkedin_sent', label: 'LinkedIn', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'email_sent', label: 'Email', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'responded', label: 'Répondu', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'meeting', label: 'RDV', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  { value: 'converted', label: 'Converti', color: 'bg-success/20 text-success' },
  { value: 'not_interested', label: 'Refusé', color: 'bg-destructive/10 text-destructive' },
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
  const currentStatus = OUTREACH_STATUS_OPTIONS.find(s => s.value === contact.outreach_status);

  return (
    <TooltipProvider>
      <div className={cn(
        'group bg-card border border-border rounded-lg overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/30',
        className
      )}>
        {/* Header avec avatar et score */}
        <div className="relative px-5 pt-5 pb-4">
          {/* Ligne dorée en haut */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
          
          <div className="flex items-start gap-4">
            {/* Avatar élégant */}
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary/20 flex items-center justify-center">
                <span className="text-lg font-serif font-semibold text-primary">{initials}</span>
              </div>
              {contact.is_priority_target && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center shadow-md">
                  <Star className="h-3 w-3 text-primary-foreground fill-primary-foreground" />
                </div>
              )}
            </div>

            {/* Infos principales */}
            <div className="flex-1 min-w-0">
              <h3 className="font-serif font-semibold text-lg text-foreground leading-tight truncate">
                {contact.full_name}
              </h3>
              {contact.job_title && (
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{contact.job_title}</p>
              )}
              {contact.location && (
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground/70">
                  <MapPin className="h-3 w-3" />
                  <span className="truncate">{contact.location}</span>
                </div>
              )}
            </div>

            {/* Score étoiles */}
            <div className="flex gap-0.5 flex-shrink-0">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    'h-3.5 w-3.5 transition-colors',
                    i < contact.priority_score
                      ? 'text-primary fill-primary'
                      : 'text-border'
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Section coordonnées */}
        <div className="px-5 py-3 bg-muted/30 border-y border-border/50 space-y-2">
          {contact.email_principal && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-4 w-4 text-primary/70 flex-shrink-0" />
                <span className="text-sm truncate">{contact.email_principal}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => copyToClipboard(contact.email_principal!, 'email')}
                    className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                  >
                    {copied === 'email' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{copied === 'email' ? 'Copié !' : 'Copier l\'email'}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {contact.phone && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Phone className="h-4 w-4 text-primary/70 flex-shrink-0" />
                <span className="text-sm truncate">{contact.phone}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => copyToClipboard(contact.phone!, 'phone')}
                    className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                  >
                    {copied === 'phone' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{copied === 'phone' ? 'Copié !' : 'Copier le téléphone'}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {contact.linkedin_url && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Linkedin className="h-4 w-4 text-[#0077B5] flex-shrink-0" />
                <span className="text-sm text-muted-foreground">LinkedIn</span>
              </div>
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md hover:bg-[#0077B5]/10 text-[#0077B5] transition-colors flex-shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>

        {/* Footer avec statut et actions */}
        <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Statut */}
          <Select
            value={contact.outreach_status}
            onValueChange={(value) => onStatusChange(contact.id, value)}
          >
            <SelectTrigger className={cn(
              "h-8 text-xs w-auto min-w-[120px] border-0 font-medium",
              currentStatus?.color
            )}>
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

          {/* Actions */}
          <div className="flex items-center gap-2">
            {contact.linkedin_url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLinkedInDialogOpen(true)}
                className="h-8 text-xs gap-1.5 border-[#0077B5]/30 text-[#0077B5] hover:bg-[#0077B5]/10 hover:border-[#0077B5]/50"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                InMail
              </Button>
            )}
            {contact.email_principal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmailDialogOpen(true)}
                className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
              >
                <Mail className="h-3.5 w-3.5" />
                Email
              </Button>
            )}
          </div>
        </div>

        {/* Dialogs */}
        <EmailDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          recipientEmail={contact.email_principal || ''}
          recipientName={contact.full_name}
          companyName={contact.companyName}
          eventDetail={contact.eventDetail}
          jobTitle={contact.job_title || undefined}
        />

        {contact.linkedin_url && (
          <LinkedInMessageDialog
            open={linkedInDialogOpen}
            onOpenChange={setLinkedInDialogOpen}
            linkedinUrl={contact.linkedin_url}
            recipientName={contact.full_name}
            companyName={contact.companyName}
            eventDetail={contact.eventDetail}
            jobTitle={contact.job_title || undefined}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
