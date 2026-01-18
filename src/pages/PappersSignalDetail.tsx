import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
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
  Euro,
  Briefcase,
  FileText,
  Hash,
  Landmark,
  CalendarDays,
  Timer,
  Target,
  Cake,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LoadingPage, LoadingSpinner } from '@/components/LoadingSpinner';
import { ContactCard } from '@/components/ContactCard';
import { supabase } from '@/integrations/supabase/client';
import { useTransferToSignals, type PappersSignal } from '@/hooks/usePappers';
import { useSignalEnrichment, useTriggerEnrichment, useUpdateContactStatus, useCheckManusStatus } from '@/hooks/useEnrichment';
import { useToast } from '@/hooks/use-toast';

// Helper to safely access company_data properties
function getCompanyDataValue(companyData: unknown, key: string): string | number | null {
  if (typeof companyData === 'object' && companyData !== null && !Array.isArray(companyData)) {
    const obj = companyData as Record<string, unknown>;
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
  }
  return null;
}

// Format large numbers with spaces
function formatNumber(num: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

// Format currency
function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1).replace('.', ',')} M€`;
  }
  if (amount >= 1000) {
    return `${formatNumber(amount)} €`;
  }
  return `${amount} €`;
}

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
        .eq('id', id!)
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
      const pappersSignal: PappersSignal = {
        ...signal,
        company_data: (signal.company_data || {}) as Record<string, unknown>,
      };
      const newSignal = await transferToSignals.mutateAsync(pappersSignal);
      
      toast({
        title: '✅ Signal transféré',
        description: 'Lancement de l\'enrichissement...',
      });

      await triggerEnrichment.mutateAsync(newSignal.id);
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

  const companyData = signal.company_data;

  // Extract all available data
  const anniversaryDate = getCompanyDataValue(companyData, 'anniversary_date');
  const anniversaryYears = getCompanyDataValue(companyData, 'anniversary_years');
  const daysUntilAnniversary = getCompanyDataValue(companyData, 'days_until_anniversary');
  const dateCreation = getCompanyDataValue(companyData, 'date_creation');
  const effectif = getCompanyDataValue(companyData, 'effectif');
  const ville = getCompanyDataValue(companyData, 'ville');
  const codePostal = getCompanyDataValue(companyData, 'code_postal');
  const region = getCompanyDataValue(companyData, 'region');
  const chiffreAffaires = getCompanyDataValue(companyData, 'chiffre_affaires');
  const codeNaf = getCompanyDataValue(companyData, 'code_naf');
  const libelleCodeNaf = getCompanyDataValue(companyData, 'libelle_code_naf');
  const formeJuridique = getCompanyDataValue(companyData, 'forme_juridique');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with gradient */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-secondary/10 via-secondary/5 to-transparent p-6 border border-secondary/20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-secondary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        
        <div className="relative flex items-start gap-4">
          <Link to="/pappers">
            <Button variant="ghost" size="icon" className="hover:bg-secondary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-3 rounded-2xl bg-secondary/10 border border-secondary/20">
                <Building2 className="h-7 w-7 text-secondary" />
              </div>
              <div>
                <h1 className="text-2xl font-display font-bold text-foreground">
                  {signal.company_name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  SIREN : <span className="font-mono">{signal.siren}</span>
                </p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2 mt-3">
              {signal.transferred_to_signals && (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Transféré
                </Badge>
              )}
              <Badge variant="outline" className="bg-secondary/10 text-secondary border-secondary/30">
                <Award className="h-3 w-3 mr-1" />
                Score : {signal.relevance_score}/100
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* HERO: Anniversary countdown */}
      {anniversaryYears && anniversaryDate && (
        <Card className="overflow-hidden border-2 border-secondary/30 bg-gradient-to-br from-secondary/5 to-transparent">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-secondary/20">
              {/* Anniversary years */}
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <Cake className="h-10 w-10 text-secondary mb-3" />
                <div className="text-5xl font-display font-bold text-secondary">
                  {anniversaryYears}
                </div>
                <span className="text-lg text-muted-foreground">ans</span>
              </div>
              
              {/* Date */}
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <CalendarDays className="h-10 w-10 text-secondary mb-3" />
                <div className="text-2xl font-display font-bold text-foreground">
                  {format(new Date(String(anniversaryDate)), 'dd MMMM yyyy', { locale: fr })}
                </div>
                <span className="text-sm text-muted-foreground">Date d'anniversaire</span>
              </div>
              
              {/* Countdown - always calculated dynamically */}
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <Timer className="h-10 w-10 text-secondary mb-3" />
                <div className="text-4xl font-display font-bold text-foreground">
                  {differenceInDays(new Date(String(anniversaryDate)), new Date())}
                </div>
                <span className="text-sm text-muted-foreground">jours restants</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Fiche entreprise complète */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-secondary" />
                Fiche entreprise
                <Badge variant="outline" className="ml-auto text-xs">Données gratuites</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Identification */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Identification
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-muted/50 border border-border">
                    <span className="text-xs text-muted-foreground">SIREN</span>
                    <p className="font-mono font-semibold text-lg">{signal.siren}</p>
                  </div>
                  {dateCreation && (
                    <div className="p-4 rounded-xl bg-muted/50 border border-border">
                      <span className="text-xs text-muted-foreground">Création</span>
                      <p className="font-semibold">
                        {format(new Date(String(dateCreation)), 'dd/MM/yyyy', { locale: fr })}
                      </p>
                    </div>
                  )}
                  {formeJuridique && (
                    <div className="p-4 rounded-xl bg-muted/50 border border-border md:col-span-1 col-span-2">
                      <span className="text-xs text-muted-foreground">Forme juridique</span>
                      <p className="font-semibold text-sm">{formeJuridique}</p>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Activité */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Activité
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {libelleCodeNaf && (
                    <div className="p-4 rounded-xl bg-secondary/5 border border-secondary/20 col-span-full">
                      <span className="text-xs text-muted-foreground">Secteur d'activité</span>
                      <p className="font-semibold text-foreground">{libelleCodeNaf}</p>
                      {codeNaf && (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          NAF {codeNaf}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Taille & Finances */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Taille & Finances
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {effectif && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">Effectif</span>
                      </div>
                      <p className="font-semibold text-lg text-foreground">{effectif}</p>
                    </div>
                  )}
                  {chiffreAffaires && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-success/5 to-transparent border border-success/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Euro className="h-4 w-4 text-success" />
                        <span className="text-xs text-muted-foreground">Chiffre d'affaires</span>
                      </div>
                      <p className="font-semibold text-lg text-foreground">
                        {formatCurrency(Number(chiffreAffaires))}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Localisation */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Localisation
                </h4>
                <div className="p-4 rounded-xl bg-muted/50 border border-border">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-secondary/10">
                      <MapPin className="h-5 w-5 text-secondary" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">
                        {ville}
                        {codePostal && ` (${codePostal})`}
                      </p>
                      {region && (
                        <Badge variant="secondary" className="mt-2">
                          {region}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
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
          <Card className="border-2 border-secondary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-secondary" />
                Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!signal.transferred_to_signals ? (
                <Button
                  className="w-full bg-secondary hover:bg-secondary/90"
                  onClick={handleTransferAndEnrich}
                  disabled={isTransferring}
                >
                  {isTransferring ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      En cours...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Transférer & Enrichir
                    </>
                  )}
                </Button>
              ) : (
                <Badge variant="outline" className="w-full justify-center py-2 bg-success/10 text-success">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Signal transféré
                </Badge>
              )}

              {linkedSignalId && (
                <Link to={`/signals/${linkedSignalId}`} className="block">
                  <Button variant="outline" className="w-full">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Voir le signal enrichi
                  </Button>
                </Link>
              )}

              <Separator />

              <div className="text-xs text-muted-foreground text-center">
                <FileText className="h-4 w-4 inline mr-1" />
                Enrichissement : 1 crédit/entreprise
              </div>
            </CardContent>
          </Card>

          {/* Quick stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Landmark className="h-4 w-4" />
                Résumé
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Score</span>
                <Badge variant="secondary" className="bg-secondary/10 text-secondary font-bold">
                  {signal.relevance_score}/100
                </Badge>
              </div>
              {effectif && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Effectif</span>
                  <span className="font-medium">{effectif}</span>
                </div>
              )}
              {chiffreAffaires && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">CA</span>
                  <span className="font-medium text-success">
                    {formatCurrency(Number(chiffreAffaires))}
                  </span>
                </div>
              )}
              {ville && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Ville</span>
                  <span className="font-medium">{ville}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Détecté le</span>
                <span className="text-xs">
                  {signal.detected_at && format(new Date(signal.detected_at), 'dd/MM/yyyy', { locale: fr })}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Signal detail */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Award className="h-4 w-4 text-secondary" />
                Détail du signal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{signal.signal_detail}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
