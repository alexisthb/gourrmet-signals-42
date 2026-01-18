import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Heart, 
  Calendar, 
  MapPin, 
  Users, 
  Euro, 
  TrendingUp, 
  Search,
  Star,
  Mail,
  Linkedin,
  ExternalLink,
  Clock,
  Filter,
  Award,
  Phone
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { SalonExposantCard } from '@/components/SalonExposantCard';
import { useSalonExposants, useSalonStats, useUpdateSalonExposant } from '@/hooks/useSalonMariage';
import { EmptyState } from '@/components/EmptyState';
import salonBanner from '@/assets/salon-mariage-banner.jpg';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TIER_FILTERS = [
  { value: 'all', label: 'Tous les tiers' },
  { value: '1', label: '🏆 Tier 1 - Complets' },
  { value: '2', label: '🥈 Tier 2 - Email+Insta' },
  { value: '3', label: '🥉 Tier 3 - LinkedIn+Insta' },
  { value: '4', label: '📌 Tier 4 - Instagram only' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'not_contacted', label: '⚪ Non contactés' },
  { value: 'researched', label: '🔍 Recherchés' },
  { value: 'contacted', label: '📨 Contactés' },
  { value: 'met_at_event', label: '🤝 Rencontrés' },
  { value: 'converted', label: '✅ Convertis' },
];

