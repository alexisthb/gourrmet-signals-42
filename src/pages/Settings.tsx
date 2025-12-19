import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Key, Eye, EyeOff, RefreshCw, Plus, Check, AlertCircle, Search as SearchIcon, Zap } from 'lucide-react';
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
import { QueryCategorySection, QueryCoverage, CATEGORY_CONFIG } from '@/components/QueryCategorySection';
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
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTriggerEnrichment } from '@/hooks/useEnrichment';

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: queries, isLoading: queriesLoading } = useSearchQueries();
  const { data: scanLogs } = useScanLogs();
  
  const updateSetting = useUpdateSetting();
  const toggleQuery = useToggleSearchQuery();
  const addQuery = useAddSearchQuery();
  const deleteQuery = useDeleteSearchQuery();
  const runScan = useRunScan();
  const triggerEnrichment = useTriggerEnrichment();

  const [showNewsApiKey, setShowNewsApiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [newsApiKey, setNewsApiKey] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [minScore, setMinScore] = useState('3');
  const [daysToFetch, setDaysToFetch] = useState('1');
  const [autoEnrichEnabled, setAutoEnrichEnabled] = useState(true);
  const [autoEnrichMinScore, setAutoEnrichMinScore] = useState('4');
  const [retroactiveDialogOpen, setRetroactiveDialogOpen] = useState(false);
  const [isEnrichingRetroactive, setIsEnrichingRetroactive] = useState(false);

  // New query dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newQueryName, setNewQueryName] = useState('');
  const [newQueryText, setNewQueryText] = useState('');
  const [newQueryDescription, setNewQueryDescription] = useState('');
  const [newQueryCategory, setNewQueryCategory] = useState<SignalType>('anniversaire');

  // Fetch eligible signals for retroactive enrichment
  const { data: eligibleSignals } = useQuery({
    queryKey: ['eligible-signals-for-enrichment', autoEnrichMinScore],
    queryFn: async () => {
      const minScoreNum = parseInt(autoEnrichMinScore, 10);
      const { data, error } = await supabase
        .from('signals')
        .select('id, company_name, score')
        .gte('score', minScoreNum)
        .or('enrichment_status.is.null,enrichment_status.eq.none');
      
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (settings) {
      setNewsApiKey(settings.newsapi_key || '');
      setClaudeApiKey(settings.claude_api_key || '');
      setMinScore(settings.min_score_display || '3');
      setDaysToFetch(settings.days_to_fetch || '1');
      setAutoEnrichEnabled(settings.auto_enrich_enabled !== 'false');
      setAutoEnrichMinScore(settings.auto_enrich_min_score || '4');
    }
  }, [settings]);

  // Group queries by category
  const groupedQueries = useMemo(() => {
    if (!queries) return {};
    const grouped: Record<string, typeof queries> = {};
    CATEGORY_CONFIG.forEach(cat => {
      grouped[cat.id] = queries
        .filter(q => q.category === cat.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    });
    return grouped;
  }, [queries]);

  const activeQueriesCount = queries?.filter(q => q.is_active).length || 0;
  const totalQueriesCount = queries?.length || 0;

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
        updateSetting.mutateAsync({ key: 'auto_enrich_enabled', value: autoEnrichEnabled ? 'true' : 'false' }),
        updateSetting.mutateAsync({ key: 'auto_enrich_min_score', value: autoEnrichMinScore }),
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
        description: 'Veuillez remplir le nom et la requête.',
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
        description: newQueryDescription || null,
      });
      setDialogOpen(false);
      setNewQueryName('');
      setNewQueryText('');
      setNewQueryDescription('');
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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <SearchIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Requêtes de recherche</h2>
              <p className="text-sm text-muted-foreground">
                {activeQueriesCount} requêtes actives sur {totalQueriesCount}
              </p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Ajouter
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
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
                    placeholder='Ex: ("levée de fonds" OR "lève") AND biotech'
                    rows={3}
                    className="font-mono text-sm"
                  />
                  <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-xs font-medium text-foreground mb-1">Exemples de syntaxe :</p>
                    <ul className="text-xs text-muted-foreground space-y-1 font-mono">
                      <li>• <code>("mot1" OR "mot2") AND "mot3"</code></li>
                      <li>• <code>"expression exacte" AND (terme1 OR terme2)</code></li>
                      <li>• <code>("startup" OR "entreprise") AND levée AND France</code></li>
                    </ul>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Description (optionnel)</label>
                  <Input
                    value={newQueryDescription}
                    onChange={(e) => setNewQueryDescription(e.target.value)}
                    placeholder="Ex: Détecte les levées de fonds dans le secteur biotech"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Décrit ce que la requête détecte
                  </p>
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

        {/* Coverage summary */}
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-2">Couverture par catégorie</p>
          <QueryCoverage queries={queries || []} />
        </div>

        {/* Grouped queries */}
        <div className="space-y-4">
          {CATEGORY_CONFIG.map((category) => (
            <QueryCategorySection
              key={category.id}
              category={category}
              queries={groupedQueries[category.id] || []}
              onToggle={(id, is_active) => toggleQuery.mutate({ id, is_active })}
              onDelete={(id) => deleteQuery.mutate(id)}
            />
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

        <div className="mt-6 p-4 rounded-lg bg-muted/50 border border-border space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Enrichissement automatique</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Déclenche automatiquement la recherche de contacts pour les signaux à haut score
              </p>
            </div>
            <Switch
              checked={autoEnrichEnabled}
              onCheckedChange={setAutoEnrichEnabled}
            />
          </div>
          
          {autoEnrichEnabled && (
            <div className="pt-3 border-t border-border space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Score minimum pour l'auto-enrichissement</label>
                <Select value={autoEnrichMinScore} onValueChange={setAutoEnrichMinScore}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Score ≥ 3</SelectItem>
                    <SelectItem value="4">Score ≥ 4 (recommandé)</SelectItem>
                    <SelectItem value="5">Score 5 uniquement</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Seuls les signaux avec ce score ou plus seront enrichis automatiquement
                </p>
              </div>

              {/* Retroactive enrichment */}
              {eligibleSignals && eligibleSignals.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        {eligibleSignals.length} signal{eligibleSignals.length > 1 ? 'x' : ''} non enrichi{eligibleSignals.length > 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Ces signaux existants correspondent au nouveau seuil mais n'ont pas encore été enrichis.
                      </p>
                    </div>
                    <AlertDialog open={retroactiveDialogOpen} onOpenChange={setRetroactiveDialogOpen}>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40">
                          <Zap className="h-4 w-4 mr-1" />
                          Enrichir
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Enrichissement rétroactif</AlertDialogTitle>
                          <AlertDialogDescription asChild>
                            <div className="space-y-3">
                              <p>
                                Vous êtes sur le point de lancer l'enrichissement pour <strong>{eligibleSignals.length} signal{eligibleSignals.length > 1 ? 'x' : ''}</strong> existant{eligibleSignals.length > 1 ? 's' : ''}.
                              </p>
                              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
                                  <AlertCircle className="h-4 w-4" />
                                  Estimation du coût
                                </p>
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                  Chaque enrichissement utilise des crédits Manus API. Pour {eligibleSignals.length} signaux, le coût estimé est d'environ <strong>{eligibleSignals.length * 0.10}€ - {eligibleSignals.length * 0.25}€</strong> (0.10€ - 0.25€ par signal).
                                </p>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Cette opération ne peut pas être annulée. Voulez-vous continuer ?
                              </p>
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              setIsEnrichingRetroactive(true);
                              let successCount = 0;
                              let errorCount = 0;
                              
                              for (const signal of eligibleSignals) {
                                try {
                                  await triggerEnrichment.mutateAsync(signal.id);
                                  successCount++;
                                } catch (error) {
                                  console.error(`Failed to enrich signal ${signal.id}:`, error);
                                  errorCount++;
                                }
                              }
                              
                              setIsEnrichingRetroactive(false);
                              setRetroactiveDialogOpen(false);
                              
                              // Refresh data
                              queryClient.invalidateQueries({ queryKey: ['eligible-signals-for-enrichment'] });
                              queryClient.invalidateQueries({ queryKey: ['signals'] });
                              
                              toast({
                                title: 'Enrichissement lancé',
                                description: `${successCount} enrichissement${successCount > 1 ? 's' : ''} démarré${successCount > 1 ? 's' : ''}${errorCount > 0 ? `, ${errorCount} erreur${errorCount > 1 ? 's' : ''}` : ''}.`,
                              });
                            }}
                            disabled={isEnrichingRetroactive}
                          >
                            {isEnrichingRetroactive ? (
                              <>
                                <LoadingSpinner size="sm" className="mr-2" />
                                En cours...
                              </>
                            ) : (
                              `Enrichir ${eligibleSignals.length} signal${eligibleSignals.length > 1 ? 's' : ''}`
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <Button onClick={handleSaveSettings} disabled={updateSetting.isPending} className="mt-4">
          Sauvegarder les paramètres
        </Button>
      </div>

      {/* Scan */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Scan automatique</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Le scan automatique peut être configuré via un cron job pour s'exécuter quotidiennement.
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

      {/* Manus Enrichment */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <span className="text-xl">🔍</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Enrichissement Manus</h2>
            <p className="text-sm text-muted-foreground">
              Enrichissez automatiquement vos signaux avec des données entreprise et contacts.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <h3 className="font-medium mb-2">Comment ça marche ?</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Depuis la page d'un signal, cliquez sur "Enrichir avec Manus"</li>
              <li>• L'API Manus recherche automatiquement l'entreprise et ses décideurs</li>
              <li>• Les contacts trouvés sont ajoutés avec leurs coordonnées et scores de priorité</li>
              <li>• Suivez vos actions de prospection directement depuis l'interface</li>
            </ul>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <p className="text-2xl font-bold text-emerald-600">👥</p>
              <p className="text-sm text-muted-foreground mt-1">Contacts enrichis</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-2xl font-bold text-blue-600">📧</p>
              <p className="text-sm text-muted-foreground mt-1">Emails vérifiés</p>
            </div>
            <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
              <p className="text-2xl font-bold text-violet-600">🎯</p>
              <p className="text-sm text-muted-foreground mt-1">Cibles prioritaires</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            L'enrichissement utilise l'API Manus pour identifier les décideurs clés au sein des entreprises détectées.
          </p>
        </div>
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
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: fr })}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        log.status === 'completed' 
                          ? 'bg-success/10 text-success' 
                          : log.status === 'running'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-destructive/10 text-destructive'
                      }`}>
                        {log.status === 'completed' ? 'Terminé' : log.status === 'running' ? 'En cours' : 'Erreur'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">{log.articles_fetched}</td>
                    <td className="py-2 px-3 text-right">{log.articles_analyzed}</td>
                    <td className="py-2 px-3 text-right font-medium">{log.signals_created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucun scan enregistré.</p>
        )}
      </div>
    </div>
  );
}
