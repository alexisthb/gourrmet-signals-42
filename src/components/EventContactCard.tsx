import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  User, 
  Mail, 
  Phone, 
  Linkedin, 
  Building2,
  Copy,
  Check,
  MessageCircle,
  Calendar,
  StickyNote,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UnifiedEventContact } from '@/hooks/useEventContacts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LinkedInMessageDialog } from './LinkedInMessageDialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface EventContactCardProps {
  contact: UnifiedEventContact;
  onStatusChange?: (id: string, status: string, source_table?: string) => void;
  onNotesChange?: (id: string, notes: string, source_table?: string) => void;
}

const OUTREACH_STATUS_OPTIONS = [
  { value: 'not_contacted', label: 'Non contacté', color: 'bg-gray-100 text-gray-700', icon: '⚪' },
  { value: 'researched', label: 'Recherché', color: 'bg-blue-100 text-blue-700', icon: '🔍' },
  { value: 'contacted', label: 'Contacté', color: 'bg-amber-100 text-amber-700', icon: '📨' },
  { value: 'met_at_event', label: 'Rencontré', color: 'bg-purple-100 text-purple-700', icon: '🤝' },
  { value: 'demo_scheduled', label: 'RDV planifié', color: 'bg-indigo-100 text-indigo-700', icon: '📅' },
  { value: 'follow_up_sent', label: 'Relance envoyée', color: 'bg-cyan-100 text-cyan-700', icon: '✉️' },
  { value: 'proposal_sent', label: 'Proposition', color: 'bg-orange-100 text-orange-700', icon: '📋' },
  { value: 'converted', label: 'Converti', color: 'bg-green-100 text-green-700', icon: '✅' },
  { value: 'not_interested', label: 'Pas intéressé', color: 'bg-red-100 text-red-700', icon: '❌' },
];

const EVENT_TYPE_CONFIG: Record<string, { color: string; emoji: string }> = {
  salon: { color: 'bg-amber-100 text-amber-800 border-amber-200', emoji: '🎪' },
  conference: { color: 'bg-blue-100 text-blue-800 border-blue-200', emoji: '🎤' },
  networking: { color: 'bg-emerald-100 text-emerald-800 border-emerald-200', emoji: '🤝' },
  other: { color: 'bg-gray-100 text-gray-800 border-gray-200', emoji: '📅' },
};

export function EventContactCard({ contact, onStatusChange, onNotesChange }: EventContactCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [linkedInDialogOpen, setLinkedInDialogOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(!!contact.notes);
  const [localNotes, setLocalNotes] = useState(contact.notes || '');

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`${field === 'email' ? 'Email' : 'Téléphone'} copié !`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleNotesBlur = () => {
    if (localNotes !== contact.notes) {
      onNotesChange?.(contact.id, localNotes, contact.source_table);
    }
  };

  const currentStatus = OUTREACH_STATUS_OPTIONS.find(s => s.value === contact.outreach_status) 
    || OUTREACH_STATUS_OPTIONS[0];

  const eventConfig = EVENT_TYPE_CONFIG[contact.event?.type || 'other'] || EVENT_TYPE_CONFIG.other;
  
  // Special styling for Salon du Mariage contacts
  const isSalonContact = contact.source_table === 'salon_mariage';
  const headerGradient = isSalonContact 
    ? "bg-gradient-to-r from-pink-400 via-rose-400 to-pink-500"
    : "bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500";

  return (
    <>
      <Card className="overflow-hidden transition-all duration-300 hover:shadow-xl rounded-3xl border-0 shadow-lg shadow-black/[0.03] flex flex-col h-full">
        {/* Header gradient - pink for salon, amber for other events */}
        <div className={cn("h-2 shrink-0", headerGradient)} />
        
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Event source label */}
              {contact.event && (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge 
                    variant="outline" 
                    className={cn("text-[10px] px-2 py-0.5 font-medium", eventConfig.color)}
                  >
                    <Calendar className="h-3 w-3 mr-1" />
                    {eventConfig.emoji} {contact.event.name}
                    {contact.event.date_start && (
                      <span className="ml-1 opacity-70">
                        • {format(new Date(contact.event.date_start), 'MMM yyyy', { locale: fr })}
                      </span>
                    )}
                  </Badge>
                  
                  {/* Salon-specific badges */}
                  {isSalonContact && contact.tier && (
                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-pink-50 text-pink-700 border-pink-200">
                      💍 Tier {contact.tier}
                    </Badge>
                  )}
                  {isSalonContact && contact.is_priority && (
                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border-amber-200">
                      ⭐ Priorité
                    </Badge>
                  )}
                </div>
              )}
              
              <h3 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
                <User className="h-4 w-4 text-amber-500" />
                {contact.full_name}
              </h3>
              
              {contact.job_title && (
                <p className="text-sm text-muted-foreground">
                  {contact.job_title}
                </p>
              )}
              
              {contact.company_name && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <Building2 className="h-3 w-3" />
                  {contact.company_name}
                </p>
              )}
            </div>

            <Select
              value={contact.outreach_status || 'not_contacted'}
              onValueChange={(value) => onStatusChange?.(contact.id, value, contact.source_table)}
            >
              <SelectTrigger className={cn("w-[140px] h-8 text-xs font-medium border-0", currentStatus.color)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTREACH_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-1.5">
                      <span>{option.icon}</span>
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col flex-1">
          <div className="flex-1 space-y-3">
            {/* Contact info */}
            <div className="space-y-2">
              {contact.email && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-sm truncate">{contact.email}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(contact.email!, 'email')}
                  >
                    {copiedField === 'email' ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}

              {contact.phone && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Phone className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-sm truncate">{contact.phone}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(contact.phone!, 'phone')}
                  >
                    {copiedField === 'phone' ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Notes section */}
            <div className="space-y-2">
              <button
                onClick={() => setNotesOpen(!notesOpen)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <StickyNote className="h-3.5 w-3.5" />
                <span>Notes</span>
                {localNotes && <span className="text-amber-500">•</span>}
                {notesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              
              {notesOpen && (
                <Textarea
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  onBlur={handleNotesBlur}
                  placeholder="Notes sur ce contact..."
                  className="min-h-[60px] text-xs resize-none bg-muted/30 border-muted"
                />
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-3 mt-3 border-t border-border/50 shrink-0">
            {contact.linkedin_url && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 gap-1.5 text-xs bg-[#0077B5] hover:bg-[#005885]"
                  onClick={() => setLinkedInDialogOpen(true)}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Contacter
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-blue-600 border-blue-200 hover:bg-blue-50"
                  onClick={() => window.open(contact.linkedin_url!, '_blank')}
                >
                  <Linkedin className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* LinkedIn Message Dialog */}
      {contact.linkedin_url && (
        <LinkedInMessageDialog
          open={linkedInDialogOpen}
          onOpenChange={setLinkedInDialogOpen}
          linkedinUrl={contact.linkedin_url}
          recipientName={contact.full_name}
          companyName={contact.company_name || 'Entreprise'}
          eventDetail={contact.event?.name || 'Événement'}
          jobTitle={contact.job_title || undefined}
        />
      )}
    </>
  );
}
