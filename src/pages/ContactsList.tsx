import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Users, Mail, Linkedin, MessageSquare, Calendar, CheckCircle, XCircle, Filter, X, Download, Newspaper, Building2, MapPin, CalendarDays } from 'lucide-react';
import { format, subDays, subMonths, isAfter, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAllContacts, useContactStats, ContactWithSignal } from '@/hooks/useContacts';
import { useUpdateContactStatus } from '@/hooks/useEnrichment';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { ContactCard } from '@/components/ContactCard';
import { SourceBadge, getSourceFromSignalType, type SignalSource } from '@/components/SourceBadge';
import { SIGNAL_TYPE_CONFIG } from '@/types/database';
import { toast } from 'sonner';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tous les statuts', icon: Users },
  { value: 'new', label: 'Nouveau', icon: Users },
  { value: 'linkedin_sent', label: 'LinkedIn envoyé', icon: Linkedin },
  { value: 'email_sent', label: 'Email envoyé', icon: Mail },
  { value: 'responded', label: 'A répondu', icon: MessageSquare },
  { value: 'meeting', label: 'RDV planifié', icon: Calendar },
  { value: 'converted', label: 'Converti', icon: CheckCircle },
  { value: 'not_interested', label: 'Pas intéressé', icon: XCircle },
];

const DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'Toutes les dates' },
  { value: '7days', label: '7 derniers jours' },
  { value: '30days', label: '30 derniers jours' },
  { value: '3months', label: '3 derniers mois' },
  { value: '6months', label: '6 derniers mois' },
];

