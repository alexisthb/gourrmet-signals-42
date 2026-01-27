import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  RefreshCw, 
  StickyNote, 
  Calendar, 
  Sparkles, 
  UserPlus,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  useSignalInteractions, 
  getSignalActionTypeLabel, 
  getSignalActionTypeColor 
} from '@/hooks/useSignalInteractions';

interface SignalInteractionTimelineProps {
  signalId: string;
  maxItems?: number;
}

const actionIcons: Record<string, React.ElementType> = {
  'status_change': RefreshCw,
  'note_added': StickyNote,
  'next_action_set': Calendar,
  'enrichment_triggered': Sparkles,
  'contact_created': UserPlus,
};

export function SignalInteractionTimeline({ signalId, maxItems = 5 }: SignalInteractionTimelineProps) {
  const { data: interactions, isLoading } = useSignalInteractions(signalId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3 animate-pulse" />
        <span>Chargement...</span>
      </div>
    );
  }

  if (!interactions?.length) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Aucune interaction enregistrée
      </div>
    );
  }

  const displayedInteractions = interactions.slice(0, maxItems);
  const remainingCount = interactions.length - maxItems;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Historique
      </h4>
      <div className="space-y-1.5">
        {displayedInteractions.map((interaction) => {
          const Icon = actionIcons[interaction.action_type] || Clock;
          const colorClass = getSignalActionTypeColor(interaction.action_type);
          
          return (
            <div 
              key={interaction.id} 
              className="flex items-start gap-2 text-xs"
            >
              <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", colorClass)} />
              <div className="flex-1 min-w-0">
                <span className="font-medium">
                  {getSignalActionTypeLabel(interaction.action_type)}
                </span>
                {interaction.new_value && (
                  <span className="text-muted-foreground ml-1 truncate">
                    : {interaction.new_value}
                  </span>
                )}
                <div className="text-muted-foreground/70">
                  {format(new Date(interaction.created_at), "d MMM à HH:mm", { locale: fr })}
                </div>
              </div>
            </div>
          );
        })}
        {remainingCount > 0 && (
          <div className="text-xs text-muted-foreground">
            +{remainingCount} autre{remainingCount > 1 ? 's' : ''} action{remainingCount > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
