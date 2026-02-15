import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowLeft, ExternalLink, Lightbulb, Copy, Check, Save, Users, Sparkles, Loader2, RefreshCw, Euro, Image, Gift, Globe, Bot, Search, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScoreStars } from '@/components/ScoreStars';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { ContactCard } from '@/components/ContactCard';
import { LoadingPage, LoadingSpinner } from '@/components/LoadingSpinner';
import { useSignal, useUpdateSignal } from '@/hooks/useSignals';
import { useSignalEnrichment, useTriggerEnrichment, useUpdateContactStatus, useCheckManusStatus } from '@/hooks/useEnrichment';
import { useCreateSignalInteraction } from '@/hooks/useSignalInteractions';
import { useToast } from '@/hooks/use-toast';
import { STATUS_CONFIG, type SignalStatus } from '@/types/database';
import { formatRevenue } from '@/hooks/useRevenueSettings';
import { useFetchCompanyLogo, useLogoManusPolling } from '@/hooks/useCompanyLogo';
import { GiftTemplateSelector } from '@/components/GiftTemplateSelector';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export default function SignalDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: signal, isLoading, refetch: refetchSignal } = useSignal(id || '');
  const updateSignal = useUpdateSignal();
  const createInteraction = useCreateSignalInteraction();

  // Enrichment hooks
  const { data: enrichmentData, isLoading: enrichmentLoading, refetch: refetchEnrichment } = useSignalEnrichment(id || '');
  const triggerEnrichment = useTriggerEnrichment();
  const updateContactStatus = useUpdateContactStatus();
  const checkManusStatus = useCheckManusStatus();
  const fetchLogo = useFetchCompanyLogo();
  const { isPolling: isLogoPolling, startPolling: startLogoPolling, setIsPolling: setIsLogoPolling } = useLogoManusPolling(id);

  const [status, setStatus] = useState<SignalStatus | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [giftDialogOpen, setGiftDialogOpen] = useState(false);
  const [domainPopoverOpen, setDomainPopoverOpen] = useState(false);
  const [manualDomain, setManualDomain] = useState('');

  const enrichmentStatus = signal?.enrichment_status || 'none';
  const isManusProcessing = enrichmentStatus === 'manus_processing';
  const manusTaskUrl = enrichmentData?.enrichment?.raw_data?.manus_task_url;
  const manusTaskId = enrichmentData?.enrichment?.raw_data?.manus_task_id;

  // If a legacy run ended "completed" before contacts were saved, auto-retry a single sync.
  const attemptedLegacySyncRef = useRef(false);
  const hasContactsForSync = (enrichmentData?.contacts?.length ?? 0) > 0;

  // Polling for Manus status
  const checkStatus = useCallback(async (force = false) => {
    if (!id) return;
    if (!isManusProcessing && !force) return;

    try {
      const result = await checkManusStatus.mutateAsync(id);

      if (result.status === 'completed') {
        await refetchEnrichment();
        await refetchSignal();
        toast({
          title: '✅ Enrichissement terminé',
          description: `${result.contacts_count || 0} contact(s) trouvé(s) par Manus.`,
        });
        setIsPolling(false);
      }
    } catch (error) {
      console.error('Error checking Manus status:', error);
    }
  }, [id, isManusProcessing, checkManusStatus, refetchEnrichment, refetchSignal, toast]);

  // Auto-poll when Manus is processing
  useEffect(() => {
    if (!isManusProcessing) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    const interval = setInterval(() => checkStatus(false), 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [isManusProcessing, checkStatus]);

  // One-time legacy recovery: completed + no contacts + has Manus task id
  useEffect(() => {
    if (!id) return;
    if (attemptedLegacySyncRef.current) return;

    if (enrichmentStatus === 'completed' && !hasContactsForSync && manusTaskId) {
      attemptedLegacySyncRef.current = true;
      checkStatus(true);
    }
  }, [id, enrichmentStatus, hasContactsForSync, manusTaskId, checkStatus]);

  // Auto-start logo polling if signal has an active logo Manus task
  const logoManusTaskId = (signal as any)?.logo_manus_task_id;
  const logoPollingStartedRef = useRef(false);
  useEffect(() => {
    if (logoManusTaskId && !logoPollingStartedRef.current) {
      logoPollingStartedRef.current = true;
      startLogoPolling();
    }
    if (!logoManusTaskId) {
      logoPollingStartedRef.current = false;
    }
  }, [logoManusTaskId, startLogoPolling]);

  // Start logo polling when fetchLogo returns manus_processing
  useEffect(() => {
    if (fetchLogo.data?.status === 'manus_processing') {
      startLogoPolling();
    }
  }, [fetchLogo.data, startLogoPolling]);

  const currentStatus = status ?? signal?.status;
  const currentNotes = notes ?? signal?.notes ?? '';

  const handleCopyHook = async () => {
    if (signal?.hook_suggestion) {
      await navigator.clipboard.writeText(signal.hook_suggestion);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copié !',
        description: "L'accroche a été copiée dans le presse-papiers.",
      });
    }
  };

  const handleSave = async () => {
    if (!signal) return;

    const updates: Record<string, unknown> = {};
    const statusChanged = status !== null && status !== signal.status;
    const notesChanged = notes !== null && notes !== signal.notes;
    
    if (statusChanged) {
      updates.status = status;
      if (['contacted', 'meeting', 'proposal', 'won', 'lost'].includes(status!) && !signal.contacted_at) {
        updates.contacted_at = new Date().toISOString();
      }
    }
    if (notesChanged) {
      updates.notes = notes;
    }

    if (Object.keys(updates).length === 0) {
      toast({
        title: 'Aucune modification',
        description: 'Aucun changement à sauvegarder.',
      });
      return;
    }

    try {
      await updateSignal.mutateAsync({ id: signal.id, updates });
      
      // Log interactions for status change and notes
      if (statusChanged) {
        await createInteraction.mutateAsync({
          signalId: signal.id,
          actionType: 'status_change',
          oldValue: signal.status,
          newValue: status!,
        });
      }
      if (notesChanged) {
        await createInteraction.mutateAsync({
          signalId: signal.id,
          actionType: 'note_added',
          newValue: notes || undefined,
        });
      }
      
      toast({
        title: 'Modifications sauvegardées',
        description: 'Les informations du signal ont été mises à jour.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder les modifications.',
        variant: 'destructive',
      });
    }
  };

  const handleTriggerEnrichment = async () => {
    if (!id) return;
    
    toast({
      title: '🔍 Lancement de l\'enrichissement...',
      description: 'Recherche des contacts et informations entreprise.',
    });

    try {
      const result = await triggerEnrichment.mutateAsync(id);
      await refetchEnrichment();
      await refetchSignal();
      
      // Log enrichment interaction
      await createInteraction.mutateAsync({
        signalId: id,
        actionType: 'enrichment_triggered',
        metadata: { manus_task_id: result.manus_task_id },
      });
      
      // Check if this is an async Manus response
      if (result.manus_task_id) {
        toast({
          title: '🚀 Manus analyse l\'entreprise',
          description: 'La recherche peut prendre quelques minutes. Vous serez notifié automatiquement.',
        });
        setIsPolling(true);
      } else {
        // Synchronous response (Lovable AI or mock)
        toast({
          title: '✅ Enrichissement terminé',
          description: `${result.contacts_count || 0} contact(s) trouvé(s).`,
        });
      }
    } catch (error) {
      toast({
        title: 'Erreur',
        description: "Impossible d'enrichir ce signal.",
        variant: 'destructive',
      });
    }
  };

  const handleManualCheckStatus = async () => {
    if (!id) return;
    
    toast({
      title: '🔄 Vérification du statut...',
      description: 'Interrogation de Manus en cours.',
    });
    
    await checkStatus();
  };

  const handleContactStatusChange = async (contactId: string, newStatus: string) => {
    try {
      await updateContactStatus.mutateAsync({ contactId, status: newStatus });
      toast({
        title: 'Statut mis à jour',
        description: 'Le statut du contact a été modifié.',
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
      <div className="text-center py-16">
        <p className="text-muted-foreground">Signal non trouvé</p>
        <Link to="/signals">
          <Button variant="link" className="mt-4">
            Retour aux signaux
          </Button>
        </Link>
      </div>
    );
  }

  const contacts = enrichmentData?.contacts || [];
  const hasContacts = contacts.length > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back Button */}
      <Link to="/signals">
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux signaux
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {/* Company Logo */}
          <div className="relative group flex-shrink-0">
            {fetchLogo.isPending || isLogoPolling ? (
              <div className="h-16 w-16 rounded-lg border border-border flex flex-col items-center justify-center bg-background gap-1">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                {isLogoPolling && <span className="text-[8px] text-muted-foreground">Manus</span>}
              </div>
            ) : (signal as any).company_logo_url ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="h-16 w-16 rounded-lg border border-border overflow-hidden bg-background cursor-pointer relative">
                    <img src={(signal as any).company_logo_url} alt={signal.company_name} className="h-full w-full object-contain" />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-background/80 flex items-center justify-center transition-opacity">
                      <RefreshCw className="h-4 w-4" />
                    </div>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Récupérer le logo</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => fetchLogo.mutate({ signalId: id!, companyName: signal.company_name, sourceUrl: signal.source_url || undefined, forceRetry: true })}>
                    <Search className="h-4 w-4 mr-2" />
                    Réessayer (auto)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => fetchLogo.mutate({ signalId: id!, companyName: signal.company_name, sourceUrl: signal.source_url || undefined, forceRetry: true, forceAI: true })}>
                    <Bot className="h-4 w-4 mr-2" />
                    Forcer recherche IA
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={(e) => {
                    e.preventDefault();
                    setManualDomain(enrichmentData?.enrichment?.domain || '');
                    setDomainPopoverOpen(true);
                  }}>
                    <PenLine className="h-4 w-4 mr-2" />
                    Saisir le domaine
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-16 w-16 flex-col gap-1">
                    <Image className="h-5 w-5" />
                    <span className="text-[10px]">Logo</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Récupérer le logo</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => fetchLogo.mutate({ signalId: id!, companyName: signal.company_name, sourceUrl: signal.source_url || undefined })}>
                    <Search className="h-4 w-4 mr-2" />
                    Réessayer (auto)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => fetchLogo.mutate({ signalId: id!, companyName: signal.company_name, sourceUrl: signal.source_url || undefined, forceAI: true })}>
                    <Bot className="h-4 w-4 mr-2" />
                    Forcer recherche IA
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={(e) => {
                    e.preventDefault();
                    setManualDomain(enrichmentData?.enrichment?.domain || '');
                    setDomainPopoverOpen(true);
                  }}>
                    <PenLine className="h-4 w-4 mr-2" />
                    Saisir le domaine
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Manual domain popover */}
            <Popover open={domainPopoverOpen} onOpenChange={setDomainPopoverOpen}>
              <PopoverTrigger asChild>
                <span className="hidden" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-3">
                <p className="text-sm font-medium mb-2">Domaine de l'entreprise</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="exemple.com"
                    value={manualDomain}
                    onChange={(e) => setManualDomain(e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={!manualDomain.trim()}
                    onClick={() => {
                      fetchLogo.mutate({ signalId: id!, companyName: signal.company_name, manualDomain: manualDomain.trim() });
                      setDomainPopoverOpen(false);
                    }}
                  >
                    OK
                  </Button>
                </div>
                {enrichmentData?.enrichment?.domain && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Domaine en base : <span className="font-mono">{enrichmentData.enrichment.domain}</span>
                  </p>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <ScoreStars score={signal.score} size="lg" />
              <StatusBadge status={signal.status} />
            </div>
            <h1 className="text-3xl font-bold text-foreground">{signal.company_name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-muted-foreground">
                Détecté {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
              </p>
              {enrichmentData?.enrichment?.website && (
                <a
                  href={enrichmentData.enrichment.website.startsWith('http') ? enrichmentData.enrichment.website : `https://${enrichmentData.enrichment.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {enrichmentData.enrichment.domain || enrichmentData.enrichment.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
            </div>
          </div>
        </div>
        <Button
          onClick={() => setGiftDialogOpen(true)}
          variant="outline"
          className="flex-shrink-0"
        >
          <Gift className="h-4 w-4 mr-2" />
          Cadeau personnalisé
        </Button>
      </div>

      {/* Gift Template Selector */}
      <GiftTemplateSelector
        signalId={id!}
        companyName={signal.company_name}
        hasLogo={!!(signal as any).company_logo_url}
        open={giftDialogOpen}
        onOpenChange={setGiftDialogOpen}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signal Info */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="font-semibold text-foreground mb-4">Informations</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Type de signal</p>
                <div className="mt-1">
                  <SignalTypeBadge type={signal.signal_type} />
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Secteur</p>
                <p className="font-medium mt-1">{signal.sector || 'Non spécifié'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Taille estimée</p>
                <p className="font-medium mt-1">{signal.estimated_size}</p>
              </div>
              {/* Revenue */}
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Euro className="h-3.5 w-3.5" />
                  Chiffre d'affaires
                </p>
                {signal.revenue && signal.revenue > 0 ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-semibold text-emerald-600">{formatRevenue(signal.revenue)}</span>
                    {signal.revenue_source && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">
                        {signal.revenue_source === 'perplexity' ? 'Perplexity AI' : 
                         signal.revenue_source === 'estimated' ? 'Estimé' :
                         signal.revenue_source === 'pappers' ? 'Pappers' : signal.revenue_source}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="font-medium mt-1 text-muted-foreground">Non disponible</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date de l'article</p>
                <p className="font-medium mt-1">
                  {(signal as any).article_published_at 
                    ? format(new Date((signal as any).article_published_at), 'dd MMMM yyyy', { locale: fr })
                    : 'Non disponible'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date de détection</p>
                <p className="font-medium mt-1">
                  {format(new Date(signal.detected_at), 'dd MMMM yyyy à HH:mm', { locale: fr })}
                </p>
              </div>
            </div>
          </div>

          {/* Event Detail */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="font-semibold text-foreground mb-4">Événement</h2>
            <p className="text-foreground">{signal.event_detail || 'Pas de détails disponibles'}</p>
            
            {signal.source_url && (
              <a
                href={signal.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-4 text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Voir l'article source ({signal.source_name || 'Source'})
              </a>
            )}
          </div>


          {/* Enrichment Section */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10">
                  <Users className="h-5 w-5 text-violet-500" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">Contacts décideurs</h2>
                  <p className="text-sm text-muted-foreground">
                    {isManusProcessing 
                      ? 'Manus analyse l\'entreprise...'
                      : hasContacts 
                        ? `${contacts.length} contact${contacts.length > 1 ? 's' : ''} trouvé${contacts.length > 1 ? 's' : ''}`
                        : 'Enrichissez ce signal pour trouver les décideurs'}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2">
                {isManusProcessing && (
                  <Button
                    variant="outline"
                    onClick={handleManualCheckStatus}
                    disabled={checkManusStatus.isPending}
                  >
                    {checkManusStatus.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                )}

                {/* Resync button: visible when completed but 0 contacts and has manus task */}
                {enrichmentStatus === 'completed' && !hasContacts && manusTaskId && (
                  <Button
                    variant="outline"
                    onClick={() => checkStatus(true)}
                    disabled={checkManusStatus.isPending}
                    className="text-orange-600 border-orange-300 hover:bg-orange-50"
                  >
                    {checkManusStatus.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Resync...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Forcer la resync Manus
                      </>
                    )}
                  </Button>
                )}
                
                {enrichmentStatus !== 'completed' && !isManusProcessing && (
                  <Button
                    onClick={handleTriggerEnrichment}
                    disabled={triggerEnrichment.isPending || enrichmentStatus === 'processing'}
                    className="bg-violet-600 hover:bg-violet-700"
                  >
                    {triggerEnrichment.isPending || enrichmentStatus === 'processing' ? (
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

            {/* Manus Processing State */}
            {isManusProcessing && (
              <div className="mb-4 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Loader2 className="h-6 w-6 text-violet-500 animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground">Manus recherche les décideurs...</p>
                    <p className="text-sm text-muted-foreground">
                      Cette opération peut prendre quelques minutes. Vous serez notifié automatiquement.
                    </p>
                  </div>
                </div>
                {manusTaskUrl && (
                  <a
                    href={manusTaskUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 mt-3 text-sm text-violet-500 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Voir la progression sur Manus
                  </a>
                )}
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
                      eventDetail: signal.event_detail || undefined,
                      signalId: id,
                      companyLogoUrl: (signal as any).company_logo_url,
                    }}
                    onStatusChange={handleContactStatusChange}
                  />
                ))}
              </div>
            ) : enrichmentStatus === 'completed' ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Aucun contact trouvé pour cette entreprise.</p>
              </div>
            ) : !isManusProcessing ? (
              <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Cliquez sur "Enrichir avec Manus" pour trouver les décideurs de cette entreprise.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions Sidebar */}
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="font-semibold text-foreground mb-4">Actions</h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Statut</label>
                <Select
                  value={currentStatus}
                  onValueChange={(v) => setStatus(v as SignalStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {signal.contacted_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Premier contact</p>
                  <p className="font-medium mt-1">
                    {format(new Date(signal.contacted_at), 'dd/MM/yyyy', { locale: fr })}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Notes</label>
                <Textarea
                  placeholder="Ajoutez vos notes sur ce prospect..."
                  value={currentNotes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>

              <Button
                onClick={handleSave}
                disabled={updateSignal.isPending}
                className="w-full"
              >
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
