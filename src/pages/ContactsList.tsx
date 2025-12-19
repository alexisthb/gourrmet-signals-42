import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Users, Mail, Linkedin, MessageSquare, Calendar, CheckCircle, XCircle, Filter, X, Download } from 'lucide-react';
import { useAllContacts, useContactStats, ContactWithSignal } from '@/hooks/useContacts';
import { useUpdateContactStatus } from '@/hooks/useEnrichment';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

export default function ContactsList() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Debounce search input to avoid firing a query on every keystroke
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

  const handleStatusChange = (contactId: string, status: string) => {
    updateStatus.mutate({ contactId, status });
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
  };

  const hasActiveFilters = search || statusFilter !== 'all';

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
          <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
          <p className="text-muted-foreground">
            {stats?.total || 0} contacts extraits pour prospection
          </p>
        </div>
        {contacts && contacts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToCSV(contacts)}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV ({contacts.length})
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard
          label="Total"
          value={stats?.total || 0}
          icon={Users}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatCard
          label="Nouveaux"
          value={stats?.new || 0}
          icon={Users}
          color="text-blue-500"
          active={statusFilter === 'new'}
          onClick={() => setStatusFilter('new')}
        />
        <StatCard
          label="LinkedIn"
          value={stats?.linkedin_sent || 0}
          icon={Linkedin}
          color="text-sky-500"
          active={statusFilter === 'linkedin_sent'}
          onClick={() => setStatusFilter('linkedin_sent')}
        />
        <StatCard
          label="Email"
          value={stats?.email_sent || 0}
          icon={Mail}
          color="text-amber-500"
          active={statusFilter === 'email_sent'}
          onClick={() => setStatusFilter('email_sent')}
        />
        <StatCard
          label="Répondu"
          value={stats?.responded || 0}
          icon={MessageSquare}
          color="text-violet-500"
          active={statusFilter === 'responded'}
          onClick={() => setStatusFilter('responded')}
        />
        <StatCard
          label="RDV"
          value={stats?.meeting || 0}
          icon={Calendar}
          color="text-emerald-500"
          active={statusFilter === 'meeting'}
          onClick={() => setStatusFilter('meeting')}
        />
        <StatCard
          label="Convertis"
          value={stats?.converted || 0}
          icon={CheckCircle}
          color="text-green-500"
          active={statusFilter === 'converted'}
          onClick={() => setStatusFilter('converted')}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un contact, email, poste..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filtrer par statut" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="h-4 w-4 mr-1" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Contacts Grid */}
      {contacts && contacts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contacts.map((contact) => (
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
            hasActiveFilters
              ? "Aucun contact ne correspond à vos critères de recherche."
              : "Les contacts apparaîtront ici une fois enrichis depuis les signaux."
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={resetFilters}>
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

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
      {/* Company Header with Event Context - Fixed height */}
      <Link
        to={`/signals/${contact.signal_id}`}
        className="block px-4 py-3 bg-muted/50 border-b border-border hover:bg-muted/70 transition-colors h-[72px] flex-shrink-0"
      >
        {contact.signal ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              {signalConfig && (
                <span className="text-sm flex-shrink-0">{signalConfig.emoji}</span>
              )}
              <span className="font-medium text-sm text-foreground truncate">
                {contact.signal.company_name}
              </span>
              {contact.signal.sector && (
                <span className="text-xs text-muted-foreground truncate">
                  • {contact.signal.sector}
                </span>
              )}
            </div>
            {contact.signal.event_detail && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                📌 {contact.signal.event_detail}
              </p>
            )}
          </>
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

// Stat Card Component
function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-foreground',
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border transition-all text-left ${
        active
          ? 'bg-primary/10 border-primary'
          : 'bg-card border-border hover:border-primary/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-lg font-bold text-foreground">{value}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </button>
  );
}