export default function SalonMariage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const { data: exposants, isLoading } = useSalonExposants();
  const stats = useSalonStats();
  const updateExposant = useUpdateSalonExposant();

  const handleStatusChange = (id: string, status: string) => {
    updateExposant.mutate({ id, outreach_status: status });
  };

  const handleQuickFilter = (filter: string) => {
    if (quickFilter === filter) {
      // Toggle off
      setQuickFilter(null);
      setTierFilter('all');
      setStatusFilter('all');
    } else {
      setQuickFilter(filter);
      // Reset other filters
      setTierFilter('all');
      setStatusFilter('all');
      
      // Apply specific filter
      if (filter === 'tier1') setTierFilter('1');
      else if (filter === 'tier2') setTierFilter('2');
      else if (filter === 'contacted') setStatusFilter('contacted');
    }
  };

  const filteredExposants = exposants?.filter(e => {
    // Search filter
    const matchesSearch = 
      e.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.specialties?.some(s => s.toLowerCase().includes(searchTerm.toLowerCase()));
    
    // Tier filter
    const matchesTier = tierFilter === 'all' || e.tier?.toString() === tierFilter;
    
    // Status filter  
    const matchesStatus = statusFilter === 'all' || e.outreach_status === statusFilter;
    
    // Quick filters
    if (quickFilter === 'priority') return matchesSearch && e.is_priority;
    if (quickFilter === 'withEmail') return matchesSearch && !!e.email;
    if (quickFilter === 'withPhone') return matchesSearch && !!e.phone;
    if (quickFilter === 'withLinkedIn') return matchesSearch && !!e.linkedin_url;
    if (quickFilter === 'contacted') {
      const contactedStatuses = ['contacted', 'met_at_event', 'demo_scheduled', 'follow_up_sent', 'proposal_sent', 'converted'];
      return matchesSearch && contactedStatuses.includes(e.outreach_status || '');
    }
    
    return matchesSearch && matchesTier && matchesStatus;
  });

  // Calculate days until the event
  const eventDate = new Date('2026-01-28');
  const today = new Date();
  const daysUntil = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // Calculate additional stats
  const tierStats = {
    tier1: exposants?.filter(e => e.tier === 1).length || 0,
    tier2: exposants?.filter(e => e.tier === 2).length || 0,
    tier3: exposants?.filter(e => e.tier === 3).length || 0,
    tier4: exposants?.filter(e => e.tier === 4).length || 0,
  };

  const withPhone = exposants?.filter(e => e.phone).length || 0;

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <div className="relative rounded-3xl overflow-hidden shadow-2xl">
        <img 
          src={salonBanner} 
          alt="Salon du Mariage Paris 2026" 
          className="w-full h-64 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-8 md:px-12">
          <Badge className="w-fit mb-3 bg-pink-500/90 text-white border-0">
            <Heart className="h-3 w-3 mr-1" />
            Salon Premium
          </Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">
            Salon du Mariage Paris 2026
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-white/90 text-sm">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              31 janvier - 1er février 2026
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              Porte de Versailles, Paris
            </span>
            <Badge className="bg-white/20 text-white border-0">
              <Clock className="h-3 w-3 mr-1" />
              J-{daysUntil}
            </Badge>
          </div>
        </div>
      </div>

      {/* Economic Context Card */}
      <Card className="rounded-3xl border-0 shadow-xl shadow-pink-500/5 bg-gradient-to-br from-pink-50 via-white to-rose-50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-display">Opportunité Marché</CardTitle>
              <CardDescription>Analyse Perplexity du marché nuptial français</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-semibold text-foreground">Le marché en chiffres</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>5 milliards €</strong> de valeur marché en 2025-2026</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>270 000 mariages</strong> prévus, record sur 20 ans</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>17 100 €</strong> budget moyen (vs 12 700 € en 2019)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>40%</strong> des couples dépensent plus de 20 000 €</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>110 €/invité</strong> pour la gastronomie en moyenne</span>
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-foreground">Pertinence pour Gourmet</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>Guest Care prioritaire :</strong> 61% des couples placent les attentions aux invités dans leurs priorités absolues</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>Montée en gamme :</strong> Recherche d'expériences originales et produits d'exception</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>Secondes noces :</strong> Explosion des couples 50+ avec budgets jusqu'à 45 000 €</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-pink-500 font-bold">•</span>
                  <span><strong>300+ exposants</strong> et <strong>40 000 visiteurs</strong> attendus</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div 
          className={`cursor-pointer transition-all ${quickFilter === null ? 'ring-2 ring-primary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => { setQuickFilter(null); setTierFilter('all'); setStatusFilter('all'); }}
        >
          <StatCard
            label="Total"
            value={stats.total}
            icon={Users}
            variant="coral"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'priority' ? 'ring-2 ring-accent/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('priority')}
        >
          <StatCard
            label="Prioritaires"
            value={stats.priority}
            icon={Star}
            variant="yellow"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'tier1' ? 'ring-2 ring-secondary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('tier1')}
        >
          <StatCard
            label="Tier 1"
            value={tierStats.tier1}
            icon={Award}
            variant="turquoise"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'tier2' ? 'ring-2 ring-primary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('tier2')}
        >
          <StatCard
            label="Tier 2"
            value={tierStats.tier2}
            icon={Award}
            variant="coral"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'withEmail' ? 'ring-2 ring-accent/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('withEmail')}
        >
          <StatCard
            label="Avec email"
            value={stats.withEmail}
            icon={Mail}
            variant="yellow"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'withPhone' ? 'ring-2 ring-secondary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('withPhone')}
        >
          <StatCard
            label="Avec tél"
            value={withPhone}
            icon={Phone}
            variant="turquoise"
          />
        </div>
        <div 
          className={`cursor-pointer transition-all ${quickFilter === 'withLinkedIn' ? 'ring-2 ring-primary/50' : 'hover:scale-[1.02]'}`}
          onClick={() => handleQuickFilter('withLinkedIn')}
        >
          <StatCard
            label="Avec LinkedIn"
            value={stats.withLinkedIn}
            icon={Linkedin}
            variant="coral"
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
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un wedding planner..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 rounded-xl"
          />
        </div>
        
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-[180px] rounded-xl">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            {TIER_FILTERS.map(filter => (
              <SelectItem key={filter.value} value={filter.value}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] rounded-xl">
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
        
        <Button variant="outline" className="gap-2" asChild>
          <a href="https://www.lesalondumariage.com/" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Site officiel
          </a>
        </Button>
      </div>

      {/* Results count */}
      {filteredExposants && (
        <p className="text-sm text-muted-foreground">
          {filteredExposants.length} wedding planner{filteredExposants.length > 1 ? 's' : ''} trouvé{filteredExposants.length > 1 ? 's' : ''}
        </p>
      )}

      {/* Exposants list */}
      {isLoading ? (
        <LoadingSpinner />
      ) : filteredExposants && filteredExposants.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExposants.map((exposant) => (
            <SalonExposantCard
              key={exposant.id}
              exposant={exposant}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Heart}
          title="Aucun wedding planner"
          description={searchTerm || tierFilter !== 'all' || statusFilter !== 'all' 
            ? "Aucun résultat ne correspond à vos critères de recherche." 
            : "Les fiches des wedding planners présents au Salon du Mariage seront ajoutées ici."}
        />
      )}
    </div>
  );
}
