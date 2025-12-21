import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Building2, 
  Search, 
  Plus, 
  RefreshCw, 
  Loader2,
  TrendingUp,
  Calendar,
  Award,
  ArrowRight,
  Sparkles,
  Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/hooks/use-toast';

// Types for Pappers signals
interface PappersSignal {
  id: string;
  company_name: string;
  siren: string;
  signal_type: 'anniversary' | 'nomination' | 'capital_increase' | 'transfer' | 'creation';
  signal_detail: string;
  relevance_score: number;
  detected_at: string;
  processed: boolean;
  company_data?: {
    date_creation?: string;
    forme_juridique?: string;
    effectif?: string;
    chiffre_affaires?: number;
    code_naf?: string;
  };
}

// Mock data for UI development
const mockSignals: PappersSignal[] = [
  {
    id: '1',
    company_name: 'Maison Dupont & Fils',
    siren: '123456789',
    signal_type: 'anniversary',
    signal_detail: 'Fête ses 25 ans en Mars 2025',
    relevance_score: 92,
    detected_at: new Date().toISOString(),
    processed: false,
    company_data: {
      date_creation: '2000-03-15',
      forme_juridique: 'SAS',
      effectif: '50-99',
      chiffre_affaires: 8500000,
    }
  },
  {
    id: '2',
    company_name: 'Tech Solutions Paris',
    siren: '987654321',
    signal_type: 'nomination',
    signal_detail: 'Nouveau Directeur Général nommé',
    relevance_score: 78,
    detected_at: new Date().toISOString(),
    processed: false,
    company_data: {
      forme_juridique: 'SARL',
      effectif: '100-249',
      chiffre_affaires: 25000000,
    }
  },
  {
    id: '3',
    company_name: 'Groupe Artisanat IDF',
    siren: '456789123',
    signal_type: 'capital_increase',
    signal_detail: 'Augmentation de capital de 500K€',
    relevance_score: 85,
    detected_at: new Date().toISOString(),
    processed: true,
  }
];

const SIGNAL_TYPE_CONFIG = {
  anniversary: { label: 'Anniversaire', emoji: '🎂', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  nomination: { label: 'Nomination', emoji: '👔', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  capital_increase: { label: 'Levée', emoji: '💰', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  transfer: { label: 'Déménagement', emoji: '📍', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  creation: { label: 'Création', emoji: '🚀', color: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
};

export default function PappersDashboard() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [signals] = useState<PappersSignal[]>(mockSignals);

  const handleRunScan = async () => {
    setIsScanning(true);
    // Simulate scan
    setTimeout(() => {
      setIsScanning(false);
      toast({
        title: 'Scan Pappers terminé',
        description: '3 nouveaux signaux détectés',
      });
    }, 2000);
  };

  const stats = {
    total: signals.length,
    anniversaries: signals.filter(s => s.signal_type === 'anniversary').length,
    nominations: signals.filter(s => s.signal_type === 'nomination').length,
    pending: signals.filter(s => !s.processed).length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            Scanner Pappers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détection de leads via l'API Pappers (anniversaires, nominations, levées...)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/pappers/queries">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Requêtes
            </Button>
          </Link>
          <Button
            onClick={handleRunScan}
            disabled={isScanning}
            size="sm"
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
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
          label="Total signaux"
          value={stats.total}
          icon={TrendingUp}
          iconColor="text-primary"
        />
        <StatCard
          label="Anniversaires"
          value={stats.anniversaries}
          icon={Calendar}
          iconColor="text-amber-500"
        />
        <StatCard
          label="Nominations"
          value={stats.nominations}
          icon={Award}
          iconColor="text-blue-500"
        />
        <StatCard
          label="À traiter"
          value={stats.pending}
          icon={Sparkles}
          iconColor="text-violet-500"
        />
      </div>

      {/* Signals List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground">Signaux récents</h2>
          <Button variant="ghost" size="sm" className="text-primary">
            Voir tout <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>

        {signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map((signal) => {
              const config = SIGNAL_TYPE_CONFIG[signal.signal_type];
              return (
                <Card key={signal.id} className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className={config.color}>
                            {config.emoji} {config.label}
                          </Badge>
                          {!signal.processed && (
                            <Badge variant="secondary" className="text-xs">Nouveau</Badge>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground truncate">
                          {signal.company_name}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {signal.signal_detail}
                        </p>
                        {signal.company_data && (
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {signal.company_data.effectif && (
                              <span>{signal.company_data.effectif} employés</span>
                            )}
                            {signal.company_data.chiffre_affaires && (
                              <span>{(signal.company_data.chiffre_affaires / 1000000).toFixed(1)}M€ CA</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-2xl font-bold text-primary">
                          {signal.relevance_score}
                        </div>
                        <div className="text-xs text-muted-foreground">score</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Aucun signal Pappers"
            description="Configurez vos requêtes et lancez un scan pour détecter des leads."
          />
        )}
      </div>

      {/* Quick Actions */}
      <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Configuration rapide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link to="/pappers/queries" className="block">
            <Button variant="outline" size="sm" className="w-full justify-start">
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une requête anniversaire
            </Button>
          </Link>
          <Link to="/pappers/queries" className="block">
            <Button variant="outline" size="sm" className="w-full justify-start">
              <Search className="h-4 w-4 mr-2" />
              Configurer les critères de recherche
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
