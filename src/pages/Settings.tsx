import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Key, Eye, EyeOff, RefreshCw, Plus, Check, AlertCircle, Search as SearchIcon, 
  Zap, MapPin, Star, ArrowUp, ArrowDown, X, Save, AlertTriangle, Settings2,
  Cpu, Newspaper, FileSearch, Users, Linkedin
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useQuery } from '@tanstack/react-query';
import { useTriggerEnrichment } from '@/hooks/useEnrichment';
import {
  useAllGeoZones,
  useUpdateGeoZonePriority,
  useToggleGeoZoneActive,
  useAddCityToZone,
  GeoZone,
} from '@/hooks/useGeoZones';
import { useManusPlanSettings, useManusCreditsSummary } from '@/hooks/useManusCredits';
import { useApifyPlanSettings, useApifyCreditsSummary } from '@/hooks/useApifyCredits';
import { usePappersPlanSettings, usePappersCreditsSummary } from '@/hooks/usePappersCredits';
import { cn } from '@/lib/utils';

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

  // Geo zones hooks
  const { data: zones = [], isLoading: zonesLoading } = useAllGeoZones();
  const updatePriority = useUpdateGeoZonePriority();
  const toggleActive = useToggleGeoZoneActive();
  const addCity = useAddCityToZone();
  const [newCity, setNewCity] = useState<{ zoneId: string; value: string } | null>(null);

  // API Credits hooks
  const { data: manusPlan, isLoading: manusLoading } = useManusPlanSettings();
  const manusCredits = useManusCreditsSummary();
  const { data: apifyPlan, isLoading: apifyLoading } = useApifyPlanSettings();
  const apifyCredits = useApifyCreditsSummary();
  const { data: pappersPlan, isLoading: pappersLoading } = usePappersPlanSettings();
  const pappersCredits = usePappersCreditsSummary();

  // API Keys state
  const [showNewsApiKey, setShowNewsApiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [showManusKey, setShowManusKey] = useState(false);
  const [showApifyKey, setShowApifyKey] = useState(false);
  const [showPappersKey, setShowPappersKey] = useState(false);
  const [newsApiKey, setNewsApiKey] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [manusApiKey, setManusApiKey] = useState('');
  const [apifyApiKey, setApifyApiKey] = useState('');
  const [pappersApiKey, setPappersApiKey] = useState('');

  // Plan settings state
  const [manusPlanName, setManusPlanName] = useState('');
  const [manusMonthlyCredits, setManusMonthlyCredits] = useState(0);
  const [manusThreshold, setManusThreshold] = useState(80);
  const [manusCostPerEnrichment, setManusCostPerEnrichment] = useState(1);
  const [apifyPlanName, setApifyPlanName] = useState('');
  const [apifyMonthlyCredits, setApifyMonthlyCredits] = useState(0);
  const [apifyThreshold, setApifyThreshold] = useState(80);
  const [apifyCostPerScrape, setApifyCostPerScrape] = useState(0.5);
  const [pappersPlanName, setPappersPlanName] = useState('');
  const [pappersMonthlyCredits, setPappersMonthlyCredits] = useState(0);
  const [pappersThreshold, setPappersThreshold] = useState(80);
  const [pappersRateLimit, setPappersRateLimit] = useState(2);

  // Employee filters state
  const [minEmployeesPresse, setMinEmployeesPresse] = useState(20);
  const [minEmployeesPappers, setMinEmployeesPappers] = useState(20);
  const [minEmployeesLinkedin, setMinEmployeesLinkedin] = useState(20);

  // General settings state
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

  // Initialize settings from DB
  useEffect(() => {
    if (settings) {
      setNewsApiKey(settings.newsapi_key || '');
      setClaudeApiKey(settings.claude_api_key || '');
      setManusApiKey(settings.manus_api_key || '');
      setApifyApiKey(settings.apify_api_key || '');
      setPappersApiKey(settings.pappers_api_key || '');
      setMinScore(settings.min_score_display || '3');
      setDaysToFetch(settings.days_to_fetch || '1');
      setAutoEnrichEnabled(settings.auto_enrich_enabled !== 'false');
      setAutoEnrichMinScore(settings.auto_enrich_min_score || '4');
      setMinEmployeesPresse(parseInt(settings.min_employees_presse) || 20);
      setMinEmployeesPappers(parseInt(settings.min_employees_pappers) || 20);
      setMinEmployeesLinkedin(parseInt(settings.min_employees_linkedin) || 20);
    }
  }, [settings]);

  // Initialize plan settings from DB
  useEffect(() => {
    if (manusPlan) {
      setManusPlanName(manusPlan.plan_name);
      setManusMonthlyCredits(manusPlan.monthly_credits);
      setManusThreshold(manusPlan.alert_threshold_percent);
      setManusCostPerEnrichment(manusPlan.cost_per_enrichment);
    }
  }, [manusPlan]);

  useEffect(() => {
    if (apifyPlan) {
      setApifyPlanName(apifyPlan.plan_name);
      setApifyMonthlyCredits(apifyPlan.monthly_credits);
      setApifyThreshold(apifyPlan.alert_threshold_percent);
      setApifyCostPerScrape(apifyPlan.cost_per_scrape);
    }
  }, [apifyPlan]);

  useEffect(() => {
    if (pappersPlan) {
      setPappersPlanName(pappersPlan.plan_name);
      setPappersMonthlyCredits(pappersPlan.monthly_credits);
      setPappersThreshold(pappersPlan.alert_threshold_percent);
      setPappersRateLimit(pappersPlan.rate_limit_per_second);
    }
  }, [pappersPlan]);

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

  // Geo zones data
  const priorityZones = zones.filter(z => z.priority !== null && z.priority < 99 && z.slug !== 'unknown');
  const otherZones = zones.filter(z => z.priority === null || (z.priority >= 99 && z.slug !== 'unknown'));
  const unknownZone = zones.find(z => z.slug === 'unknown');

  // === Handlers ===
  const handleSaveApiKeys = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'newsapi_key', value: newsApiKey }),
        updateSetting.mutateAsync({ key: 'claude_api_key', value: claudeApiKey }),
        updateSetting.mutateAsync({ key: 'manus_api_key', value: manusApiKey }),
        updateSetting.mutateAsync({ key: 'apify_api_key', value: apifyApiKey }),
        updateSetting.mutateAsync({ key: 'pappers_api_key', value: pappersApiKey }),
      ]);
      toast({ title: 'Clés API sauvegardées' });
    } catch (error) {
      toast({ title: 'Erreur', description: 'Impossible de sauvegarder.', variant: 'destructive' });
    }
  };

  const handleSaveManus = async () => {
    try {
      const { error } = await supabase
        .from('manus_plan_settings')
        .upsert({
          id: manusPlan?.id || crypto.randomUUID(),
          plan_name: manusPlanName || 'Standard',
          monthly_credits: manusMonthlyCredits || 1000,
          alert_threshold_percent: manusThreshold,
          cost_per_enrichment: manusCostPerEnrichment,
        });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['manus-plan-settings'] });
      toast({ title: 'Forfait Manus sauvegardé' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSaveApify = async () => {
    try {
      const { error } = await supabase
        .from('apify_plan_settings')
        .upsert({
          id: apifyPlan?.id || crypto.randomUUID(),
          plan_name: apifyPlanName || 'Starter',
          monthly_credits: apifyMonthlyCredits || 5000,
          alert_threshold_percent: apifyThreshold,
          cost_per_scrape: apifyCostPerScrape,
        });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['apify-plan-settings'] });
      toast({ title: 'Forfait Apify sauvegardé' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSavePappers = async () => {
    try {
      const { error } = await supabase
        .from('pappers_plan_settings')
        .upsert({
          id: pappersPlan?.id || crypto.randomUUID(),
          plan_name: pappersPlanName || 'Standard',
          monthly_credits: pappersMonthlyCredits || 10000,
          alert_threshold_percent: pappersThreshold,
          rate_limit_per_second: pappersRateLimit,
        });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['pappers-plan-settings'] });
      toast({ title: 'Forfait Pappers sauvegardé' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSaveFilters = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'min_employees_presse', value: String(minEmployeesPresse) }),
        updateSetting.mutateAsync({ key: 'min_employees_pappers', value: String(minEmployeesPappers) }),
        updateSetting.mutateAsync({ key: 'min_employees_linkedin', value: String(minEmployeesLinkedin) }),
        updateSetting.mutateAsync({ key: 'min_score_display', value: minScore }),
        updateSetting.mutateAsync({ key: 'days_to_fetch', value: daysToFetch }),
        updateSetting.mutateAsync({ key: 'auto_enrich_enabled', value: autoEnrichEnabled ? 'true' : 'false' }),
        updateSetting.mutateAsync({ key: 'auto_enrich_min_score', value: autoEnrichMinScore }),
      ]);
      toast({ title: 'Paramètres sauvegardés' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSetPriority = async (zone: GeoZone, newPriority: number) => {
    try {
      await updatePriority.mutateAsync({ zoneId: zone.id, priority: newPriority });
      toast({ title: newPriority < 99 ? 'Zone prioritaire' : 'Zone standard' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleToggleActive = async (zone: GeoZone) => {
    try {
      await toggleActive.mutateAsync({ zoneId: zone.id, isActive: !zone.is_active });
      toast({ title: zone.is_active ? 'Zone désactivée' : 'Zone activée' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleAddCity = async () => {
    if (!newCity || !newCity.value.trim()) return;
    try {
      await addCity.mutateAsync({ zoneId: newCity.zoneId, city: newCity.value.trim() });
      toast({ title: 'Ville ajoutée' });
      setNewCity(null);
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleAddQuery = async () => {
    if (!newQueryName || !newQueryText) {
      toast({ title: 'Champs requis', variant: 'destructive' });
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
      toast({ title: 'Requête ajoutée' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleRunScan = async () => {
    toast({ title: 'Scan en cours...' });
    try {
      const result = await runScan.mutateAsync();
      toast({ title: 'Scan terminé', description: `${result.fetch?.new_articles_saved || 0} articles, ${result.analyze?.signals_created || 0} signaux.` });
    } catch (error) {
      toast({ title: 'Erreur', description: error instanceof Error ? error.message : 'Erreur', variant: 'destructive' });
    }
  };

  const getProgressColor = (percent: number, threshold: number) => {
    if (percent >= 100) return 'bg-destructive';
    if (percent >= threshold) return 'bg-destructive';
    if (percent >= threshold - 10) return 'bg-amber-500';
    return 'bg-primary';
  };

  if (settingsLoading || queriesLoading || zonesLoading) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Settings2 className="h-6 w-6 text-primary" />
          Configuration
        </h1>
        <p className="page-subtitle">Centralisez tous vos paramètres en un seul endroit</p>
      </div>

      <Tabs defaultValue="geo" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 h-auto p-1">
          <TabsTrigger value="geo" className="text-xs sm:text-sm py-2">
            <MapPin className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Zones Géo
          </TabsTrigger>
          <TabsTrigger value="queries" className="text-xs sm:text-sm py-2">
            <SearchIcon className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Requêtes
          </TabsTrigger>
          <TabsTrigger value="filters" className="text-xs sm:text-sm py-2">
            <Zap className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Filtres
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="text-xs sm:text-sm py-2">
            <Key className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Clés API
          </TabsTrigger>
          <TabsTrigger value="credits" className="text-xs sm:text-sm py-2">
            <Cpu className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Forfaits
          </TabsTrigger>
        </TabsList>

        {/* === TAB: API Keys === */}
        <TabsContent value="api-keys" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Clés d'authentification API
              </CardTitle>
              <CardDescription>
                Configurez vos clés pour accéder aux services externes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* NewsAPI */}
              <ApiKeyInput
                label="NewsAPI"
                value={newsApiKey}
                onChange={setNewsApiKey}
                show={showNewsApiKey}
                onToggleShow={() => setShowNewsApiKey(!showNewsApiKey)}
                placeholder="Clé NewsAPI..."
                helpUrl="https://newsapi.org"
                helpText="Collecte d'actualités"
              />
              {/* Claude */}
              <ApiKeyInput
                label="Claude (Anthropic)"
                value={claudeApiKey}
                onChange={setClaudeApiKey}
                show={showClaudeKey}
                onToggleShow={() => setShowClaudeKey(!showClaudeKey)}
                placeholder="sk-ant-..."
                helpText="Analyse IA des articles"
              />
              {/* Manus */}
              <ApiKeyInput
                label="Manus"
                value={manusApiKey}
                onChange={setManusApiKey}
                show={showManusKey}
                onToggleShow={() => setShowManusKey(!showManusKey)}
                placeholder="sk-..."
                helpUrl="https://manus.ai"
                helpText="Enrichissement contacts"
              />
              {/* Apify */}
              <ApiKeyInput
                label="Apify"
                value={apifyApiKey}
                onChange={setApifyApiKey}
                show={showApifyKey}
                onToggleShow={() => setShowApifyKey(!showApifyKey)}
                placeholder="apify_api_..."
                helpUrl="https://apify.com"
                helpText="Scraping LinkedIn"
              />
              {/* Pappers */}
              <ApiKeyInput
                label="Pappers"
                value={pappersApiKey}
                onChange={setPappersApiKey}
                show={showPappersKey}
                onToggleShow={() => setShowPappersKey(!showPappersKey)}
                placeholder="Clé Pappers..."
                helpUrl="https://pappers.fr"
                helpText="Données légales entreprises"
              />

              <Button onClick={handleSaveApiKeys} disabled={updateSetting.isPending} className="mt-4">
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder les clés
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === TAB: Credits & Plans === */}
        <TabsContent value="credits" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Manus */}
            <PlanCard
              title="Manus (Enrichissement)"
              icon={<Cpu className="h-5 w-5 text-violet-500" />}
              credits={manusCredits}
              threshold={manusThreshold}
              planName={manusPlanName}
              monthlyCredits={manusMonthlyCredits}
              onPlanNameChange={setManusPlanName}
              onMonthlyCreditsChange={setManusMonthlyCredits}
              onThresholdChange={setManusThreshold}
              onSave={handleSaveManus}
              extraField={
                <div>
                  <Label>Coût par enrichissement</Label>
                  <Input
                    type="number"
                    value={manusCostPerEnrichment}
                    onChange={(e) => setManusCostPerEnrichment(Number(e.target.value))}
                    min={0}
                    step={0.1}
                  />
                </div>
              }
              getProgressColor={getProgressColor}
            />
            {/* Apify */}
            <PlanCard
              title="Apify (Scraping)"
              icon={<Newspaper className="h-5 w-5 text-blue-500" />}
              credits={apifyCredits}
              threshold={apifyThreshold}
              planName={apifyPlanName}
              monthlyCredits={apifyMonthlyCredits}
              onPlanNameChange={setApifyPlanName}
              onMonthlyCreditsChange={setApifyMonthlyCredits}
              onThresholdChange={setApifyThreshold}
              onSave={handleSaveApify}
              extraField={
                <div>
                  <Label>Coût par scrape</Label>
                  <Input
                    type="number"
                    value={apifyCostPerScrape}
                    onChange={(e) => setApifyCostPerScrape(Number(e.target.value))}
                    min={0}
                    step={0.1}
                  />
                </div>
              }
              getProgressColor={getProgressColor}
            />
            {/* Pappers */}
            <PlanCard
              title="Pappers (Données légales)"
              icon={<FileSearch className="h-5 w-5 text-emerald-500" />}
              credits={pappersCredits}
              threshold={pappersThreshold}
              planName={pappersPlanName}
              monthlyCredits={pappersMonthlyCredits}
              onPlanNameChange={setPappersPlanName}
              onMonthlyCreditsChange={setPappersMonthlyCredits}
              onThresholdChange={setPappersThreshold}
              onSave={handleSavePappers}
              extraField={
                <div>
                  <Label>Requêtes par seconde</Label>
                  <Input
                    type="number"
                    value={pappersRateLimit}
                    onChange={(e) => setPappersRateLimit(Number(e.target.value))}
                    min={1}
                    max={10}
                  />
                </div>
              }
              getProgressColor={getProgressColor}
            />
          </div>
        </TabsContent>

        {/* === TAB: Geo Zones === */}
        <TabsContent value="geo" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-500" />
                Zones géographiques prioritaires
              </CardTitle>
              <CardDescription>
                Filtrez les signaux par région pour cibler vos prospects
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Priority Zones */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <h3 className="font-medium">Zones prioritaires</h3>
                </div>
                {priorityZones.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center bg-muted/50 rounded-lg">
                    Aucune zone prioritaire. Cliquez sur une région ci-dessous pour l'ajouter.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {priorityZones.map((zone) => (
                      <ZoneCard
                        key={zone.id}
                        zone={zone}
                        isPriority
                        onRemovePriority={() => handleSetPriority(zone, 99)}
                        onToggleActive={() => handleToggleActive(zone)}
                        onAddCity={() => setNewCity({ zoneId: zone.id, value: '' })}
                        newCity={newCity?.zoneId === zone.id ? newCity : null}
                        onNewCityChange={(value) => setNewCity({ zoneId: zone.id, value })}
                        onNewCitySubmit={handleAddCity}
                        onNewCityCancel={() => setNewCity(null)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Other Zones */}
              <div>
                <h3 className="font-medium mb-3">Autres régions</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {otherZones.map(zone => (
                    <div
                      key={zone.id}
                      className={cn(
                        'flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer',
                        'hover:border-primary/50 hover:bg-muted/50',
                        !zone.is_active && 'opacity-50'
                      )}
                      onClick={() => handleSetPriority(zone, 1)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color || '#888' }} />
                        <span className="font-medium text-sm">{zone.name}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs">
                        <ArrowUp className="h-3 w-3" />
                        Ajouter
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Unknown Zone */}
              {unknownZone && (
                <div className="p-4 rounded-lg border border-dashed bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: unknownZone.color || '#888' }} />
                      <span className="text-sm text-muted-foreground">{unknownZone.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Active</span>
                      <Switch checked={unknownZone.is_active ?? false} onCheckedChange={() => handleToggleActive(unknownZone)} />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === TAB: Search Queries === */}
        <TabsContent value="queries" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <SearchIcon className="h-5 w-5 text-primary" />
                  Requêtes de recherche NewsAPI
                </CardTitle>
                <CardDescription>
                  {activeQueriesCount} requêtes actives sur {totalQueriesCount}
                </CardDescription>
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
                    <DialogDescription>Créez une requête de recherche NewsAPI.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Nom</Label>
                      <Input value={newQueryName} onChange={(e) => setNewQueryName(e.target.value)} placeholder="Ex: Levées biotech" />
                    </div>
                    <div>
                      <Label>Requête NewsAPI</Label>
                      <Textarea value={newQueryText} onChange={(e) => setNewQueryText(e.target.value)} placeholder='("levée de fonds" OR "lève") AND biotech' rows={3} className="font-mono text-sm" />
                    </div>
                    <div>
                      <Label>Description (optionnel)</Label>
                      <Input value={newQueryDescription} onChange={(e) => setNewQueryDescription(e.target.value)} placeholder="Décrivez ce que cette requête détecte" />
                    </div>
                    <div>
                      <Label>Catégorie</Label>
                      <Select value={newQueryCategory} onValueChange={(v) => setNewQueryCategory(v as SignalType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(SIGNAL_TYPE_CONFIG).map(([key, config]) => (
                            <SelectItem key={key} value={key}>{config.emoji} {config.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
                    <Button onClick={handleAddQuery} disabled={addQuery.isPending}>Ajouter</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4">
              <QueryCoverage queries={queries || []} />
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
            </CardContent>
          </Card>

          {/* Scan Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Scan manuel</CardTitle>
              <CardDescription>Lancez un scan pour récupérer les derniers articles</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleRunScan} disabled={runScan.isPending}>
                {runScan.isPending ? <LoadingSpinner size="sm" className="mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {runScan.isPending ? 'Scan en cours...' : 'Lancer un scan'}
              </Button>
              {scanLogs && scanLogs.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">Derniers scans</h4>
                  <div className="text-xs space-y-1">
                    {scanLogs.slice(0, 3).map((log) => (
                      <div key={log.id} className="flex items-center gap-2">
                        <span className={cn(
                          'inline-block w-2 h-2 rounded-full',
                          log.status === 'completed' ? 'bg-success' : log.status === 'running' ? 'bg-warning' : 'bg-destructive'
                        )} />
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: fr })}
                        </span>
                        <span>→ {log.signals_created} signaux</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === TAB: Filters === */}
        <TabsContent value="filters" className="space-y-6">
          {/* Employee Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Filtres d'effectifs minimum
              </CardTitle>
              <CardDescription>
                Ne ciblez que les entreprises ayant un minimum de salariés
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Newspaper className="h-4 w-4 text-violet-500" />
                    Signaux Presse
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" value={minEmployeesPresse} onChange={(e) => setMinEmployeesPresse(Number(e.target.value))} min={0} max={1000} className="w-24" />
                    <span className="text-sm text-muted-foreground">salariés min.</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <FileSearch className="h-4 w-4 text-emerald-500" />
                    Signaux Pappers
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" value={minEmployeesPappers} onChange={(e) => setMinEmployeesPappers(Number(e.target.value))} min={0} max={1000} className="w-24" />
                    <span className="text-sm text-muted-foreground">salariés min.</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Linkedin className="h-4 w-4 text-blue-500" />
                    Signaux LinkedIn
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" value={minEmployeesLinkedin} onChange={(e) => setMinEmployeesLinkedin(Number(e.target.value))} min={0} max={1000} className="w-24" />
                    <span className="text-sm text-muted-foreground">salariés min.</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Paramètres généraux</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Score minimum à afficher</Label>
                  <Select value={minScore} onValueChange={setMinScore}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <Label>Jours d'historique NewsAPI</Label>
                  <Select value={daysToFetch} onValueChange={setDaysToFetch}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 jour</SelectItem>
                      <SelectItem value="3">3 jours</SelectItem>
                      <SelectItem value="7">7 jours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Auto-enrichment */}
              <div className="p-4 rounded-lg bg-muted/50 border space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Enrichissement automatique</h4>
                    <p className="text-sm text-muted-foreground">Déclenche la recherche de contacts pour les signaux à haut score</p>
                  </div>
                  <Switch checked={autoEnrichEnabled} onCheckedChange={setAutoEnrichEnabled} />
                </div>
                {autoEnrichEnabled && (
                  <div className="pt-3 border-t space-y-3">
                    <div>
                      <Label>Score minimum auto-enrichissement</Label>
                      <Select value={autoEnrichMinScore} onValueChange={setAutoEnrichMinScore}>
                        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3">Score ≥ 3</SelectItem>
                          <SelectItem value="4">Score ≥ 4 (recommandé)</SelectItem>
                          <SelectItem value="5">Score 5 uniquement</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {eligibleSignals && eligibleSignals.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                              {eligibleSignals.length} signal{eligibleSignals.length > 1 ? 'x' : ''} non enrichi{eligibleSignals.length > 1 ? 's' : ''}
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">Ces signaux correspondent au seuil mais n'ont pas été enrichis.</p>
                          </div>
                          <AlertDialog open={retroactiveDialogOpen} onOpenChange={setRetroactiveDialogOpen}>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700">
                                <Zap className="h-4 w-4 mr-1" />
                                Enrichir
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Enrichissement rétroactif</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Lancer l'enrichissement pour {eligibleSignals.length} signal{eligibleSignals.length > 1 ? 's' : ''} ?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Annuler</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={async () => {
                                    setIsEnrichingRetroactive(true);
                                    let successCount = 0;
                                    for (const signal of eligibleSignals) {
                                      try {
                                        await triggerEnrichment.mutateAsync(signal.id);
                                        successCount++;
                                      } catch (e) { /* ignore */ }
                                    }
                                    setIsEnrichingRetroactive(false);
                                    setRetroactiveDialogOpen(false);
                                    queryClient.invalidateQueries({ queryKey: ['eligible-signals-for-enrichment'] });
                                    toast({ title: `${successCount} enrichissement${successCount > 1 ? 's' : ''} lancé${successCount > 1 ? 's' : ''}` });
                                  }}
                                  disabled={isEnrichingRetroactive}
                                >
                                  {isEnrichingRetroactive ? 'En cours...' : 'Enrichir'}
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

              <Button onClick={handleSaveFilters} disabled={updateSetting.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder tous les filtres
              </Button>
            </CardContent>
          </Card>

          {/* Info */}
          <Card className="bg-amber-500/10 border-amber-500/20">
            <CardContent className="flex items-start gap-3 pt-6">
              <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium">À propos des filtres</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Les filtres d'effectifs évitent de générer des signaux pour de petites structures non pertinentes pour le cadeau d'affaires B2B.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// === Helper Components ===

interface ApiKeyInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  helpUrl?: string;
  helpText: string;
}

function ApiKeyInput({ label, value, onChange, show, onToggleShow, placeholder, helpUrl, helpText }: ApiKeyInputProps) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className={cn(
          'flex items-center gap-1 px-3 rounded-md border',
          value ? 'bg-success/10 border-success/30 text-success' : 'bg-destructive/10 border-destructive/30 text-destructive'
        )}>
          {value ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span className="text-xs font-medium">{value ? 'OK' : 'Manquante'}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {helpText}
        {helpUrl && (
          <>
            {' — '}
            <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {helpUrl.replace('https://', '')}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

interface PlanCardProps {
  title: string;
  icon: React.ReactNode;
  credits: { used: number; limit: number; percent: number; isWarning: boolean; isCritical: boolean };
  threshold: number;
  planName: string;
  monthlyCredits: number;
  onPlanNameChange: (value: string) => void;
  onMonthlyCreditsChange: (value: number) => void;
  onThresholdChange: (value: number) => void;
  onSave: () => void;
  extraField: React.ReactNode;
  getProgressColor: (percent: number, threshold: number) => string;
}

function PlanCard({ title, icon, credits, threshold, planName, monthlyCredits, onPlanNameChange, onMonthlyCreditsChange, onThresholdChange, onSave, extraField, getProgressColor }: PlanCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Utilisation</span>
            <Badge variant={credits.isCritical ? 'destructive' : credits.isWarning ? 'outline' : 'secondary'}>
              {credits.percent}%
            </Badge>
          </div>
          <Progress value={Math.min(credits.percent, 100)} className={`h-2 [&>div]:${getProgressColor(credits.percent, threshold)}`} />
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>{credits.used.toLocaleString()} utilisés</span>
            <span>{credits.limit.toLocaleString()} limite</span>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Nom du forfait</Label>
            <Input value={planName} onChange={(e) => onPlanNameChange(e.target.value)} />
          </div>
          <div>
            <Label>Crédits mensuels</Label>
            <Input type="number" value={monthlyCredits} onChange={(e) => onMonthlyCreditsChange(Number(e.target.value))} min={0} />
          </div>
          {extraField}
          <div>
            <Label className="flex items-center justify-between">
              <span>Seuil d'alerte</span>
              <span className="text-sm text-muted-foreground">{threshold}%</span>
            </Label>
            <Slider value={[threshold]} onValueChange={(v) => onThresholdChange(v[0])} max={100} min={50} step={5} className="mt-2" />
          </div>
        </div>

        <Button onClick={onSave} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          Sauvegarder
        </Button>
      </CardContent>
    </Card>
  );
}

// ZoneCard component
interface ZoneCardProps {
  zone: GeoZone;
  isPriority?: boolean;
  onRemovePriority?: () => void;
  onToggleActive: () => void;
  onAddCity: () => void;
  newCity: { zoneId: string; value: string } | null;
  onNewCityChange: (value: string) => void;
  onNewCitySubmit: () => void;
  onNewCityCancel: () => void;
}

function ZoneCard({ zone, isPriority, onRemovePriority, onToggleActive, onAddCity, newCity, onNewCityChange, onNewCitySubmit, onNewCityCancel }: ZoneCardProps) {
  return (
    <div className={cn('p-4 rounded-lg border', isPriority && 'border-emerald-500/50 bg-emerald-500/5')}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: zone.color || '#888' }} />
          <span className="font-semibold">{zone.name}</span>
          {zone.is_default_priority && <Badge variant="secondary" className="text-xs">Défaut</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {isPriority && onRemovePriority && (
            <Button variant="ghost" size="sm" onClick={onRemovePriority} className="text-muted-foreground hover:text-destructive h-7 text-xs">
              <ArrowDown className="h-3 w-3 mr-1" />
              Retirer
            </Button>
          )}
          <Switch checked={zone.is_active ?? false} onCheckedChange={onToggleActive} />
        </div>
      </div>
      {zone.departments && zone.departments.length > 0 && (
        <div className="mb-2">
          <span className="text-xs text-muted-foreground">Départements : </span>
          <span className="text-xs">{zone.departments.join(', ')}</span>
        </div>
      )}
      {((zone.cities && zone.cities.length > 0) || newCity) && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Villes spécifiques :</span>
            {!newCity && (
              <Button variant="ghost" size="sm" onClick={onAddCity} className="h-6 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Ajouter
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {zone.cities?.map(city => (
              <Badge key={city} variant="outline" className="text-xs">{city}</Badge>
            ))}
            {newCity && (
              <div className="flex items-center gap-1">
                <Input
                  value={newCity.value}
                  onChange={(e) => onNewCityChange(e.target.value)}
                  placeholder="Ville"
                  className="h-6 w-32 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNewCitySubmit();
                    if (e.key === 'Escape') onNewCityCancel();
                  }}
                />
                <Button size="sm" className="h-6 w-6 p-0" onClick={onNewCitySubmit}><Check className="h-3 w-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onNewCityCancel}><X className="h-3 w-3" /></Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
