import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  RefreshCw, 
  Loader2,
  Calendar,
  MapPin,
  Star,
  Plus,
  CheckCircle2,
  ExternalLink,
  Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/hooks/use-toast';
import { format, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DetectedEvent {
  id: string;
  name: string;
  type: string;
  date_start: string;
  date_end?: string;
  location: string;
  source: string;
  source_url?: string;
  description?: string;
  relevance_score: number;
  is_added: boolean;
  detected_at: string;
}

const mockDetectedEvents: DetectedEvent[] = [
  {
    id: '1',
    name: 'Maison & Objet Paris',
    type: 'salon',
    date_start: addDays(new Date(), 75).toISOString(),
    date_end: addDays(new Date(), 79).toISOString(),
    location: 'Paris Nord Villepinte',
    source: 'maison-objet.com',
    source_url: 'https://www.maison-objet.com',
    description: 'Salon international de la décoration, du design et de l\'art de vivre',
    relevance_score: 95,
    is_added: false,
    detected_at: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'SIRHA Lyon',
    type: 'salon',
    date_start: addDays(new Date(), 120).toISOString(),
    date_end: addDays(new Date(), 124).toISOString(),
    location: 'Lyon Eurexpo',
    source: 'sirha.com',
    source_url: 'https://www.sirha.com',
    description: 'Salon mondial de la restauration et de l\'hôtellerie',
    relevance_score: 88,
    is_added: false,
    detected_at: new Date().toISOString(),
  },
  {
    id: '3',
    name: 'Première Vision Paris',
    type: 'salon',
    date_start: addDays(new Date(), 45).toISOString(),
    date_end: addDays(new Date(), 47).toISOString(),
    location: 'Paris Nord Villepinte',
    source: 'premierevision.com',
    description: 'Salon international des tissus et matières',
    relevance_score: 72,
    is_added: false,
    detected_at: new Date().toISOString(),
  },
  {
    id: '4',
    name: 'Forum Entreprises CCI Paris',
    type: 'networking',
    date_start: addDays(new Date(), 30).toISOString(),
    location: 'CCI Paris Île-de-France',
    source: 'cci-paris-idf.fr',
    description: 'Rencontres B2B entre entrepreneurs',
    relevance_score: 65,
    is_added: true,
    detected_at: new Date().toISOString(),
  },
];

export default function EventsScanner() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [events, setEvents] = useState<DetectedEvent[]>(mockDetectedEvents);

  const handleRunScan = async () => {
    setIsScanning(true);
    // Simulate scan
    setTimeout(() => {
      setIsScanning(false);
      toast({
        title: 'Scan terminé',
        description: '4 événements détectés dans les sources configurées.',
      });
    }, 3000);
  };

  const handleAddEvent = (eventId: string) => {
    setEvents(prev => prev.map(e => 
      e.id === eventId ? { ...e, is_added: true } : e
    ));
    toast({
      title: 'Événement ajouté',
      description: 'L\'événement a été transféré vers votre calendrier.',
    });
  };

  const stats = {
    detected: events.length,
    highRelevance: events.filter(e => e.relevance_score >= 80).length,
    added: events.filter(e => e.is_added).length,
    pending: events.filter(e => !e.is_added).length,
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success';
    if (score >= 60) return 'text-amber-500';
    return 'text-muted-foreground';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" />
            Scanner Événements
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détection automatique d'événements pertinents pour GOURЯMET
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Sources
          </Button>
          <Button
            onClick={handleRunScan}
            disabled={isScanning}
          >
            {isScanning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scan en cours...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Lancer scan
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Détectés"
          value={stats.detected}
          icon={Search}
          iconColor="text-primary"
        />
        <StatCard
          label="Haute pertinence"
          value={stats.highRelevance}
          icon={Star}
          iconColor="text-amber-500"
        />
        <StatCard
          label="Ajoutés"
          value={stats.added}
          icon={CheckCircle2}
          iconColor="text-success"
        />
        <StatCard
          label="À examiner"
          value={stats.pending}
          icon={Calendar}
          iconColor="text-blue-500"
        />
      </div>

      {/* Scanning progress */}
      {isScanning && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="font-medium">Analyse des sources en cours...</span>
            </div>
            <Progress value={45} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">
              Recherche sur maison-objet.com, sirha.com, cci-paris-idf.fr...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Events list */}
      <div>
        <h2 className="font-semibold text-foreground mb-4">Événements détectés</h2>
        
        {events.length > 0 ? (
          <div className="space-y-3">
            {events
              .sort((a, b) => b.relevance_score - a.relevance_score)
              .map((event) => (
                <Card 
                  key={event.id} 
                  className={event.is_added ? 'opacity-60' : 'hover:border-primary/30 transition-colors'}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {event.type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            via {event.source}
                          </span>
                          {event.is_added && (
                            <Badge variant="secondary" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Ajouté
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground">{event.name}</h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {format(new Date(event.date_start), 'd MMM yyyy', { locale: fr })}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {event.location}
                          </span>
                        </div>
                        {event.description && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-1">
                            {event.description}
                          </p>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Score */}
                        <div className="text-center">
                          <div className={`text-2xl font-bold ${getScoreColor(event.relevance_score)}`}>
                            {event.relevance_score}
                          </div>
                          <div className="text-xs text-muted-foreground">pertinence</div>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex flex-col gap-1">
                          {!event.is_added && (
                            <Button 
                              size="sm" 
                              onClick={() => handleAddEvent(event.id)}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Ajouter
                            </Button>
                          )}
                          {event.source_url && (
                            <Button 
                              variant="outline" 
                              size="sm"
                              asChild
                            >
                              <a href={event.source_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : (
          <EmptyState
            title="Aucun événement détecté"
            description="Lancez un scan pour détecter des événements depuis vos sources configurées."
          />
        )}
      </div>

      {/* Sources info */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-6">
          <h3 className="font-semibold text-foreground mb-2">Sources configurées</h3>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">CCI Paris IDF</Badge>
            <Badge variant="outline">Eventbrite</Badge>
            <Badge variant="outline">Maison & Objet</Badge>
            <Badge variant="outline">SIRHA</Badge>
            <Badge variant="outline">Paris Expo</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            Le score de pertinence est calculé selon les critères : secteur cadeaux d'affaires, 
            luxe/gastronomie, événementiel B2B, et localisation Île-de-France.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
