import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ExternalLink, Building2, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SignalInteractionTimeline } from '@/components/SignalInteractionTimeline';
import { SignalNextActionEditor } from '@/components/SignalNextActionEditor';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import type { SignalType } from '@/types/database';

interface PipelineSignalsTabProps {
  signalIds: string[];
}

export function PipelineSignalsTab({ signalIds }: PipelineSignalsTabProps) {
  const { data: signals, isLoading } = useQuery({
    queryKey: ['pipeline-signals', signalIds],
    queryFn: async () => {
      if (signalIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .in('id', signalIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: signalIds.length > 0,
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!signals?.length) {
    return (
      <EmptyState
        icon={Building2}
        title="Aucun signal en cours"
        description="Les signaux sur lesquels vous intervenez apparaîtront ici"
      />
    );
  }

  return (
    <div className="grid gap-4">
      {signals.map((signal) => (
        <Card key={signal.id} className="overflow-hidden hover:shadow-md transition-shadow">
          <CardContent className="p-0">
            <div className="flex">
              {/* Main content */}
              <div className="flex-1 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Link 
                      to={`/signals/${signal.id}`}
                      className="font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {signal.company_name}
                    </Link>
                    <div className="flex items-center gap-2 flex-wrap">
                      <SignalTypeBadge type={signal.signal_type as SignalType} />
                      {signal.sector && (
                        <Badge variant="outline" className="text-xs">
                          {signal.sector}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(signal.detected_at || signal.created_at!), "d MMM yyyy", { locale: fr })}
                      </span>
                    </div>
                  </div>
                  
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/signals/${signal.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                {signal.event_detail && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {signal.event_detail}
                  </p>
                )}

                {/* Next action */}
                <div className="mt-4">
                  <SignalNextActionEditor
                    signalId={signal.id}
                    currentDate={signal.next_action_at}
                    currentNote={signal.next_action_note}
                  />
                </div>
              </div>

              {/* Timeline sidebar */}
              <div className="w-64 bg-muted/30 border-l border-border/50 p-4">
                <SignalInteractionTimeline signalId={signal.id} maxItems={3} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
