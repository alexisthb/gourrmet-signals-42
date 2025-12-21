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
  Filter,
  ArrowUpRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingPage } from '@/components/LoadingSpinner';
import { usePappersSignals, usePappersStats, useRunPappersScan, useTransferToSignals } from '@/hooks/usePappers';

const SIGNAL_TYPE_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  anniversary: { label: 'Anniversaire', emoji: '🎂', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  nomination: { label: 'Nomination', emoji: '👔', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  capital_increase: { label: 'Levée', emoji: '💰', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  transfer: { label: 'Déménagement', emoji: '📍', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  creation: { label: 'Création', emoji: '🚀', color: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
};

export default function PappersDashboard() {
  const { data: signals, isLoading: signalsLoading } = usePappersSignals({ limit: 20 });
  const { data: stats, isLoading: statsLoading } = usePappersStats();
  const runScan = useRunPappersScan();
  const transferToSignals = useTransferToSignals();

  if (signalsLoading || statsLoading) {
    return <LoadingPage />;
  }

  const handleRunScan = async () => {
    await runScan.mutateAsync(undefined);
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
            disabled={runScan.isPending}
            size="sm"
          >
            {runScan.isPending ? (
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
          value={stats?.total || 0}
          icon={TrendingUp}
          iconColor="text-primary"
        />
        <StatCard
          label="Anniversaires"
          value={stats?.anniversaries || 0}
          icon={Calendar}
          iconColor="text-amber-500"
        />
        <StatCard
          label="Nominations"
          value={stats?.nominations || 0}
          icon={Award}
          iconColor="text-blue-500"
        />
        <StatCard
          label="À traiter"
          value={stats?.pending || 0}
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

        {signals && signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map((signal) => {
              const config = SIGNAL_TYPE_CONFIG[signal.signal_type] || SIGNAL_TYPE_CONFIG.creation;
              const companyData = signal.company_data || {};
              
              return (
                <Card key={signal.id} className="hover:border-primary/30 transition-colors">
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
                          {signal.transferred_to_signals && (
                            <Badge variant="outline" className="text-xs text-success border-success/30">
                              Transféré
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground truncate">
                          {signal.company_name}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {signal.signal_detail}
                        </p>
                        {(companyData.effectif || companyData.chiffre_affaires || companyData.ville) && (
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {companyData.effectif && (
                              <span>{companyData.effectif} employés</span>
                            )}
                            {companyData.chiffre_affaires && (
                              <span>{(companyData.chiffre_affaires / 1000000).toFixed(1)}M€ CA</span>
                            )}
                            {companyData.ville && (
                              <span>{companyData.ville}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-2xl font-bold text-primary">
                            {signal.relevance_score}
                          </div>
                          <div className="text-xs text-muted-foreground">score</div>
                        </div>
                        {!signal.transferred_to_signals && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => transferToSignals.mutate(signal)}
                            disabled={transferToSignals.isPending}
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </Button>
                        )}
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
