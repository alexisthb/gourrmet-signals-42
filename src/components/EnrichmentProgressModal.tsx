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
      const { data, error } = await (supabase
        .from('company_enrichment') as any)
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
      const enrichmentIds = (data as any[])?.map((e: any) => e.id) || [];
      const { data: contactCounts } = await (supabase
        .from('contacts') as any)
        .select('enrichment_id')
        .in('enrichment_id', enrichmentIds);

      const countMap: Record<string, number> = {};
      (contactCounts as any[])?.forEach((c: any) => {
        countMap[c.enrichment_id] = (countMap[c.enrichment_id] || 0) + 1;
      });

      return ((data as any[]) || []).map((e: any) => ({
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
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-card">
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary" />
              Enrichissement des contacts
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="h-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Progress Overview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progression globale</span>
              <span className="font-semibold text-foreground">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2.5" />
            
            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="text-center p-3 rounded-xl bg-primary/10 border border-primary/20">
                <div className="text-xl font-bold text-primary">{stats.processing}</div>
                <div className="text-xs text-muted-foreground mt-0.5">En cours</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-success/10 border border-success/20">
                <div className="text-xl font-bold text-success">{stats.completed}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Terminés</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-warning/10 border border-warning/20">
                <div className="text-xl font-bold text-warning">{stats.pending}</div>
                <div className="text-xs text-muted-foreground mt-0.5">En attente</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted border border-border">
                <div className="text-xl font-bold text-foreground">{stats.totalContacts}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <Users className="h-3 w-3" /> Contacts
                </div>
              </div>
            </div>
          </div>

          {/* Enrichment List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">Détail des enrichissements</span>
              <span className="text-muted-foreground text-xs">{stats.total} entreprises</span>
            </div>
            
            <ScrollArea className="h-[320px] -mx-2 px-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : enrichments?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  Aucun enrichissement en cours
                </div>
              ) : (
                <div className="space-y-2">
                  {enrichments?.map((enrichment) => (
                    <div 
                      key={enrichment.id}
                      className={`p-4 rounded-xl border transition-colors ${
                        enrichment.error_message 
                          ? 'bg-destructive/5 border-destructive/20' 
                          : 'bg-card border-border hover:border-primary/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="mt-0.5">
                            {getStatusIcon(enrichment.status, enrichment.error_message)}
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="font-medium text-foreground">{enrichment.company_name}</div>
                            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>
                                {formatDistanceToNow(new Date(enrichment.created_at), { 
                                  addSuffix: true, 
                                  locale: fr 
                                })}
                              </span>
                              {enrichment.contacts_count > 0 && (
                                <>
                                  <span className="text-border">•</span>
                                  <span className="flex items-center gap-1 text-success font-medium">
                                    <Users className="h-3 w-3" />
                                    {enrichment.contacts_count} contact{enrichment.contacts_count > 1 ? 's' : ''}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0">
                          {getStatusBadge(enrichment.status, enrichment.error_message)}
                          {enrichment.raw_data?.manus_task_url && (
                            <a 
                              href={enrichment.raw_data.manus_task_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                              title="Voir sur Manus"
                            >
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </a>
                          )}
                        </div>
                      </div>
                      
                      {/* Error message - full width, not truncated */}
                      {enrichment.error_message && (
                        <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                          <p className="text-xs text-destructive leading-relaxed">
                            {enrichment.error_message}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Auto-refresh indicator */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
            <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Actualisation auto. toutes les 5s
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
