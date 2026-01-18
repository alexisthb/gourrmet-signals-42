import { useState } from 'react';
import { 
  Users, 
  Search,
  Mail,
  Linkedin,
  CheckCircle2,
  Calendar,
  Filter
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { StatCard } from '@/components/StatCard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EventContactCard } from '@/components/EventContactCard';
import { EmptyState } from '@/components/EmptyState';
import { useAllEventContacts, useEventContactsStats, useUpdateEventContact } from '@/hooks/useEventContacts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useEvents } from '@/hooks/useEvents';

const STATUS_FILTERS = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'not_contacted', label: '⚪ Non contactés' },
  { value: 'contacted', label: '📨 Contactés' },
  { value: 'met_at_event', label: '🤝 Rencontrés' },
  { value: 'converted', label: '✅ Convertis' },
];

export default function EventContactsList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  
  const { data: contacts, isLoading } = useAllEventContacts();
  const { data: events } = useEvents();
  const stats = useEventContactsStats();
  const updateContact = useUpdateEventContact();

  const handleStatusChange = (id: string, status: string) => {
    updateContact.mutate({ id, outreach_status: status });
  };

  const handleNotesChange = (id: string, notes: string) => {
    updateContact.mutate({ id, notes });
  };

  const handleQuickFilter = (filter: string) => {
    if (quickFilter === filter) {
      setQuickFilter(null);
      setStatusFilter('all');
      setEventFilter('all');
    } else {
      setQuickFilter(filter);
      setStatusFilter('all');
      setEventFilter('all');
    }
  };

  const filteredContacts = contacts?.filter(c => {
    // Search filter
    const matchesSearch = 
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.job_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.event as any)?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Status filter  
    const matchesStatus = statusFilter === 'all' || c.outreach_status === statusFilter;
    
    // Event filter
    const matchesEvent = eventFilter === 'all' || c.event_id === eventFilter;
    
    // Quick filters
    if (quickFilter === 'withEmail') return matchesSearch && !!c.email;
    if (quickFilter === 'withLinkedIn') return matchesSearch && !!c.linkedin_url;
    if (quickFilter === 'contacted') {
      const contactedStatuses = ['contacted', 'met_at_event', 'demo_scheduled', 'follow_up_sent', 'proposal_sent', 'converted'];
      return matchesSearch && contactedStatuses.includes(c.outreach_status || '');
    }
    
    return matchesSearch && matchesStatus && matchesEvent;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-6 w-6 text-amber-500" />
          Contacts Événementiels
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Contacts collectés lors des salons et événements • Indépendants des signaux Presse/Pappers/LinkedIn
        </p>
      </div>

      {/* Info card explaining the difference */}
      <Card className="bg-gradient-to-br from-amber-50 via-white to-orange-50 border-amber-200/50">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
              <Calendar className="h-4 w-4 text-white" />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">CRM Événementiel</strong> — Ces contacts sont issus de vos participations à des salons et événements professionnels. 
                Ils sont <strong>distincts</strong> des contacts générés par les signaux (Presse, Pappers, LinkedIn).
              </p>
              <p className="mt-1">
                Chaque carte affiche l'événement source pour une traçabilité complète.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div 
          className={`cursor-pointer transition-all ${quickFilter === null ? 'ring-2 ring-amber-400/50' : 'hover:scale-[1.02]'}`}
          onClick={() => { setQuickFilter(null); setStatusFilter('all'); setEventFilter('all'); }}
        >
          <StatCard
            label="Total"
            value={stats.total}
            icon={Users}
            variant="yellow"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'withEmail' ? 'ring-2 ring-primary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('withEmail')}
        >
          <StatCard
            label="Avec email"
            value={stats.withEmail}
            icon={Mail}
            variant="coral"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'withLinkedIn' ? 'ring-2 ring-secondary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('withLinkedIn')}
        >
          <StatCard
            label="Avec LinkedIn"
            value={stats.withLinkedIn}
            icon={Linkedin}
            variant="turquoise"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'contacted' ? 'ring-2 ring-accent/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('contacted')}
        >
          <StatCard
            label="Contactés"
            value={stats.contacted}
            icon={Mail}
            variant="yellow"
          />
        </div>
        <div>
          <StatCard
            label="Convertis"
            value={stats.converted}
            icon={CheckCircle2}
            variant="turquoise"
          />
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un contact ou un événement..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 rounded-xl"
          />
        </div>
        
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="w-[200px] rounded-xl">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Événement" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les événements</SelectItem>
            {events?.map(event => (
              <SelectItem key={event.id} value={event.id}>
                {event.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] rounded-xl">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(filter => (
              <SelectItem key={filter.value} value={filter.value}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      {filteredContacts && (
        <p className="text-sm text-muted-foreground">
          {filteredContacts.length} contact{filteredContacts.length > 1 ? 's' : ''} événementiel{filteredContacts.length > 1 ? 's' : ''}
        </p>
      )}

      {/* Contacts list */}
      {isLoading ? (
        <LoadingSpinner />
      ) : filteredContacts && filteredContacts.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredContacts.map((contact) => (
            <EventContactCard
              key={contact.id}
              contact={contact}
              onStatusChange={handleStatusChange}
              onNotesChange={handleNotesChange}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="Aucun contact événementiel"
          description={searchTerm || statusFilter !== 'all' || eventFilter !== 'all'
            ? "Aucun résultat ne correspond à vos critères." 
            : "Les contacts collectés lors de vos événements apparaîtront ici."}
        />
      )}
    </div>
  );
}