// Export contacts to CSV
function exportToCSV(contacts: ContactWithSignal[]) {
  const headers = [
    'Prénom',
    'Nom',
    'Nom complet',
    'Poste',
    'Département',
    'Email principal',
    'Email alternatif',
    'LinkedIn',
    'Localisation',
    'Entreprise',
    'Secteur',
    'Événement',
    'Statut outreach',
    'Score priorité',
    'Cible prioritaire',
    'Source',
  ];

  const rows = contacts.map((c) => [
    c.first_name || '',
    c.last_name || '',
    c.full_name,
    c.job_title || '',
    c.department || '',
    c.email_principal || '',
    c.email_alternatif || '',
    c.linkedin_url || '',
    c.location || '',
    c.signal?.company_name || '',
    c.signal?.sector || '',
    c.signal?.event_detail || '',
    c.outreach_status || 'new',
    c.priority_score?.toString() || '0',
    c.is_priority_target ? 'Oui' : 'Non',
    getSourceFromSignalType(c.signal?.signal_type) || 'inconnu',
  ]);

  const csvContent = [
    headers.join(';'),
    ...rows.map((row) => row.map((cell) => `"${(cell || '').replace(/"/g, '""')}"`).join(';')),
  ].join('\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `contacts_export_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  toast.success(`${contacts.length} contacts exportés`);
}

// Extract unique locations from contacts
function extractUniqueLocations(contacts: ContactWithSignal[]): string[] {
  const locations = new Set<string>();
  contacts.forEach((c) => {
    if (c.location) {
      // Normalize location (take first part before comma for city)
      const normalized = c.location.split(',')[0].trim();
      if (normalized) locations.add(normalized);
    }
  });
  return Array.from(locations).sort();
}

export default function ContactsList() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | SignalSource>('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: contacts, isLoading } = useAllContacts({
    status: statusFilter,
    search: debouncedSearch || undefined,
  });

  const { data: stats } = useContactStats();
  const updateStatus = useUpdateContactStatus();

  // Extract unique locations for filter dropdown
  const uniqueLocations = useMemo(() => {
    return contacts ? extractUniqueLocations(contacts) : [];
  }, [contacts]);

  const handleStatusChange = (contactId: string, status: string) => {
    updateStatus.mutate({ contactId, status });
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setSourceFilter('all');
    setDateFilter('all');
    setLocationFilter('all');
  };

  // Filter contacts by source, date and location
  const filteredContacts = useMemo(() => {
    if (!contacts) return [];

    return contacts.filter(contact => {
      // Source filter
      if (sourceFilter !== 'all') {
        const source = getSourceFromSignalType(contact.signal?.signal_type);
        if (source !== sourceFilter) return false;
      }

      // Date filter
      if (dateFilter !== 'all' && contact.created_at) {
        const contactDate = parseISO(contact.created_at);
        let cutoffDate: Date;
        
        switch (dateFilter) {
          case '7days':
            cutoffDate = subDays(new Date(), 7);
            break;
          case '30days':
            cutoffDate = subDays(new Date(), 30);
            break;
          case '3months':
            cutoffDate = subMonths(new Date(), 3);
            break;
          case '6months':
            cutoffDate = subMonths(new Date(), 6);
            break;
          default:
            cutoffDate = new Date(0);
        }
        
        if (!isAfter(contactDate, cutoffDate)) return false;
      }

      // Location filter
      if (locationFilter !== 'all' && contact.location) {
        const normalizedLocation = contact.location.split(',')[0].trim();
        if (normalizedLocation !== locationFilter) return false;
      } else if (locationFilter !== 'all' && !contact.location) {
        return false;
      }

      return true;
    });
  }, [contacts, sourceFilter, dateFilter, locationFilter]);

  // Count by source
  const countBySource = {
    all: contacts?.length || 0,
    presse: contacts?.filter(c => getSourceFromSignalType(c.signal?.signal_type) === 'presse').length || 0,
    pappers: contacts?.filter(c => getSourceFromSignalType(c.signal?.signal_type) === 'pappers').length || 0,
    linkedin: contacts?.filter(c => getSourceFromSignalType(c.signal?.signal_type) === 'linkedin').length || 0,
  };

  const hasActiveFilters = search || statusFilter !== 'all' || dateFilter !== 'all' || locationFilter !== 'all';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tous les contacts</h1>
          <p className="text-muted-foreground">
            {stats?.total || 0} contacts extraits pour prospection
          </p>
        </div>
        {contacts && contacts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToCSV(filteredContacts)}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV ({filteredContacts.length})
          </Button>
        )}
      </div>

      {/* Source Tabs */}
      <Tabs value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-auto p-1">
          <TabsTrigger 
            value="all" 
            className="flex items-center gap-2 py-3 data-[state=active]:bg-card"
          >
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Tous</span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{countBySource.all}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="presse" 
            className="flex items-center gap-2 py-3 data-[state=active]:bg-source-presse/10 data-[state=active]:text-source-presse"
          >
            <Newspaper className="h-4 w-4" />
            <span className="hidden sm:inline">Presse</span>
            <span className="text-xs bg-source-presse/20 text-source-presse px-1.5 py-0.5 rounded-full">{countBySource.presse}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="pappers" 
            className="flex items-center gap-2 py-3 data-[state=active]:bg-source-pappers/10 data-[state=active]:text-source-pappers"
          >
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Pappers</span>
            <span className="text-xs bg-source-pappers/20 text-source-pappers px-1.5 py-0.5 rounded-full">{countBySource.pappers}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="linkedin" 
            className="flex items-center gap-2 py-3 data-[state=active]:bg-source-linkedin/10 data-[state=active]:text-source-linkedin"
          >
            <Linkedin className="h-4 w-4" />
            <span className="hidden sm:inline">LinkedIn</span>
            <span className="text-xs bg-source-linkedin/20 text-source-linkedin px-1.5 py-0.5 rounded-full">{countBySource.linkedin}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="space-y-3">
        {/* Search Row */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un contact, email, poste..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter Row */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <Filter className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <CalendarDays className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue placeholder="Date" />
            </SelectTrigger>
            <SelectContent>
              {DATE_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <MapPin className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue placeholder="Localisation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les villes</SelectItem>
              {uniqueLocations.map((location) => (
                <SelectItem key={location} value={location}>
                  {location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-10">
              <X className="h-4 w-4 mr-1" />
              Réinitialiser
            </Button>
          )}
        </div>
      </div>

      {/* Contacts Grid */}
      {filteredContacts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContacts.map((contact) => (
            <ContactCardExtended
              key={contact.id}
              contact={contact}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="Aucun contact trouvé"
          description={
            hasActiveFilters || sourceFilter !== 'all'
              ? "Aucun contact ne correspond à vos critères de recherche."
              : "Les contacts apparaîtront ici une fois enrichis depuis les signaux."
          }
          action={
            (hasActiveFilters || sourceFilter !== 'all') ? (
              <Button variant="outline" onClick={() => { resetFilters(); setSourceFilter('all'); }}>
                Réinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

// Extended ContactCard with company info
function ContactCardExtended({
  contact,
  onStatusChange,
}: {
  contact: ContactWithSignal;
  onStatusChange: (id: string, status: string) => void;
}) {
  const signalConfig = contact.signal?.signal_type
    ? SIGNAL_TYPE_CONFIG[contact.signal.signal_type as keyof typeof SIGNAL_TYPE_CONFIG]
    : null;

  const source = getSourceFromSignalType(contact.signal?.signal_type);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col h-full group hover:border-primary/20">
      {/* Company Header with Event Context */}
      <Link
        to={`/signals/${contact.signal_id}`}
        className="block px-4 py-3 bg-muted/30 border-b border-border hover:bg-muted/50 transition-colors"
      >
        {contact.signal ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {source && <SourceBadge source={source} size="sm" />}
              {signalConfig && (
                <span className="text-xs text-muted-foreground">{signalConfig.emoji} {signalConfig.label}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-foreground truncate">
                {contact.signal.company_name}
              </span>
              {contact.signal.sector && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                  • {contact.signal.sector}
                </span>
              )}
            </div>
            {contact.signal.event_detail && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                📌 {contact.signal.event_detail}
              </p>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Signal non disponible</div>
        )}
      </Link>

      {/* Contact Card Content */}
      <div className="flex-1">
        <ContactCard
          contact={{
            id: contact.id,
            full_name: contact.full_name,
            first_name: contact.first_name,
            last_name: contact.last_name,
            job_title: contact.job_title,
            location: contact.location,
            email_principal: contact.email_principal,
            email_alternatif: contact.email_alternatif,
            linkedin_url: contact.linkedin_url,
            is_priority_target: contact.is_priority_target || false,
            priority_score: contact.priority_score || 0,
            outreach_status: contact.outreach_status || 'new',
            companyName: contact.signal?.company_name,
            eventDetail: contact.signal?.event_detail,
          }}
          onStatusChange={onStatusChange}
          className="border-0 shadow-none rounded-none"
        />
      </div>
    </div>
  );
}
