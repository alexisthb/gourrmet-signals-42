import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ArrowLeft,
  Building2,
  Calendar,
  MapPin,
  Users,
  ExternalLink,
  Phone,
  Mail,
  Globe,
  Award,
  TrendingUp,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LoadingPage } from '@/components/LoadingSpinner';
import { supabase } from '@/integrations/supabase/client';
import { useTransferToSignals } from '@/hooks/usePappers';

export default function PappersSignalDetail() {
  const { id } = useParams<{ id: string }>();
  const transferToSignals = useTransferToSignals();

  const { data: signal, isLoading } = useQuery({
    queryKey: ['pappers-signal', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pappers_signals')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!signal) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Signal non trouvé</h2>
        <Link to="/pappers">
          <Button variant="link">Retour aux signaux Pappers</Button>
        </Link>
      </div>
    );
  }

  const companyData = signal.company_data || {};

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/pappers">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Building2 className="h-6 w-6 text-source-pappers" />
            {signal.company_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détecté {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true, locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!signal.transferred_to_signals ? (
            <Button
              onClick={() => transferToSignals.mutate(signal)}
              disabled={transferToSignals.isPending}
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Transférer vers Signaux
            </Button>
          ) : (
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Transféré
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signal Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-source-pappers" />
                Signal détecté
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="bg-source-pappers/10 text-source-pappers border-source-pappers/30 text-base px-3 py-1">
                  🎂 Anniversaire
                </Badge>
                <div className="text-3xl font-bold text-source-pappers">
                  {signal.relevance_score}
                </div>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              
              <p className="text-lg">{signal.signal_detail}</p>

              {companyData.anniversary_date && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>
                    Date d'anniversaire : {format(new Date(companyData.anniversary_date), 'dd MMMM yyyy', { locale: fr })}
                  </span>
                </div>
              )}

              {companyData.anniversary_years && (
                <div className="p-4 bg-source-pappers/5 rounded-lg border border-source-pappers/20">
                  <span className="text-4xl font-bold text-source-pappers">{companyData.anniversary_years}</span>
                  <span className="text-lg ml-2 text-muted-foreground">ans d'existence</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Informations entreprise */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Informations entreprise
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">SIREN</span>
                  <p className="font-mono font-semibold">{signal.siren}</p>
                </div>
                {companyData.date_creation && (
                  <div>
                    <span className="text-sm text-muted-foreground">Date de création</span>
                    <p className="font-semibold">
                      {format(new Date(companyData.date_creation), 'dd MMMM yyyy', { locale: fr })}
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                {companyData.effectif && (
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm text-muted-foreground">Effectif</span>
                      <p className="font-semibold">{companyData.effectif}</p>
                    </div>
                  </div>
                )}
                {(companyData.ville || signal.detected_city) && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm text-muted-foreground">Localisation</span>
                      <p className="font-semibold">
                        {signal.detected_city || companyData.ville}
                        {companyData.code_postal && ` (${companyData.code_postal})`}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {(companyData.region || signal.detected_region) && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                    <MapPin className="h-3 w-3 mr-1" />
                    {signal.detected_region || companyData.region}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Colonne droite */}
        <div className="space-y-6">
          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <a
                  href={`https://www.pappers.fr/entreprise/${signal.siren}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Voir sur Pappers
                </a>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <a
                  href={`https://www.societe.com/societe/${signal.siren}.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Globe className="h-4 w-4 mr-2" />
                  Voir sur Societe.com
                </a>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(signal.company_name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Rechercher sur Google
                </a>
              </Button>
            </CardContent>
          </Card>

          {/* Statut */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Statut
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Traité</span>
                {signal.processed ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Oui</Badge>
                ) : (
                  <Badge variant="secondary">Non</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Transféré</span>
                {signal.transferred_to_signals ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Oui</Badge>
                ) : (
                  <Badge variant="secondary">Non</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Priorité géo</span>
                <Badge variant="outline">
                  {signal.geo_priority === 1 ? '🔥 Haute' : signal.geo_priority === 2 ? 'Moyenne' : 'Normale'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

