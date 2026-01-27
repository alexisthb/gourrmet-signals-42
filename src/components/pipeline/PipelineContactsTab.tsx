import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Users } from 'lucide-react';
import { ContactCard } from '@/components/ContactCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import type { ContactWithSignal } from '@/hooks/useContacts';

interface PipelineContactsTabProps {
  contactIds: string[];
}

export function PipelineContactsTab({ contactIds }: PipelineContactsTabProps) {
  const { data: contacts, isLoading } = useQuery({
    queryKey: ['pipeline-contacts', contactIds],
    queryFn: async () => {
      if (contactIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('contacts')
        .select(`
          *,
          signal:signals(company_name, signal_type, sector, event_detail, source_name)
        `)
        .in('id', contactIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ContactWithSignal[];
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
          onStatusChange={() => {}}
          showInteractions 
        />
      ))}
    </div>
  );
}
