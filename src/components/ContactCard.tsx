import { useState, useMemo } from 'react';
import { Copy, Check, ExternalLink, Star, MapPin, Mail, Linkedin, MessageSquare, Phone, Crown, Sparkles } from 'lucide-react';
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
import { useSettings } from '@/hooks/useSettings';
import { ContactInteractionTimeline } from '@/components/ContactInteractionTimeline';
import { NextActionEditor } from '@/components/NextActionEditor';
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
  source?: string | null;
  next_action_at?: string | null;
  next_action_note?: string | null;
  signalId?: string;
  companyLogoUrl?: string | null;
}

interface ContactCardProps {
  contact: Contact;
  onStatusChange: (id: string, status: string) => void;
  className?: string;
  showInteractions?: boolean;
}

// Design Gourrmet : statuts alignes sur la palette du brand (cf. STATUS_CONFIG).
const OUTREACH_STATUS_OPTIONS = [
  { value: 'new', label: 'Nouveau', color: 'bg-sable-100 text-fg-2' },
  { value: 'linkedin_sent', label: 'LinkedIn', color: 'bg-source-linkedin-bg text-source-linkedin-foreground' },
  { value: 'email_sent', label: 'Email', color: 'bg-warning-bg text-warning' },
  { value: 'responded', label: 'Répondu', color: 'bg-success-bg text-success' },
  { value: 'meeting', label: 'RDV', color: 'bg-indigo-50 text-indigo-700' },
  { value: 'converted', label: 'Converti', color: 'bg-success text-white' },
  { value: 'not_interested', label: 'Refusé', color: 'bg-danger-bg text-danger' },
];

// Styles des personas prioritaires — refondus en palette Gourrmet (indigo / terracotta / teal)
// au lieu des accents amber/violet/rose/emerald/cyan de l'ancien design.
const PRIORITY_PERSONA_STYLES = [
  { gradient: 'from-indigo-100 via-indigo-50 to-indigo-100', border: 'border-indigo-200 hover:border-indigo-300', badge: 'bg-indigo-600', icon: Star },
  { gradient: 'from-terracotta-100 via-terracotta-50 to-terracotta-100', border: 'border-terracotta-300 hover:border-terracotta-500', badge: 'bg-terracotta-600', icon: Crown },
  { gradient: 'from-teal-100 via-teal-50 to-teal-100', border: 'border-teal-300 hover:border-teal-400', badge: 'bg-teal-600', icon: Sparkles },
  { gradient: 'from-navy-100 via-navy-50 to-navy-100', border: 'border-navy-300 hover:border-navy-400', badge: 'bg-navy-700', icon: Star },
  { gradient: 'from-sable-200 via-sable-100 to-sable-200', border: 'border-sable-300 hover:border-sable-400', badge: 'bg-navy-600', icon: Crown },
];

interface Persona {
  name: string;
  isPriority: boolean;
  color: string;
}

interface PersonaMatch {
  persona: Persona;
  style: typeof PRIORITY_PERSONA_STYLES[0];
}

function matchPersonaFromSettings(jobTitle: string | null, personas: Persona[]): PersonaMatch | null {
  if (!jobTitle || !personas.length) return null;
  const title = jobTitle.toLowerCase();
  
  const priorityPersonas = personas.filter(p => p.isPriority);
  
  for (let i = 0; i < priorityPersonas.length; i++) {
    const persona = priorityPersonas[i];
    if (title.includes(persona.name.toLowerCase())) {
      const styleIndex = i % PRIORITY_PERSONA_STYLES.length;
      return { persona, style: PRIORITY_PERSONA_STYLES[styleIndex] };
    }
  }
  
  return null;
}

