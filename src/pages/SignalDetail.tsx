import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowLeft, ExternalLink, Lightbulb, Copy, Check, Save, Users, Sparkles, Loader2, RefreshCw } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { STATUS_CONFIG, type SignalStatus } from '@/types/database';

export default function SignalDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: signal, isLoading, refetch: refetchSignal } = useSignal(id || '');
  const updateSignal = useUpdateSignal();

  // Enrichment hooks
  const { data: enrichmentData, isLoading: enrichmentLoading, refetch: refetchEnrichment } = useSignalEnrichment(id || '');
  const triggerEnrichment = useTriggerEnrichment();
  const updateContactStatus = useUpdateContactStatus();
  const checkManusStatus = useCheckManusStatus();

  const [status, setStatus] = useState<SignalStatus | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

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
    if (status !== null && status !== signal.status) {
      updates.status = status;
      if (['contacted', 'meeting', 'proposal', 'won', 'lost'].includes(status) && !signal.contacted_at) {
        updates.contacted_at = new Date().toISOString();
      }
    }
    if (notes !== null && notes !== signal.notes) {
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
        <div>
          <div className="flex items-center gap-3 mb-2">
            <ScoreStars score={signal.score} size="lg" />
            <StatusBadge status={signal.status} />
          </div>
          <h1 className="text-3xl font-bold text-foreground">{signal.company_name}</h1>
          <p className="text-muted-foreground mt-1">
            Détecté {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
          </p>
        </div>
      </div>

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
