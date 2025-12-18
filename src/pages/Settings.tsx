import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Key, Eye, EyeOff, RefreshCw, Plus, Trash2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { LoadingSpinner, LoadingPage } from '@/components/LoadingSpinner';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import {
  useSettings,
  useUpdateSetting,
  useSearchQueries,
  useToggleSearchQuery,
  useAddSearchQuery,
  useDeleteSearchQuery,
  useScanLogs,
  useRunScan,
} from '@/hooks/useSettings';
import { useToast } from '@/hooks/use-toast';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';

export default function Settings() {
  const { toast } = useToast();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: queries, isLoading: queriesLoading } = useSearchQueries();
  const { data: scanLogs } = useScanLogs();
  
  const updateSetting = useUpdateSetting();
  const toggleQuery = useToggleSearchQuery();
  const addQuery = useAddSearchQuery();
  const deleteQuery = useDeleteSearchQuery();
  const runScan = useRunScan();

  const [showNewsApiKey, setShowNewsApiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [newsApiKey, setNewsApiKey] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [minScore, setMinScore] = useState('3');
  const [daysToFetch, setDaysToFetch] = useState('1');

  // New query dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newQueryName, setNewQueryName] = useState('');
  const [newQueryText, setNewQueryText] = useState('');
  const [newQueryCategory, setNewQueryCategory] = useState<SignalType>('anniversaire');

  useEffect(() => {
    if (settings) {
      setNewsApiKey(settings.newsapi_key || '');
      setClaudeApiKey(settings.claude_api_key || '');
      setMinScore(settings.min_score_display || '3');
      setDaysToFetch(settings.days_to_fetch || '1');
    }
  }, [settings]);

  const handleSaveApiKeys = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'newsapi_key', value: newsApiKey }),
        updateSetting.mutateAsync({ key: 'claude_api_key', value: claudeApiKey }),
      ]);
      toast({
        title: 'Clés API sauvegardées',
        description: 'Les clés ont été mises à jour avec succès.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder les clés.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveSettings = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'min_score_display', value: minScore }),
        updateSetting.mutateAsync({ key: 'days_to_fetch', value: daysToFetch }),
      ]);
      toast({
        title: 'Paramètres sauvegardés',
        description: 'Les paramètres ont été mis à jour.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder les paramètres.',
        variant: 'destructive',
      });
    }
  };

  const handleAddQuery = async () => {
    if (!newQueryName || !newQueryText) {
      toast({
        title: 'Champs requis',
        description: 'Veuillez remplir tous les champs.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await addQuery.mutateAsync({
        name: newQueryName,
        query: newQueryText,
        category: newQueryCategory,
        is_active: true,
      });
      setDialogOpen(false);
      setNewQueryName('');
      setNewQueryText('');
      setNewQueryCategory('anniversaire');
      toast({
        title: 'Requête ajoutée',
        description: 'La nouvelle requête a été créée.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter la requête.',
        variant: 'destructive',
      });
    }
  };

  const handleRunScan = async () => {
    toast({
      title: 'Scan en cours...',
      description: 'Récupération et analyse des actualités.',
    });

    try {
      const result = await runScan.mutateAsync();
      toast({
        title: 'Scan terminé',
        description: `${result.fetch?.new_articles_saved || 0} articles, ${result.analyze?.signals_created || 0} signaux.`,
      });
    } catch (error) {
      toast({
        title: 'Erreur lors du scan',
        description: error instanceof Error ? error.message : 'Une erreur est survenue',
        variant: 'destructive',
      });
    }
  };

  if (settingsLoading || queriesLoading) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Configuration</h1>
        <p className="page-subtitle">Paramétrez les clés API et les requêtes de recherche</p>
      </div>

      {/* API Keys */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <Key className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Clés API</h2>
        </div>

        <div className="space-y-4">
          {/* NewsAPI Key */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Clé API NewsAPI
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showNewsApiKey ? 'text' : 'password'}
                  value={newsApiKey}
                  onChange={(e) => setNewsApiKey(e.target.value)}
                  placeholder="Entrez votre clé NewsAPI..."
                />
                <button
                  type="button"
                  onClick={() => setShowNewsApiKey(!showNewsApiKey)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewsApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className={`flex items-center gap-1 px-3 rounded-md border ${newsApiKey ? 'bg-success/10 border-success/30 text-success' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                {newsApiKey ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <span className="text-xs font-medium">{newsApiKey ? 'OK' : 'Non configurée'}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Obtenez votre clé gratuite sur{' '}
              <a href="https://newsapi.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                newsapi.org
              </a>
            </p>
          </div>

          {/* Claude API Key */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Clé API Claude (Anthropic)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showClaudeKey ? 'text' : 'password'}
                  value={claudeApiKey}
                  onChange={(e) => setClaudeApiKey(e.target.value)}
                  placeholder="Entrez votre clé Claude..."
                />
                <button
                  type="button"
                  onClick={() => setShowClaudeKey(!showClaudeKey)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showClaudeKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className={`flex items-center gap-1 px-3 rounded-md border ${claudeApiKey ? 'bg-success/10 border-success/30 text-success' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                {claudeApiKey ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <span className="text-xs font-medium">{claudeApiKey ? 'OK' : 'Non configurée'}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Nécessaire pour l'analyse des articles via l'API Anthropic.
            </p>
          </div>

          <Button onClick={handleSaveApiKeys} disabled={updateSetting.isPending}>
            Sauvegarder les clés
          </Button>
        </div>
      </div>

      {/* Search Queries */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Requêtes de recherche</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Ajouter
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle requête</DialogTitle>
                <DialogDescription>
                  Créez une requête de recherche pour NewsAPI.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Nom</label>
                  <Input
                    value={newQueryName}
                    onChange={(e) => setNewQueryName(e.target.value)}
                    placeholder="Ex: Levées biotech"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Requête NewsAPI</label>
                  <Textarea
                    value={newQueryText}
                    onChange={(e) => setNewQueryText(e.target.value)}
                    placeholder='Ex: levée AND biotech AND france'
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Catégorie</label>
                  <Select value={newQueryCategory} onValueChange={(v) => setNewQueryCategory(v as SignalType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SIGNAL_TYPE_CONFIG).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          {config.emoji} {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button onClick={handleAddQuery} disabled={addQuery.isPending}>
                  Ajouter
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-3">
          {queries?.map((query) => (
            <div
              key={query.id}
              className="flex items-center gap-4 p-4 rounded-lg border border-border bg-background"
            >
              <Switch
                checked={query.is_active}
                onCheckedChange={(checked) =>
                  toggleQuery.mutate({ id: query.id, is_active: checked })
                }
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground truncate">{query.name}</p>
                  <SignalTypeBadge type={query.category} showEmoji={false} />
                </div>
                <p className="text-xs text-muted-foreground truncate mt-1">{query.query}</p>
                {query.last_fetched_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Dernier fetch: {formatDistanceToNow(new Date(query.last_fetched_at), { addSuffix: true, locale: fr })}
                  </p>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer la requête ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action est irréversible. La requête "{query.name}" sera définitivement supprimée.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteQuery.mutate(query.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      </div>

      {/* General Settings */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-6">Paramètres généraux</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Score minimum à afficher</label>
            <Select value={minScore} onValueChange={setMinScore}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 - Tous</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3 (recommandé)</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5 - Prioritaires uniquement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Jours d'historique</label>
            <Select value={daysToFetch} onValueChange={setDaysToFetch}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 jour</SelectItem>
                <SelectItem value="3">3 jours</SelectItem>
                <SelectItem value="7">7 jours</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              NewsAPI gratuit limite à 100 requêtes/jour.
            </p>
          </div>
        </div>

        <Button onClick={handleSaveSettings} disabled={updateSetting.isPending} className="mt-4">
          Sauvegarder les paramètres
        </Button>
      </div>

      {/* Scan */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Scan automatique</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Le scan automatique peut être configuré via un cron job Supabase pour s'exécuter quotidiennement.
        </p>
        <Button onClick={handleRunScan} disabled={runScan.isPending}>
          {runScan.isPending ? (
            <>
              <LoadingSpinner size="sm" className="mr-2" />
              Scan en cours...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Lancer un scan maintenant
            </>
          )}
        </Button>
      </div>

      {/* Scan Logs */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Historique des scans</h2>
        
        {scanLogs && scanLogs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Statut</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Articles</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Analysés</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Signaux</th>
                </tr>
              </thead>
              <tbody>
                {scanLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0">
                    <td className="py-2 px-3">
                      {formatDistanceToNow(new Date(log.started_at), { addSuffix: true, locale: fr })}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        log.status === 'completed' ? 'bg-success/10 text-success' :
                        log.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                        'bg-warning/10 text-warning'
                      }`}>
                        {log.status === 'completed' ? 'Terminé' : 
                         log.status === 'failed' ? 'Échoué' : 'En cours'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">{log.articles_fetched}</td>
                    <td className="py-2 px-3 text-right">{log.articles_analyzed}</td>
                    <td className="py-2 px-3 text-right font-medium text-success">{log.signals_created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucun scan effectué</p>
        )}
      </div>
    </div>
  );
}
