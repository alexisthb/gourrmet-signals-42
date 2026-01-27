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
}

interface ContactCardProps {
  contact: Contact;
  onStatusChange: (id: string, status: string) => void;
  className?: string;
  showInteractions?: boolean;
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

// Couleurs prédéfinies pour les personas prioritaires dynamiques
const PRIORITY_PERSONA_STYLES = [
  { gradient: 'from-amber-500/20 via-amber-400/10 to-amber-500/20', border: 'border-amber-400/50 hover:border-amber-400', badge: 'bg-amber-500', icon: Star },
  { gradient: 'from-violet-500/20 via-violet-400/10 to-violet-500/20', border: 'border-violet-400/50 hover:border-violet-400', badge: 'bg-violet-500', icon: Crown },
  { gradient: 'from-rose-500/20 via-rose-400/10 to-rose-500/20', border: 'border-rose-400/50 hover:border-rose-400', badge: 'bg-rose-500', icon: Sparkles },
  { gradient: 'from-emerald-500/20 via-emerald-400/10 to-emerald-500/20', border: 'border-emerald-400/50 hover:border-emerald-400', badge: 'bg-emerald-500', icon: Star },
  { gradient: 'from-cyan-500/20 via-cyan-400/10 to-cyan-500/20', border: 'border-cyan-400/50 hover:border-cyan-400', badge: 'bg-cyan-500', icon: Crown },
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
        'group bg-card border rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 flex flex-col h-full animate-fade-in',
        priorityStyle ? priorityStyle.border : 'border-border/50 hover:border-primary/30',
        className
      )}>
        {/* Header avec avatar et score - hauteur min pour alignement */}
        <div className="relative px-5 pt-5 pb-4 min-h-[100px] flex-shrink-0">
          {/* Ligne colorée en haut - différente selon le type de contact */}
          <div className={cn(
            "absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r",
            priorityStyle ? priorityStyle.gradient : 'from-primary via-secondary to-accent'
          )} />
          
          {/* Badge persona si match */}
          {personaMatch && (
            <div className="absolute top-4 right-4">
              <span className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white shadow-md",
                personaMatch.style.badge
              )}>
                <personaMatch.style.icon className="h-3 w-3" />
                {personaMatch.persona.name}
              </span>
            </div>
          )}
          
          <div className="flex items-start gap-4">
            {/* Avatar élégant */}
            <div className="relative flex-shrink-0">
              <div className={cn(
                "w-14 h-14 rounded-2xl border-2 flex items-center justify-center shadow-sm",
                priorityStyle 
                  ? `bg-gradient-to-br ${priorityStyle.gradient} border-current` 
                  : 'bg-gradient-to-br from-primary/20 via-secondary/10 to-accent/20 border-primary/20'
              )}>
                <span className={cn(
                  "text-lg font-display font-bold",
                  hasPriorityStyle ? 'text-foreground' : 'text-primary'
                )}>{initials}</span>
              </div>
              {/* Badge pour contacts prioritaires */}
              {hasPriorityStyle && (
                <div className={cn(
                  "absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-lg",
                  priorityStyle?.badge || 'bg-primary'
                )}>
                  <PriorityIcon className="h-3 w-3 text-white fill-white" />
                </div>
              )}
            </div>

            {/* Infos principales */}
            <div className="flex-1 min-w-0">
              <h3 className="font-display font-bold text-base text-foreground leading-tight tracking-tight">
                {contact.full_name}
              </h3>
              {contact.job_title && (
                <p className="text-sm text-muted-foreground mt-1.5 leading-snug font-medium">{contact.job_title}</p>
              )}
              {contact.location && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground/70">
                  <MapPin className="h-3 w-3 flex-shrink-0 text-secondary" />
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
                    'h-4 w-4 transition-colors',
                    i < contact.priority_score
                      ? 'text-accent fill-accent'
                      : 'text-border/50'
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Section coordonnées - hauteur fixe */}
        <div className="px-5 py-3 bg-muted/20 border-y border-border/30 h-[88px] flex-shrink-0 flex flex-col justify-center space-y-2">
          {contact.email_principal && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-sm truncate font-medium">{contact.email_principal}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => copyToClipboard(contact.email_principal!, 'email')}
                    className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all flex-shrink-0"
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
                <Phone className="h-4 w-4 text-secondary flex-shrink-0" />
                <span className="text-sm truncate font-medium">{contact.phone}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => copyToClipboard(contact.phone!, 'phone')}
                    className="p-1.5 rounded-lg hover:bg-secondary/10 text-muted-foreground hover:text-secondary transition-all flex-shrink-0"
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
                <Linkedin className="h-4 w-4 text-accent flex-shrink-0" />
                <span className="text-sm text-muted-foreground font-medium">LinkedIn</span>
              </div>
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg hover:bg-accent/10 text-accent transition-all flex-shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
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
              "h-8 text-xs w-auto min-w-[120px] border-0 font-semibold rounded-xl",
              currentStatus?.color
            )}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {OUTREACH_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs font-medium rounded-lg">
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
                className="h-8 text-xs gap-1.5 rounded-xl font-semibold border-accent/30 text-accent hover:bg-accent/10 hover:border-accent/50 transition-all"
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
                className="h-8 text-xs gap-1.5 rounded-xl font-semibold border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 transition-all"
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
          contactId={contact.id}
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
          />
        )}
      </div>
    </TooltipProvider>
  );
}
