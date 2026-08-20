import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Users } from 'lucide-react';
import { ContactCard } from '@/components/ContactCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useUpdateContactStatus } from '@/hooks/useEnrichment';
import type { ContactWithSignal } from '@/hooks/useContacts';
import { chunkValues } from '@/lib/supabasePagination';

interface PipelineContactsTabProps {
  contactIds: string[];
}

export function PipelineContactsTab({ contactIds }: PipelineContactsTabProps) {
  const updateStatus = useUpdateContactStatus();
  const { data: contacts, isLoading } = useQuery({
    queryKey: ['pipeline-contacts', contactIds],
    queryFn: async () => {
      if (contactIds.length === 0) return [];
      
      const pages = await Promise.all(chunkValues(contactIds, 100).map(async (ids) => {
        const { data, error } = await supabase
          .from('contacts')
          .select(`
            *,
            signal:signals(company_name, signal_type, sector, event_detail, source_name)
          `)
          .in('id', ids)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data as ContactWithSignal[];
      }));
      return pages.flat().sort((left, right) =>
        Date.parse(right.created_at || '') - Date.parse(left.created_at || '')
      );
    },
    enabled: contactIds.length > 0,
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!contacts?.length) {
    return (
      <EmptyState
        icon={Users}
        title="Aucun contact en cours"
        description="Les contacts sur lesquels vous intervenez apparaîtront ici"
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {contacts.map((contact) => (
        <ContactCard
          key={contact.id}
          contact={contact}
          onStatusChange={(contactId, status) =>
            updateStatus.mutate({ contactId, status, oldStatus: contact.outreach_status })
          }
          showInteractions
        />
      ))}
    </div>
  );
}
