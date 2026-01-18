import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  RefreshCw,
  Trash2,
  Download,
  BookOpen,
  Sparkles,
  Eye,
  EyeOff,
  MessageSquare,
  AlertCircle,
  Check,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  useTonalCharter,
  useMessageFeedback,
  useToggleLearning,
  useUpdateCharter,
  useResetCharter,
} from '@/hooks/useTonalCharter';
import { cn } from '@/lib/utils';

export function TonalCharterTab() {
  const { data: charter, isLoading } = useTonalCharter();
  const { data: recentFeedback } = useMessageFeedback(10);
  const toggleLearning = useToggleLearning();
  const updateCharter = useUpdateCharter();
  const resetCharter = useResetCharter();

  const [showFeedback, setShowFeedback] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const charterData = charter?.charter_data || {};
  const confidencePercent = Math.round((charter?.confidence_score || 0) * 100);
  const correctionsCount = charter?.corrections_count || 0;

  const getConfidenceColor = () => {
    if (confidencePercent >= 70) return 'text-emerald-500';
    if (confidencePercent >= 40) return 'text-amber-500';
    return 'text-red-500';
  };

  const getConfidenceLabel = () => {
    if (confidencePercent >= 70) return 'Élevée';
    if (confidencePercent >= 40) return 'Moyenne';
    if (confidencePercent > 0) return 'Faible';
    return 'Non établie';
  };

  const handleExport = () => {
    const exportData = {
      charter: charterData,
      corrections_count: correctionsCount,
      confidence_score: charter?.confidence_score,
      last_analysis: charter?.last_analysis_at,
      exported_at: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `charte-tonale-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header with toggle */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                <Sparkles className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Apprentissage du Style</CardTitle>
                <CardDescription>
                  Le système apprend de vos corrections pour améliorer les messages générés
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {charter?.is_learning_enabled ? 'Activé' : 'Désactivé'}
              </span>
              <Switch
                checked={charter?.is_learning_enabled ?? true}
                onCheckedChange={(checked) => toggleLearning.mutate(checked)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted/50 text-center">
              <div className="text-3xl font-bold text-foreground">{correctionsCount}</div>
              <div className="text-sm text-muted-foreground">Corrections analysées</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50 text-center">
              <div className={cn('text-3xl font-bold', getConfidenceColor())}>
                {confidencePercent}%
              </div>
              <div className="text-sm text-muted-foreground">Confiance</div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50 text-center">
              <div className="text-3xl font-bold text-foreground">
                {charterData.patterns_detected || 0}
              </div>
              <div className="text-sm text-muted-foreground">Patterns détectés</div>
            </div>
          </div>

          {/* Confidence bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Niveau de confiance</span>
              <Badge variant="outline" className={getConfidenceColor()}>
                {getConfidenceLabel()}
              </Badge>
            </div>
            <Progress value={confidencePercent} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {correctionsCount < 10 && 'Continuez à corriger les messages pour améliorer la précision'}
              {correctionsCount >= 10 && correctionsCount < 30 && 'Le système commence à comprendre votre style'}
              {correctionsCount >= 30 && 'Le système a une bonne compréhension de vos préférences'}
            </p>
          </div>

          {/* Last update */}
          {charter?.last_analysis_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              Dernière analyse :{' '}
              {formatDistanceToNow(new Date(charter.last_analysis_at), {
                addSuffix: true,
                locale: fr,
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateCharter.mutate()}
              disabled={updateCharter.isPending || correctionsCount === 0}
            >
              {updateCharter.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Rafraîchir la charte
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={correctionsCount === 0}>
              <Download className="h-4 w-4 mr-2" />
              Exporter
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Réinitialiser
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Réinitialiser la charte tonale ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cette action supprimera toutes les corrections enregistrées et réinitialisera la charte
                    aux valeurs par défaut. Cette action est irréversible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => resetCharter.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Réinitialiser
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Charter Summary */}
      {charterData.summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Résumé de votre style
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm italic text-muted-foreground">"{charterData.summary}"</p>
          </CardContent>
        </Card>
      )}

      {/* Charter Details */}
      {confidencePercent > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Détails de la charte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Formality */}
            {charterData.formality && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  Formalité
                </h4>
                <div className="pl-6 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{charterData.formality.level || 'Neutre'}</Badge>
                    {charterData.formality.tutoyment && (
                      <Badge variant="secondary">Tutoiement</Badge>
                    )}
                  </div>
                  {charterData.formality.observations?.map((obs, i) => (
                    <p key={i} className="text-xs text-muted-foreground">• {obs}</p>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Vocabulary */}
            {charterData.vocabulary && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Vocabulaire</h4>
                <div className="pl-6 space-y-2">
                  {charterData.vocabulary.forbidden_words?.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">Mots à éviter :</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {charterData.vocabulary.forbidden_words.map((word, i) => (
                          <Badge key={i} variant="destructive" className="text-xs">
                            {word}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {charterData.vocabulary.preferred_words?.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">Mots préférés :</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {charterData.vocabulary.preferred_words.map((word, i) => (
                          <Badge key={i} variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600">
                            {word}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Tone */}
            {charterData.tone && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Ton</h4>
                <div className="pl-6 flex flex-wrap gap-2">
                  <Badge variant="outline">{charterData.tone.style || 'Professionnel'}</Badge>
                  {charterData.tone.humor_allowed && (
                    <Badge variant="secondary">Humour autorisé</Badge>
                  )}
                  {charterData.tone.energy_level && (
                    <Badge variant="outline">{charterData.tone.energy_level}</Badge>
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Signatures & Openings */}
            <div className="grid grid-cols-2 gap-4">
              {charterData.signatures?.preferred?.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2">Signatures préférées</h4>
                  {charterData.signatures.preferred.map((sig, i) => (
                    <p key={i} className="text-xs text-muted-foreground">• "{sig}"</p>
                  ))}
                </div>
              )}
              {charterData.openings?.preferred?.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2">Accroches préférées</h4>
                  {charterData.openings.preferred.map((op, i) => (
                    <p key={i} className="text-xs text-muted-foreground">• "{op}"</p>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Feedback */}
      <Collapsible open={showFeedback} onOpenChange={setShowFeedback}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {showFeedback ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  Corrections récentes ({recentFeedback?.length || 0})
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {showFeedback ? 'Masquer' : 'Afficher'}
                </span>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {recentFeedback && recentFeedback.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {recentFeedback.map((fb) => (
                    <div
                      key={fb.id}
                      className="p-3 rounded-lg border bg-muted/30 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {fb.message_type === 'inmail' ? 'LinkedIn' : 'Email'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(fb.created_at), {
                            addSuffix: true,
                            locale: fr,
                          })}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Original :</span>
                          <p className="line-clamp-3 mt-1">{fb.original_message}</p>
                        </div>
                        <div>
                          <span className="text-emerald-600">Corrigé :</span>
                          <p className="line-clamp-3 mt-1">{fb.edited_message}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mb-2" />
                  <p className="text-sm">Aucune correction enregistrée</p>
                  <p className="text-xs">
                    Modifiez les messages générés pour commencer l'apprentissage
                  </p>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
