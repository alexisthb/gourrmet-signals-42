import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Clock, MessageSquare, Mail, RefreshCw, Calendar, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContactInteractions, getActionTypeLabel, getActionTypeColor } from '@/hooks/useContactInteractions';

interface ContactInteractionTimelineProps {
  contactId: string;
  maxItems?: number;
}

const ACTION_ICONS: Record<string, React.ElementType> = {
  'status_change': RefreshCw,
  'linkedin_message_generated': MessageSquare,
  'email_generated': Mail,
  'linkedin_message_copied': MessageSquare,
  'email_copied': Mail,
  'note_added': StickyNote,
  'next_action_set': Calendar,
};

export function ContactInteractionTimeline({ contactId, maxItems = 3 }: ContactInteractionTimelineProps) {
  const { data: interactions, isLoading } = useContactInteractions(contactId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3 animate-pulse" />
        <span>Chargement...</span>
      </div>
    );
  }

  if (!interactions?.length) {
    return null;
  }

  const displayedInteractions = interactions.slice(0, maxItems);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        <Clock className="h-3 w-3" />
        Historique
      </div>
      <div className="space-y-1">
        {displayedInteractions.map((interaction) => {
          const Icon = ACTION_ICONS[interaction.action_type] || Clock;
          const colorClass = getActionTypeColor(interaction.action_type);
          
          return (
            <div 
              key={interaction.id} 
              className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg px-2 py-1.5"
            >
              <Icon className={cn("h-3 w-3 flex-shrink-0", colorClass)} />
              <span className="flex-1 truncate text-muted-foreground">
                {getActionTypeLabel(interaction.action_type)}
                {interaction.new_value && (
                  <span className="ml-1 text-foreground font-medium">
                    → {interaction.new_value}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                {format(new Date(interaction.created_at), 'dd/MM HH:mm', { locale: fr })}
              </span>
            </div>
          );
        })}
      </div>
      {interactions.length > maxItems && (
        <div className="text-[10px] text-muted-foreground text-center">
          +{interactions.length - maxItems} autres actions
        </div>
      )}
    </div>
  );
}
