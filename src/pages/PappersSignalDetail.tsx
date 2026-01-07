import { useState } from 'react';
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
  Award,
  TrendingUp,
  CheckCircle2,
  Clock,
  Sparkles,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LoadingPage, LoadingSpinner } from '@/components/LoadingSpinner';
import { ContactCard } from '@/components/ContactCard';
import { supabase } from '@/integrations/supabase/client';
import { useTransferToSignals } from '@/hooks/usePappers';
import { useSignalEnrichment, useTriggerEnrichment, useUpdateContactStatus, useCheckManusStatus } from '@/hooks/useEnrichment';
import { useToast } from '@/hooks/use-toast';

export default function PappersSignalDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const transferToSignals = useTransferToSignals();
  const triggerEnrichment = useTriggerEnrichment();
  const updateContactStatus = useUpdateContactStatus();
  const checkManusStatus = useCheckManusStatus();
  const [isTransferring, setIsTransferring] = useState(false);

  // Fetch Pappers signal
  const { data: signal, isLoading, refetch: refetchSignal } = useQuery({
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

  // If transferred, get the linked signal_id
  const linkedSignalId = signal?.signal_id;

  // Fetch enrichment data for linked signal
  const { data: enrichmentData, isLoading: enrichmentLoading, refetch: refetchEnrichment } = useSignalEnrichment(linkedSignalId || '');

  // Fetch linked signal status
  const { data: linkedSignal, refetch: refetchLinkedSignal } = useQuery({
    queryKey: ['linked-signal', linkedSignalId],
    queryFn: async () => {
      if (!linkedSignalId) return null;
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('id', linkedSignalId)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!linkedSignalId,
  });

  const enrichmentStatus = linkedSignal?.enrichment_status || 'none';
  const isManusProcessing = enrichmentStatus === 'manus_processing';
  const contacts = enrichmentData?.contacts || [];
  const hasContacts = contacts.length > 0;

  // Transfer and enrich in one action
  const handleTransferAndEnrich = async () => {
    if (!signal) return;
    setIsTransferring(true);

    try {
      // Step 1: Transfer to signals
      const newSignal = await transferToSignals.mutateAsync(signal);
      
      toast({
        title: '✅ Signal transféré',
        description: 'Lancement de l\'enrichissement...',
      });

      // Step 2: Trigger enrichment
      await triggerEnrichment.mutateAsync(newSignal.id);
      
      // Refetch everything
      await refetchSignal();
      
      toast({
        title: '🚀 Enrichissement lancé',
        description: 'Recherche des contacts en cours...',
      });

    } catch (error) {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Une erreur est survenue',
        variant: 'destructive',
      });
    } finally {
      setIsTransferring(false);
    }
  };

  // Just enrich (if already transferred)
  const handleEnrich = async () => {
    if (!linkedSignalId) return;

    try {
      const result = await triggerEnrichment.mutateAsync(linkedSignalId);
      await refetchEnrichment();
      await refetchLinkedSignal();

      if (result.manus_task_id) {
        toast({
          title: '🚀 Manus analyse l\'entreprise',
          description: 'La recherche peut prendre quelques minutes.',
        });
      } else {
        toast({
          title: '✅ Enrichissement terminé',
          description: `${result.contacts_count || 0} contact(s) trouvé(s).`,
        });
      }
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enrichir ce signal.',
        variant: 'destructive',
      });
    }
  };

  // Check Manus status manually
  const handleCheckStatus = async () => {
    if (!linkedSignalId) return;

    try {
      const result = await checkManusStatus.mutateAsync(linkedSignalId);
      if (result.status === 'completed') {
        await refetchEnrichment();
        await refetchLinkedSignal();
        toast({
          title: '✅ Enrichissement terminé',
          description: `${result.contacts_count || 0} contact(s) trouvé(s).`,
        });
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const handleContactStatusChange = async (contactId: string, newStatus: string) => {
    try {
      await updateContactStatus.mutateAsync({ contactId, status: newStatus });
      toast({
        title: 'Statut mis à jour',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour le statut.',
        variant: 'destructive',
      });
    }
  };

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
          {signal.transferred_to_signals && (
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

          {/* SECTION CONTACTS */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-violet-500/10">
                    <Users className="h-5 w-5 text-violet-500" />
                  </div>
                  <div>
                    <CardTitle>Contacts décideurs</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {isManusProcessing 
                        ? 'Manus analyse l\'entreprise...'
                        : hasContacts 
                          ? `${contacts.length} contact${contacts.length > 1 ? 's' : ''} trouvé${contacts.length > 1 ? 's' : ''}`
                          : signal.transferred_to_signals
                            ? 'Enrichissez ce signal pour trouver les décideurs'
                            : 'Transférez et enrichissez pour trouver les décideurs'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {isManusProcessing && (
                    <Button
                      variant="outline"
                      onClick={handleCheckStatus}
                      disabled={checkManusStatus.isPending}
                    >
                      {checkManusStatus.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  )}

                  {!signal.transferred_to_signals ? (
                    <Button
                      onClick={handleTransferAndEnrich}
                      disabled={isTransferring || transferToSignals.isPending}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {isTransferring ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Transfert...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          Transférer & Enrichir
                        </>
                      )}
                    </Button>
                  ) : enrichmentStatus !== 'completed' && !isManusProcessing && (
                    <Button
                      onClick={handleEnrich}
                      disabled={triggerEnrichment.isPending}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {triggerEnrichment.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enrichissement...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          Enrichir avec Manus
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Manus Processing State */}
              {isManusProcessing && (
                <div className="mb-4 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-6 w-6 text-violet-500 animate-spin" />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">Manus recherche les décideurs...</p>
                      <p className="text-sm text-muted-foreground">
                        Cette opération peut prendre quelques minutes.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {enrichmentLoading ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : hasContacts ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {contacts.map((contact) => (
                    <ContactCard
                      key={contact.id}
                      contact={{
                        ...contact,
                        companyName: signal.company_name,
                        eventDetail: signal.signal_detail || undefined,
                      }}
                      onStatusChange={handleContactStatusChange}
                    />
                  ))}
                </div>
              ) : enrichmentStatus === 'completed' ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Aucun contact trouvé pour cette entreprise.</p>
                </div>
              ) : !isManusProcessing && !signal.transferred_to_signals ? (
                <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">
                    Cliquez sur "Transférer & Enrichir" pour trouver les décideurs.
                  </p>
                </div>
              ) : !isManusProcessing ? (
                <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">
                    Cliquez sur "Enrichir avec Manus" pour trouver les décideurs.
                  </p>
                </div>
              ) : null}
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
                  <ExternalLink className="h-4 w-4 mr-2" />
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
              {linkedSignalId && (
                <Link to={`/signals/${linkedSignalId}`} className="block">
                  <Button variant="outline" className="w-full justify-start">
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Voir signal complet
                  </Button>
                </Link>
              )}
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
                <span className="text-sm text-muted-foreground">Transféré</span>
                {signal.transferred_to_signals ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Oui</Badge>
                ) : (
                  <Badge variant="secondary">Non</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Enrichi</span>
                {enrichmentStatus === 'completed' ? (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Oui</Badge>
                ) : enrichmentStatus === 'manus_processing' ? (
                  <Badge variant="secondary" className="bg-violet-100 text-violet-700">En cours</Badge>
                ) : (
                  <Badge variant="secondary">Non</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Contacts</span>
                <Badge variant="outline">{contacts.length}</Badge>
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
