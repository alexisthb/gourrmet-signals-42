import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronLeft, ChevronRight, Linkedin, Loader2, Mail, MessageSquare, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SourceBadge, getSourceFromSignalType } from '@/components/SourceBadge';
import { usePersistedFilters } from '@/hooks/usePersistedFilters';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { useContactedSignals, useSaveCompanyFeedback } from '@/hooks/useContactedSignals';
import { COMPANY_FEEDBACK, contactPeriod, feedbackSchema, type ContactedSignal } from '@/lib/contacted-signals';

const DEFAULTS = { search: '', channel: 'all', feedback: 'all', period: 'all', from: '', to: '', page: 1 };
const dateText = (date: string | null) => date ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date(date)) : 'Date non enregistrée';

export default function ContactedSignals() {
  const [filters, setFilters, resetFilters] = usePersistedFilters(DEFAULTS);
  const [search, setSearch] = useState(filters.search);
  useScrollRestoration();
  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (search === filters.search) return;
    const timer = setTimeout(() => setFilters({ search, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search, setFilters]);
  const query = useContactedSignals({ ...filters, page: Math.max(1, filters.page) });
  const save = useSaveCompanyFeedback();
  const rows = query.data?.items ?? [];
  const count = query.data?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(count / 25));
  const changePeriod = (period: string) => setFilters({ period, page: 1, ...contactPeriod(period) });
  const updateFeedback = async (signal: ContactedSignal, value: string) => {
    try {
      await save.mutateAsync({ signalId: signal.signal_id, feedback: value === 'pending' ? null : feedbackSchema.parse(value) });
      toast.success('Retour enregistré');
    } catch (error) {
      toast.error('Retour non enregistré', { description: error instanceof Error ? error.message : 'Veuillez réessayer.' });
    }
  };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><MessageSquare className="h-6 w-6 text-primary" />Signaux contactés</h1>
        <p className="mt-1 text-sm text-muted-foreground">{query.isPending ? 'Chargement…' : `${count} ${count === 1 ? 'signal contacté' : 'signaux contactés'}`}</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="Actualiser les signaux contactés" title="Actualiser" onClick={() => query.refetch()} disabled={query.isFetching}>
        {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      </Button>
    </header>

    <section aria-label="Filtres des signaux contactés" className="border-y border-border py-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5"><Label htmlFor="contacted-search">Entreprise ou contact</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="contacted-search" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="Rechercher" /></div></div>
        <div className="space-y-1.5"><Label>Moyen de contact</Label><Select value={filters.channel} onValueChange={channel => setFilters({ channel, page: 1 })}><SelectTrigger aria-label="Moyen de contact"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous les moyens</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="linkedin">LinkedIn</SelectItem><SelectItem value="unknown">Non renseigné</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5"><Label>Retour entreprise</Label><Select value={filters.feedback} onValueChange={feedback => setFilters({ feedback, page: 1 })}><SelectTrigger aria-label="Filtrer par retour entreprise"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous les retours</SelectItem><SelectItem value="pending">À renseigner</SelectItem>{COMPANY_FEEDBACK.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>Période de contact</Label><Select value={filters.period} onValueChange={changePeriod}><SelectTrigger aria-label="Période de contact"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Toutes les dates</SelectItem><SelectItem value="today">Aujourd’hui</SelectItem><SelectItem value="7days">7 derniers jours</SelectItem><SelectItem value="30days">30 derniers jours</SelectItem><SelectItem value="month">Ce mois-ci</SelectItem><SelectItem value="custom">Période personnalisée</SelectItem></SelectContent></Select></div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="contacted-from">Contacté du</Label><Input className="w-44" id="contacted-from" type="date" value={filters.from} onChange={e => setFilters({ from: e.target.value, period: 'custom', page: 1 })} /></div>
        <div className="space-y-1.5"><Label htmlFor="contacted-to">Au inclus</Label><Input className="w-44" id="contacted-to" type="date" value={filters.to} onChange={e => setFilters({ to: e.target.value, period: 'custom', page: 1 })} /></div>
        <Button variant="ghost" onClick={() => { resetFilters(); setSearch(''); }}><RotateCcw className="mr-2 h-4 w-4" />Réinitialiser</Button>
        {query.isFetching && !query.isPending && <span role="status" className="text-xs text-muted-foreground pb-3">Actualisation…</span>}
      </div>
    </section>

    {query.isError ? <div role="alert" className="py-8 text-destructive"><p>{query.error.message}</p><Button variant="outline" className="mt-3" onClick={() => query.refetch()}>Réessayer</Button></div>
      : query.isPending ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      : rows.length === 0 ? <div className="py-14 text-center"><MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-4 font-semibold">Aucun signal contacté pour ces filtres</h2><Button variant="outline" className="mt-4" onClick={() => { resetFilters(); setSearch(''); }}>Réinitialiser les filtres</Button></div>
      : <div>
        <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(220px,1.1fr)] gap-4 px-3 pb-3 text-xs font-semibold text-muted-foreground border-b border-border"><span>Entreprise / signal</span><span>Contacts</span><span>Moyen</span><span>Dernier contact</span><span>Retour entreprise</span></div>
        {rows.map(signal => {
          const source = getSourceFromSignalType(signal.signal_type, signal.source_name ?? undefined);
          const saving = save.isPending && save.variables?.signalId === signal.signal_id;
          return <article key={signal.signal_id} aria-label={`Signal contacté ${signal.company_name}`} className="grid gap-4 py-5 px-3 border-b border-border lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(220px,1.1fr)]">
            <div className="min-w-0"><Link to={`/signals/${signal.signal_id}`} className="font-semibold text-foreground hover:text-primary flex items-start gap-1.5"><span className="break-words">{signal.company_name}</span><ArrowUpRight className="h-4 w-4 shrink-0 mt-0.5" /></Link><div className="mt-2">{source && <SourceBadge source={source} />}</div>{signal.event_detail && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{signal.event_detail}</p>}</div>
            <div className="min-w-0 space-y-2">{signal.contacted_contacts.length ? signal.contacted_contacts.map(contact => <div key={contact.id}><p className="text-sm font-medium break-words">{contact.name}</p>{contact.job_title && <p className="text-xs text-muted-foreground break-words">{contact.job_title}</p>}</div>) : <p className="text-xs text-muted-foreground">Contact non renseigné</p>}</div>
            <div className="min-w-0 space-y-2">{signal.channels.map(channel => <Badge key={channel} variant={channel === 'email' ? 'info' : channel === 'linkedin' ? 'linkedin' : 'muted'}>{channel === 'email' ? <Mail className="h-3 w-3" /> : channel === 'linkedin' ? <Linkedin className="h-3 w-3" /> : null}{channel === 'email' ? 'Email' : channel === 'linkedin' ? 'LinkedIn' : 'Non renseigné'}</Badge>)}{signal.email_recipients.map(email => <p className="text-xs break-all text-muted-foreground" key={email}>{email}</p>)}{signal.has_bounced_email && <p className="text-xs text-destructive">Email non distribué</p>}</div>
            <div className="text-sm"><span className="lg:hidden text-xs text-muted-foreground block mb-1">Dernier contact</span><p>{dateText(signal.last_contacted_at)}</p>{signal.first_contacted_at && dateText(signal.first_contacted_at) !== dateText(signal.last_contacted_at) && <p className="text-xs text-muted-foreground mt-1">Premier : {dateText(signal.first_contacted_at)}</p>}</div>
            <div className="min-w-0"><Select value={signal.feedback ?? 'pending'} onValueChange={value => updateFeedback(signal, value)} disabled={saving || query.isPlaceholderData}><SelectTrigger aria-label={`Retour entreprise ${signal.company_name}`} className="bg-surface"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">À renseigner</SelectItem>{COMPANY_FEEDBACK.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>{saving ? <p role="status" className="text-xs text-muted-foreground mt-2">Enregistrement…</p> : signal.feedback_updated_at ? <p className="text-xs text-muted-foreground mt-2">Mis à jour le {dateText(signal.feedback_updated_at)}</p> : null}</div>
          </article>;
        })}
        <footer className="flex items-center justify-between gap-3 pt-5"><p className="text-sm text-muted-foreground">{(filters.page - 1) * 25 + 1}–{Math.min(filters.page * 25, count)} sur {count}</p><div className="flex items-center gap-3"><Button variant="outline" size="icon" aria-label="Page précédente" disabled={filters.page <= 1 || query.isFetching} onClick={() => setFilters({ page: filters.page - 1 })}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm">{filters.page} / {pages}</span><Button variant="outline" size="icon" aria-label="Page suivante" disabled={filters.page >= pages || query.isFetching} onClick={() => setFilters({ page: filters.page + 1 })}><ChevronRight className="h-4 w-4" /></Button></div></footer>
      </div>}
  </div>;
}