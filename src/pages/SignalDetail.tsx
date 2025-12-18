import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowLeft, ExternalLink, Lightbulb, Copy, Check, Save, Users, Sparkles, Loader2 } from 'lucide-react';
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
import { useSignalEnrichment, useTriggerEnrichment, useUpdateContactStatus } from '@/hooks/useEnrichment';
import { useToast } from '@/hooks/use-toast';
import { STATUS_CONFIG, type SignalStatus } from '@/types/database';

export default function SignalDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: signal, isLoading } = useSignal(id || '');
  const updateSignal = useUpdateSignal();
  
  // Enrichment hooks
  const { data: enrichmentData, isLoading: enrichmentLoading, refetch: refetchEnrichment } = useSignalEnrichment(id || '');
  const triggerEnrichment = useTriggerEnrichment();
  const updateContactStatus = useUpdateContactStatus();

  const [status, setStatus] = useState<SignalStatus | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      title: 'Enrichissement en cours...',
      description: 'Recherche des contacts et informations entreprise.',
    });

    try {
      const result = await triggerEnrichment.mutateAsync(id);
      await refetchEnrichment();
      toast({
        title: 'Enrichissement terminé',
        description: `${result.contacts_count || 0} contact(s) trouvé(s).`,
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: "Impossible d'enrichir ce signal.",
        variant: 'destructive',
      });
    }
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

  const enrichmentStatus = signal.enrichment_status || 'none';
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

          {/* Hook Suggestion */}
          {signal.hook_suggestion && (
            <div className="bg-accent rounded-xl border border-primary/20 p-6">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Lightbulb className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h2 className="font-semibold text-foreground mb-2">Suggestion d'accroche</h2>
                  <p className="text-foreground italic">"{signal.hook_suggestion}"</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={handleCopyHook}
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copié
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copier
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                    {hasContacts 
                      ? `${contacts.length} contact${contacts.length > 1 ? 's' : ''} trouvé${contacts.length > 1 ? 's' : ''}`
                      : 'Enrichissez ce signal pour trouver les décideurs'}
                  </p>
                </div>
              </div>
              
              {enrichmentStatus !== 'completed' && (
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

            {enrichmentLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : hasContacts ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    onStatusChange={handleContactStatusChange}
                  />
                ))}
              </div>
            ) : enrichmentStatus === 'completed' ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Aucun contact trouvé pour cette entreprise.</p>
              </div>
            ) : (
              <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
                <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  Cliquez sur "Enrichir avec Manus" pour trouver les décideurs de cette entreprise.
                </p>
              </div>
            )}
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