export function ContactCard({ contact, onStatusChange, className, showInteractions = false }: ContactCardProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [linkedInDialogOpen, setLinkedInDialogOpen] = useState(false);
  
  const { data: settings } = useSettings();

  // Récupérer les personas configurés selon la source du contact
  const personas = useMemo(() => {
    const source = contact.source || 'presse';
    const settingKey = `personas_${source}`;
    const personaSetting = settings?.[settingKey];
    
    if (personaSetting) {
      try {
        return JSON.parse(personaSetting) as Persona[];
      } catch {
        return [];
      }
    }
    return [];
  }, [settings, contact.source]);

  // Trouver si le contact correspond à un persona prioritaire
  const personaMatch = useMemo(() => {
    return matchPersonaFromSettings(contact.job_title, personas);
  }, [contact.job_title, personas]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const initials = `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`.toUpperCase() || contact.full_name?.[0]?.toUpperCase() || '?';
  const currentStatus = OUTREACH_STATUS_OPTIONS.find(s => s.value === contact.outreach_status);
  
  // Utiliser le style du persona matché ou le style par défaut si is_priority_target
  const hasPriorityStyle = personaMatch || contact.is_priority_target;
  const priorityStyle = personaMatch?.style || (contact.is_priority_target ? PRIORITY_PERSONA_STYLES[0] : null);
  const PriorityIcon = priorityStyle?.icon || Star;

  return (
    <TooltipProvider>
      <div className={cn(
        'group bg-surface border rounded-card overflow-hidden transition-colors duration-150 hover:shadow-sm flex flex-col h-full animate-fade-in',
        priorityStyle ? priorityStyle.border : 'border-border hover:border-indigo-200',
        className
      )}>
        {/* Header avec avatar et score - hauteur min pour alignement */}
        <div className="relative px-5 pt-5 pb-4 min-h-[100px] flex-shrink-0">
          {/* Ligne colorée en haut - différente selon le type de contact */}
          <div className={cn(
            "absolute top-0 left-0 right-0 h-1 bg-gradient-to-r",
            priorityStyle ? priorityStyle.gradient : 'from-indigo-600 via-indigo-500 to-indigo-600'
          )} />
          
          {/* Badge persona si match */}
          {personaMatch && (
            <div className="absolute top-4 right-4">
              <span className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-badge text-[10.5px] font-semibold text-white",
                personaMatch.style.badge
              )}>
                <personaMatch.style.icon className="h-3 w-3" strokeWidth={1.8} />
                {personaMatch.persona.name}
              </span>
            </div>
          )}

          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className={cn(
                "w-14 h-14 rounded-2xl border-2 flex items-center justify-center",
                priorityStyle
                  ? `bg-gradient-to-br ${priorityStyle.gradient} border-current`
                  : 'bg-sable-100 border-border'
              )}>
                <span className={cn(
                  "text-lg font-bold",
                  hasPriorityStyle ? 'text-navy-800' : 'text-indigo-700'
                )}>{initials}</span>
              </div>
              {hasPriorityStyle && (
                <div className={cn(
                  "absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center",
                  priorityStyle?.badge || 'bg-indigo-600'
                )}>
                  <PriorityIcon className="h-3 w-3 text-white fill-white" strokeWidth={1.8} />
                </div>
              )}
            </div>

            {/* Infos principales */}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-[16px] text-navy-800 leading-tight tracking-[-0.01em]">
                {contact.full_name}
              </h3>
              {contact.job_title && (
                <p className="text-[13.5px] text-fg-2 mt-1.5 leading-snug font-medium">{contact.job_title}</p>
              )}
              {contact.location && (
                <div className="flex items-center gap-1.5 mt-2 text-[11.5px] text-fg-3">
                  <MapPin className="h-3 w-3 flex-shrink-0 text-fg-3" strokeWidth={1.8} />
                  <span className="truncate">{contact.location}</span>
                </div>
              )}
            </div>

            {/* Score étoiles indigo */}
            <div className="flex gap-0.5 flex-shrink-0">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    'h-4 w-4 transition-colors',
                    i < contact.priority_score
                      ? 'text-indigo-600 fill-indigo-600'
                      : 'text-border-strong'
                  )}
                  strokeWidth={1.6}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Section coordonnées - hauteur fixe */}
        <div className="px-5 py-3 bg-sable-50 border-y border-border h-[88px] flex-shrink-0 flex flex-col justify-center space-y-2">
          {contact.email_principal && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-4 w-4 text-indigo-600 flex-shrink-0" strokeWidth={1.8} />
                <span className="text-[13px] truncate font-medium text-fg-1">{contact.email_principal}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => copyToClipboard(contact.email_principal!, 'email')}
                    className="p-1.5 rounded-md hover:bg-indigo-50 text-fg-3 hover:text-indigo-600 transition-colors flex-shrink-0"
                  >
                    {copied === 'email' ? <Check className="h-3.5 w-3.5 text-success" strokeWidth={1.8} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
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
                <Phone className="h-4 w-4 text-teal-600 flex-shrink-0" strokeWidth={1.8} />
                <span className="text-[13px] truncate font-medium text-fg-1">{contact.phone}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => copyToClipboard(contact.phone!, 'phone')}
                    className="p-1.5 rounded-md hover:bg-teal-50 text-fg-3 hover:text-teal-700 transition-colors flex-shrink-0"
                  >
                    {copied === 'phone' ? <Check className="h-3.5 w-3.5 text-success" strokeWidth={1.8} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
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
                <Linkedin className="h-4 w-4 text-source-linkedin flex-shrink-0" strokeWidth={1.8} />
                <span className="text-[13px] text-fg-2 font-medium">LinkedIn</span>
              </div>
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md hover:bg-source-linkedin-bg text-source-linkedin transition-colors flex-shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
              </a>
            </div>
          )}
        </div>

        {/* Section Interactions - affichée conditionnellement */}
        {showInteractions && (
          <div className="px-5 py-3 border-t border-border/30 space-y-3">
            <ContactInteractionTimeline contactId={contact.id} maxItems={3} />
            <NextActionEditor
              contactId={contact.id}
              currentDate={contact.next_action_at}
              currentNote={contact.next_action_note}
            />
          </div>
        )}

        {/* Footer avec statut et actions - toujours en bas */}
        <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-auto">
          {/* Statut */}
          <Select
            value={contact.outreach_status}
            onValueChange={(value) => onStatusChange(contact.id, value)}
          >
            <SelectTrigger className={cn(
              "h-8 text-[11.5px] w-auto min-w-[120px] border-0 font-semibold rounded-badge",
              currentStatus?.color
            )}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTREACH_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-[12.5px] font-medium">
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
                className="border-source-linkedin/30 text-source-linkedin hover:bg-source-linkedin-bg hover:border-source-linkedin/50"
              >
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
                InMail
              </Button>
            )}
            {contact.email_principal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmailDialogOpen(true)}
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
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
          contactId={contact.id}
          signalId={contact.signalId}
          hasLogo={!!contact.companyLogoUrl}
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
            contactId={contact.id}
            signalId={contact.signalId}
            hasLogo={!!contact.companyLogoUrl}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
