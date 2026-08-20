import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EnrichmentStatus {
  id: string;
  company_name: string;
  status: string;
  signal_id: string;
}

// Hook to monitor enrichments and show toast notifications when completed
export function useEnrichmentNotifications() {
  const queryClient = useQueryClient();
  const previousStatusesRef = useRef<Map<string, string>>(new Map());
  const isInitializedRef = useRef(false);

  const { data: enrichments } = useQuery({
    queryKey: ['enrichment-notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_enrichment')
        .select('id, company_name, status, signal_id')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as EnrichmentStatus[];
    },
    refetchInterval: 10000, // Check every 10 seconds
  });

  useEffect(() => {
    if (!enrichments) return;

    const currentStatuses = new Map(enrichments.map(e => [e.id, e.status]));

    // Skip notification on first load
    if (!isInitializedRef.current) {
      previousStatusesRef.current = currentStatuses;
      isInitializedRef.current = true;
      return;
    }

    // Check for newly completed enrichments
    enrichments.forEach(enrichment => {
      const previousStatus = previousStatusesRef.current.get(enrichment.id);
      
      if (previousStatus && previousStatus !== 'completed' && enrichment.status === 'completed') {
        // Fetch contact count for this enrichment
        supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('signal_id', enrichment.signal_id)
          .then(({ count }) => {
            toast.success(`Enrichissement terminé : ${enrichment.company_name}`, {
              description: `${count || 0} contact(s) trouvé(s)`,
              duration: 5000,
              action: {
                label: 'Voir',
                onClick: () => {
                  window.location.href = `/signals/${enrichment.signal_id}`;
                },
              },
            });

            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['signals'] });
            queryClient.invalidateQueries({ queryKey: ['signal-stats'] });
            queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
            queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
            queryClient.invalidateQueries({ queryKey: ['enrichment-progress'] });
          });
      }
    });

    previousStatusesRef.current = currentStatuses;
  }, [enrichments, queryClient]);

  // Return some useful stats
  const stats = {
    total: enrichments?.length || 0,
    processing: enrichments?.filter(e => e.status === 'manus_processing').length || 0,
    completed: enrichments?.filter(e => e.status === 'completed').length || 0,
    pending: enrichments?.filter(e => e.status === 'pending').length || 0,
  };

  return stats;
}

// Hook to get real-time enrichment progress stats
export function useEnrichmentProgressStats() {
  return useQuery({
    queryKey: ['enrichment-progress-stats'],
    queryFn: async () => {
      // Get enrichment counts
      const { data: enrichments, error: enrichError } = await supabase
        .from('company_enrichment')
        .select('id, status, company_name, created_at, updated_at');

      if (enrichError) throw enrichError;

      // Get contact counts
      const { data: contacts, error: contactError } = await supabase
        .from('contacts')
        .select('id, signal_id, created_at');

      if (contactError) throw contactError;

      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Calculate stats
      const recentContacts = contacts?.filter(c => new Date(c.created_at) >= hourAgo) || [];
      const todayContacts = contacts?.filter(c => new Date(c.created_at) >= dayAgo) || [];
      
      const completedToday = enrichments?.filter(e => 
        e.status === 'completed' && new Date(e.updated_at) >= dayAgo
      ) || [];

      return {
        total_enrichments: enrichments?.length || 0,
        completed: enrichments?.filter(e => e.status === 'completed').length || 0,
        processing: enrichments?.filter(e => e.status === 'manus_processing').length || 0,
        pending: enrichments?.filter(e => e.status === 'pending').length || 0,
        failed: enrichments?.filter(e => e.status === 'failed').length || 0,
        total_contacts: contacts?.length || 0,
        contacts_last_hour: recentContacts.length,
        contacts_today: todayContacts.length,
        completed_today: completedToday.length,
        // Average contacts per enrichment
        avg_contacts: enrichments?.filter(e => e.status === 'completed').length 
          ? Math.round((contacts?.length || 0) / enrichments.filter(e => e.status === 'completed').length * 10) / 10
          : 0,
      };
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}
