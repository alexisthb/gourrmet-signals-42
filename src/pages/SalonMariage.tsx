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
  Clock
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { SalonExposantCard } from '@/components/SalonExposantCard';
import { useSalonExposants, useSalonStats, useUpdateSalonExposant } from '@/hooks/useSalonMariage';
import { EmptyState } from '@/components/EmptyState';
import salonBanner from '@/assets/salon-mariage-banner.jpg';

export default function SalonMariage() {
  const [searchTerm, setSearchTerm] = useState('');
  const { data: exposants, isLoading } = useSalonExposants();
  const stats = useSalonStats();
  const updateExposant = useUpdateSalonExposant();

  const handleStatusChange = (id: string, status: string) => {
    updateExposant.mutate({ id, outreach_status: status });
  };

  const filteredExposants = exposants?.filter(e => 
    e.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.specialties?.some(s => s.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Calculate days until the event
  const eventDate = new Date('2026-01-28');
  const today = new Date();
  const daysUntil = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="Wedding Planners"
          value={stats.total}
          icon={Users}
          variant="coral"
        />
        <StatCard
          label="Prioritaires"
          value={stats.priority}
          icon={Star}
          variant="yellow"
        />
        <StatCard
          label="Contactés"
          value={stats.contacted}
          icon={Mail}
          variant="turquoise"
        />
        <StatCard
          label="Avec email"
          value={stats.withEmail}
          icon={Mail}
          variant="coral"
        />
        <StatCard
          label="Avec LinkedIn"
          value={stats.withLinkedIn}
          icon={Linkedin}
          variant="yellow"
        />
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
        <Button variant="outline" className="gap-2" asChild>
          <a href="https://www.lesalondumariage.com/" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Site officiel
          </a>
        </Button>
      </div>

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
          description="Les fiches des wedding planners présents au Salon du Mariage seront ajoutées ici. Préparez votre fichier avec les informations des exposants."
        />
      )}
    </div>
  );
}
