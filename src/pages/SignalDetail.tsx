import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowLeft, ExternalLink, Lightbulb, Copy, Check, Save } from 'lucide-react';
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
import { LoadingPage } from '@/components/LoadingSpinner';
import { useSignal, useUpdateSignal } from '@/hooks/useSignals';
import { useToast } from '@/hooks/use-toast';
import { STATUS_CONFIG, type SignalStatus } from '@/types/database';

export default function SignalDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: signal, isLoading } = useSignal(id || '');
  const updateSignal = useUpdateSignal();

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
