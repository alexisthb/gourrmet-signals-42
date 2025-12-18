import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Loader2, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  RefreshCw,
  ExternalLink,
  Users,
  Building2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface EnrichmentProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EnrichmentItem {
  id: string;
  company_name: string;
  status: string;
  created_at: string;
  raw_data: {
    manus_task_id?: string;
    manus_task_url?: string;
    completed_at?: string;
  } | null;
  error_message: string | null;
  contacts_count: number;
}

export function EnrichmentProgressModal({ open, onOpenChange }: EnrichmentProgressModalProps) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch all enrichments with their contact counts
  const { data: enrichments, isLoading, refetch } = useQuery({
    queryKey: ['enrichment-progress'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_enrichment')
        .select(`
          id,
          company_name,
          status,
          created_at,
          raw_data,
          error_message
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get contact counts for each enrichment
      const enrichmentIds = data?.map(e => e.id) || [];
      const { data: contactCounts } = await supabase
        .from('contacts')
        .select('enrichment_id')
        .in('enrichment_id', enrichmentIds);

      const countMap: Record<string, number> = {};
      contactCounts?.forEach(c => {
        countMap[c.enrichment_id] = (countMap[c.enrichment_id] || 0) + 1;
      });

      return (data || []).map(e => ({
        ...e,
        raw_data: e.raw_data as EnrichmentItem['raw_data'],
        contacts_count: countMap[e.id] || 0,
      })) as EnrichmentItem[];
    },
    enabled: open,
    refetchInterval: open ? 5000 : false, // Auto-refresh every 5 seconds when open
  });

  // Manual refresh with cron trigger
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Call the cron function to check all pending tasks
      await supabase.functions.invoke('cron-check-manus', {});
      // Wait a moment then refetch
      await new Promise(r => setTimeout(r, 1000));
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
    } catch (e) {
      console.error('Refresh error:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Calculate stats
  const stats = {
    total: enrichments?.length || 0,
    completed: enrichments?.filter(e => e.status === 'completed').length || 0,
    processing: enrichments?.filter(e => e.status === 'manus_processing').length || 0,
    pending: enrichments?.filter(e => e.status === 'pending' || e.status === 'processing').length || 0,
    failed: enrichments?.filter(e => e.status === 'failed' || e.error_message).length || 0,
    totalContacts: enrichments?.reduce((sum, e) => sum + e.contacts_count, 0) || 0,
  };

  const progressPercent = stats.total > 0 
    ? Math.round((stats.completed / stats.total) * 100) 
    : 0;

  const getStatusIcon = (status: string, errorMessage: string | null) => {
    if (errorMessage) return <AlertCircle className="h-4 w-4 text-destructive" />;
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'manus_processing':
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string, errorMessage: string | null) => {
    if (errorMessage) {
      return <Badge variant="destructive">Erreur</Badge>;
    }
    switch (status) {
      case 'completed':
        return <Badge className="bg-success/20 text-success border-success/30">Terminé</Badge>;
      case 'manus_processing':
        return <Badge className="bg-primary/20 text-primary border-primary/30">En cours</Badge>;
      case 'processing':
        return <Badge className="bg-primary/20 text-primary border-primary/30">Traitement</Badge>;
      case 'pending':
        return <Badge variant="secondary">En attente</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Enrichissement des contacts
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManualRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Progress Overview */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progression globale</span>
              <span className="font-medium">{stats.completed}/{stats.total} terminés</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
            
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-3 pt-2">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold text-primary">{stats.processing}</div>
                <div className="text-xs text-muted-foreground">En cours</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold text-success">{stats.completed}</div>
                <div className="text-xs text-muted-foreground">Terminés</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold text-warning">{stats.pending}</div>
                <div className="text-xs text-muted-foreground">En attente</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold">{stats.totalContacts}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Users className="h-3 w-3" /> Contacts
                </div>
              </div>
            </div>
          </div>

          {/* Enrichment List */}
          <ScrollArea className="h-[400px] pr-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : enrichments?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Aucun enrichissement en cours
              </div>
            ) : (
              <div className="space-y-2">
                {enrichments?.map((enrichment) => (
                  <div 
                    key={enrichment.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {getStatusIcon(enrichment.status, enrichment.error_message)}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{enrichment.company_name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>
                            {formatDistanceToNow(new Date(enrichment.created_at), { 
                              addSuffix: true, 
                              locale: fr 
                            })}
                          </span>
                          {enrichment.contacts_count > 0 && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {enrichment.contacts_count} contact{enrichment.contacts_count > 1 ? 's' : ''}
                              </span>
                            </>
                          )}
                        </div>
                        {enrichment.error_message && (
                          <div className="text-xs text-destructive mt-1 truncate">
                            {enrichment.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {getStatusBadge(enrichment.status, enrichment.error_message)}
                      {enrichment.raw_data?.manus_task_url && (
                        <a 
                          href={enrichment.raw_data.manus_task_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 hover:bg-muted rounded"
                          title="Voir sur Manus"
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Auto-refresh indicator */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            Actualisation automatique toutes les 5 secondes
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
