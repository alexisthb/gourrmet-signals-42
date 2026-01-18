import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Key, Eye, EyeOff, RefreshCw, Plus, Check, AlertCircle, Search as SearchIcon, 
  Zap, MapPin, Star, ArrowUp, ArrowDown, X, Save, AlertTriangle, Settings2,
  Cpu, Newspaper, FileSearch, Users, Linkedin, Calendar, Award, Building2, Trash2, Loader2,
  History as HistoryIcon, MessageSquare
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
import { usePappersQueries, useCreatePappersQuery, useUpdatePappersQuery, useDeletePappersQuery } from '@/hooks/usePappers';
import { useNewsApiPlanSettings, useNewsApiCreditsSummary, useNewsApiStats } from '@/hooks/useNewsApiCredits';
import { useRevenueSettings, useUpdateRevenueSetting, REVENUE_FLOOR, usePerplexityUsage } from '@/hooks/useRevenueSettings';
import { usePerplexityStats } from '@/hooks/usePerplexityCredits';
import { CreditAlert } from '@/components/CreditAlert';
import { RevenueSlider } from '@/components/RevenueSlider';
import { PersonaConfigCard } from '@/components/PersonaConfigCard';
import { ScanHistoryTab } from '@/components/ScanHistoryTab';
import { TonalCharterTab } from '@/components/TonalCharterTab';
import { cn } from '@/lib/utils';

// Config for Pappers query types
const PAPPERS_QUERY_TYPE_CONFIG: Record<string, { label: string; icon: typeof Calendar; color: string }> = {
  anniversary: { label: 'Anniversaire', icon: Calendar, color: 'text-amber-500' },
  nomination: { label: 'Nomination', icon: Award, color: 'text-blue-500' },
  capital_increase: { label: 'Augmentation capital', icon: Building2, color: 'text-emerald-500' },
  creation: { label: 'Création', icon: Building2, color: 'text-cyan-500' },
};

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
  const { data: newsApiPlan } = useNewsApiPlanSettings();
  const newsApiCredits = useNewsApiCreditsSummary();
  const newsApiStats = useNewsApiStats();
  
  // Perplexity stats
  const { data: perplexityStats } = usePerplexityStats();
  
  // Revenue settings hooks
  const { data: revenueSettings } = useRevenueSettings();
  const updateRevenueSetting = useUpdateRevenueSetting();
  
  // Perplexity enrichment toggle state
  const [perplexityEnrichPresse, setPerplexityEnrichPresse] = useState(true);

  // Pappers queries hooks
  const { data: pappersQueries, isLoading: pappersQueriesLoading } = usePappersQueries();
  const createPappersQuery = useCreatePappersQuery();
  const updatePappersQuery = useUpdatePappersQuery();
  const deletePappersQuery = useDeletePappersQuery();

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
  const [pappersAnticipationMonths, setPappersAnticipationMonths] = useState(9);

  // General settings state
  const [minScore, setMinScore] = useState('3');
  const [daysToFetch, setDaysToFetch] = useState('1');
  const [autoEnrichEnabled, setAutoEnrichEnabled] = useState(true);
  const [autoEnrichMinScore, setAutoEnrichMinScore] = useState('4');
  const [retroactiveDialogOpen, setRetroactiveDialogOpen] = useState(false);
  const [isEnrichingRetroactive, setIsEnrichingRetroactive] = useState(false);

  // New query dialog state (Presse)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newQueryName, setNewQueryName] = useState('');
  const [newQueryText, setNewQueryText] = useState('');
  const [newQueryDescription, setNewQueryDescription] = useState('');
  const [newQueryCategory, setNewQueryCategory] = useState<SignalType>('anniversaire');

  // Pappers query dialog state
  const [pappersDialogOpen, setPappersDialogOpen] = useState(false);
  const [newPappersQuery, setNewPappersQuery] = useState({
    name: '',
    type: 'anniversary' as const,
    region: '11',
    years: '10',
    min_employees: '20',
  });

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
      setPappersAnticipationMonths(parseInt(settings.pappers_anticipation_months) || 9);
      setPerplexityEnrichPresse(settings.perplexity_enrich_presse !== 'false');
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

  // Geo zones data - Active zones at top, sorted by priority
  const activeZones = zones
    .filter(z => z.is_active && z.slug !== 'unknown')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  const inactiveZones = zones
    .filter(z => !z.is_active && z.slug !== 'unknown')
    .sort((a, b) => a.name.localeCompare(b.name));
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

  const handleSavePresseFilters = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'min_employees_presse', value: String(minEmployeesPresse) }),
        updateSetting.mutateAsync({ key: 'days_to_fetch', value: daysToFetch }),
        updateSetting.mutateAsync({ key: 'perplexity_enrich_presse', value: perplexityEnrichPresse ? 'true' : 'false' }),
      ]);
      toast({ title: 'Filtres Presse sauvegardés' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSavePappersFilters = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'min_employees_pappers', value: String(minEmployeesPappers) }),
        updateSetting.mutateAsync({ key: 'pappers_anticipation_months', value: String(pappersAnticipationMonths) }),
      ]);
      toast({ title: 'Filtres Pappers sauvegardés' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSaveLinkedinFilters = async () => {
    try {
      await updateSetting.mutateAsync({ key: 'min_employees_linkedin', value: String(minEmployeesLinkedin) });
      toast({ title: 'Filtres LinkedIn sauvegardés' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSaveGeneralSettings = async () => {
    try {
      await Promise.all([
        updateSetting.mutateAsync({ key: 'min_score_display', value: minScore }),
        updateSetting.mutateAsync({ key: 'auto_enrich_enabled', value: autoEnrichEnabled ? 'true' : 'false' }),
        updateSetting.mutateAsync({ key: 'auto_enrich_min_score', value: autoEnrichMinScore }),
      ]);
      toast({ title: 'Paramètres généraux sauvegardés' });
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

  const handleAddPappersQuery = async () => {
    await createPappersQuery.mutateAsync({
      name: newPappersQuery.name,
      type: newPappersQuery.type,
      is_active: true,
      parameters: {
        region: newPappersQuery.region,
        years: [parseInt(newPappersQuery.years)],
        min_employees: newPappersQuery.min_employees,
      },
    });
    setPappersDialogOpen(false);
    setNewPappersQuery({ name: '', type: 'anniversary', region: '11', years: '10', min_employees: '20' });
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

      <Tabs defaultValue="presse" className="space-y-6">
        <TabsList className="grid w-full grid-cols-7 h-auto p-1">
          <TabsTrigger value="presse" className="text-xs sm:text-sm py-2">
            <Newspaper className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Presse
          </TabsTrigger>
          <TabsTrigger value="pappers" className="text-xs sm:text-sm py-2">
            <Building2 className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Pappers
          </TabsTrigger>
          <TabsTrigger value="linkedin" className="text-xs sm:text-sm py-2">
            <Linkedin className="h-4 w-4 mr-1.5 hidden sm:inline" />
            LinkedIn
          </TabsTrigger>
          <TabsTrigger value="style" className="text-xs sm:text-sm py-2">
            <MessageSquare className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Style
          </TabsTrigger>
          <TabsTrigger value="api" className="text-xs sm:text-sm py-2">
            <Key className="h-4 w-4 mr-1.5 hidden sm:inline" />
            API & Crédits
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm py-2">
            <HistoryIcon className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Historique
          </TabsTrigger>
          <TabsTrigger value="general" className="text-xs sm:text-sm py-2">
            <Settings2 className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Général
          </TabsTrigger>
        </TabsList>

        {/* ========== TAB: PRESSE ========== */}
        <TabsContent value="presse" className="space-y-6">
          {/* Credit Alert */}
          <CreditAlert
            credits={newsApiCredits}
            serviceName="NewsAPI"
            planName={newsApiPlan?.plan_name || 'Developer'}
          />
          
          {/* Stats */}
          {newsApiStats.lastFetch && (
            <Card className="border-l-4 border-l-violet-500 bg-violet-500/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Newspaper className="h-5 w-5 text-violet-500" />
                    <div>
                      <p className="font-medium">Dernière collecte</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(newsApiStats.lastFetch), { addSuffix: true, locale: fr })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-violet-600">{newsApiStats.articles}</p>
                    <p className="text-xs text-muted-foreground">articles collectés aujourd'hui</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Perplexity CA Enrichment Card */}
          <Card className="border-l-4 border-l-cyan-500 bg-cyan-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-5 w-5 text-cyan-500" />
                  Enrichissement CA (Perplexity)
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor="perplexity-toggle" className="text-sm text-muted-foreground">
                    {perplexityEnrichPresse ? 'Activé' : 'Désactivé'}
                  </Label>
                  <Switch
                    id="perplexity-toggle"
                    checked={perplexityEnrichPresse}
                    onCheckedChange={async (checked) => {
                      setPerplexityEnrichPresse(checked);
                      try {
                        await updateSetting.mutateAsync({ 
                          key: 'perplexity_enrich_presse', 
                          value: checked ? 'true' : 'false' 
                        });
                        toast({ 
                          title: checked 
                            ? 'Enrichissement CA activé' 
                            : 'Enrichissement CA désactivé' 
                        });
                      } catch (error) {
                        setPerplexityEnrichPresse(!checked);
                        toast({ title: 'Erreur', variant: 'destructive' });
                      }
                    }}
                  />
                </div>
              </div>
              <CardDescription>
                Recherche automatique du chiffre d'affaires via Perplexity AI lors des scans Presse
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-background rounded-lg border">
                  <p className="text-2xl font-bold text-cyan-600">{perplexityStats?.todayCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Requêtes aujourd'hui</p>
                </div>
                <div className="text-center p-3 bg-background rounded-lg border">
                  <p className="text-2xl font-bold text-cyan-600">{perplexityStats?.thisMonthCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Ce mois</p>
                </div>
                <div className="text-center p-3 bg-background rounded-lg border">
                  <p className="text-2xl font-bold text-emerald-600">{perplexityStats?.successRate || 0}%</p>
                  <p className="text-xs text-muted-foreground">Taux de succès</p>
                </div>
                <div className="text-center p-3 bg-background rounded-lg border">
                  <p className="text-2xl font-bold text-amber-600">
                    {perplexityStats?.avgRevenueFound 
                      ? `${(perplexityStats.avgRevenueFound / 1_000_000).toFixed(1)}M€`
                      : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">CA moyen trouvé</p>
                </div>
              </div>
              {!perplexityEnrichPresse && (
                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <p className="text-sm text-amber-700">
                    L'enrichissement CA est désactivé. Les signaux ne seront pas filtrés par chiffre d'affaires.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-500" />
                Zones géographiques
              </CardTitle>
              <CardDescription>Régions ciblées pour la détection de signaux Presse</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <h3 className="font-medium text-sm">Zones actives</h3>
                </div>
                {activeZones.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center bg-muted/50 rounded-lg">
                    Aucune zone sélectionnée.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activeZones.map((zone) => (
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

              <div>
                <h3 className="font-medium text-sm mb-2">Autres régions</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {inactiveZones.map(zone => (
                    <div
                      key={zone.id}
                      className="flex items-center justify-between p-2 rounded-lg border hover:border-primary/50 hover:bg-muted/50 cursor-pointer text-sm"
                      onClick={() => handleToggleActive(zone)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: zone.color || '#888' }} />
                        <span className="truncate">{zone.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Search Queries */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <SearchIcon className="h-5 w-5 text-primary" />
                  Requêtes NewsAPI
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

          {/* Filters Presse */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Filtres Presse
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* CA Slider */}
              <RevenueSlider
                value={revenueSettings?.min_revenue_presse || REVENUE_FLOOR}
                onChange={(value) => updateRevenueSetting.mutate({ key: 'min_revenue_presse', value })}
                description="Les entreprises avec un CA inférieur ne seront pas affichées. Plancher absolu de 1M€ à la création."
                disabled={updateRevenueSetting.isPending}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Effectif minimum</Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" value={minEmployeesPresse} onChange={(e) => setMinEmployeesPresse(Number(e.target.value))} min={0} max={1000} className="w-24" />
                    <span className="text-sm text-muted-foreground">salariés</span>
                  </div>
                </div>
                <div>
                  <Label>Jours d'historique</Label>
                  <Select value={daysToFetch} onValueChange={setDaysToFetch}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 jour</SelectItem>
                      <SelectItem value="3">3 jours</SelectItem>
                      <SelectItem value="7">7 jours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleSavePresseFilters} disabled={updateSetting.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder
              </Button>
            </CardContent>
          </Card>

          {/* Personas Presse */}
          <PersonaConfigCard 
            scannerType="presse" 
            description="Profils ciblés lors de l'enrichissement des contacts Presse"
          />

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

        {/* ========== TAB: PAPPERS ========== */}
        <TabsContent value="pappers" className="space-y-6">
          {/* Credit Alert */}
          <CreditAlert
            credits={pappersCredits}
            serviceName="Pappers"
            planName={pappersPlan?.plan_name || 'Standard'}
          />

          {/* Geo Zones Pappers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-500" />
                Zones géographiques
              </CardTitle>
              <CardDescription>
                Régions prioritaires pour les scans Pappers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <h3 className="font-medium text-sm">Zones actives</h3>
                </div>
                {activeZones.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center bg-muted/50 rounded-lg">
                    Aucune zone sélectionnée.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activeZones.map((zone) => (
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

              <div>
                <h3 className="font-medium text-sm mb-2">Autres régions</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {inactiveZones.map(zone => (
                    <div
                      key={zone.id}
                      className="flex items-center justify-between p-2 rounded-lg border hover:border-primary/50 hover:bg-muted/50 cursor-pointer text-sm"
                      onClick={() => handleToggleActive(zone)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: zone.color || '#888' }} />
                        <span className="truncate">{zone.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pappers Queries */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <SearchIcon className="h-5 w-5 text-emerald-500" />
                  Requêtes Pappers
                </CardTitle>
                <CardDescription>
                  Configurez vos critères de recherche de leads
                </CardDescription>
              </div>
              <Dialog open={pappersDialogOpen} onOpenChange={setPappersDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Nouvelle requête
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Créer une requête Pappers</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nom de la requête</Label>
                      <Input 
                        placeholder="Ex: Anniversaires 10 ans - IDF"
                        value={newPappersQuery.name}
                        onChange={(e) => setNewPappersQuery(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Type de signal</Label>
                      <Select 
                        value={newPappersQuery.type} 
                        onValueChange={(value: any) => setNewPappersQuery(prev => ({ ...prev, type: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="anniversary">Anniversaire d'entreprise</SelectItem>
                          <SelectItem value="nomination">Nomination dirigeant</SelectItem>
                          <SelectItem value="capital_increase">Augmentation de capital</SelectItem>
                          <SelectItem value="creation">Création d'entreprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {newPappersQuery.type === 'anniversary' && (
                      <div className="space-y-2">
                        <Label>Années d'anniversaire</Label>
                        <Select 
                          value={newPappersQuery.years} 
                          onValueChange={(value) => setNewPappersQuery(prev => ({ ...prev, years: value }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">10 ans</SelectItem>
                            <SelectItem value="25">25 ans</SelectItem>
                            <SelectItem value="50">50 ans</SelectItem>
                            <SelectItem value="100">100 ans</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Région</Label>
                      <Select 
                        value={newPappersQuery.region} 
                        onValueChange={(value) => setNewPappersQuery(prev => ({ ...prev, region: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="11">Île-de-France</SelectItem>
                          <SelectItem value="84">Auvergne-Rhône-Alpes</SelectItem>
                          <SelectItem value="93">Provence-Alpes-Côte d'Azur</SelectItem>
                          <SelectItem value="all">Toutes régions</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Effectif minimum</Label>
                      <Select 
                        value={newPappersQuery.min_employees} 
                        onValueChange={(value) => setNewPappersQuery(prev => ({ ...prev, min_employees: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10+ employés</SelectItem>
                          <SelectItem value="20">20+ employés</SelectItem>
                          <SelectItem value="50">50+ employés</SelectItem>
                          <SelectItem value="100">100+ employés</SelectItem>
                          <SelectItem value="250">250+ employés</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPappersDialogOpen(false)}>Annuler</Button>
                    <Button onClick={handleAddPappersQuery} disabled={!newPappersQuery.name || createPappersQuery.isPending}>
                      {createPappersQuery.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Créer'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-3">
              {pappersQueriesLoading ? (
                <LoadingSpinner />
              ) : pappersQueries && pappersQueries.length > 0 ? (
                pappersQueries.map((query) => {
                  const config = PAPPERS_QUERY_TYPE_CONFIG[query.type] || PAPPERS_QUERY_TYPE_CONFIG.anniversary;
                  const Icon = config.icon;
                  const params = query.parameters || {};
                  
                  return (
                    <div key={query.id} className={cn('p-4 rounded-lg border', !query.is_active && 'opacity-60')}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg bg-muted ${config.color}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{query.name}</h3>
                              <Badge variant={query.is_active ? 'default' : 'secondary'} className="text-xs">
                                {query.is_active ? 'Actif' : 'Inactif'}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {config.label} • {query.signals_count || 0} signaux
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              {params.region && params.region !== 'all' && (
                                <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                  {params.region === '11' ? 'IDF' : params.region === '84' ? 'ARA' : params.region === '93' ? 'PACA' : params.region}
                                </span>
                              )}
                              {params.years && (
                                <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                  {Array.isArray(params.years) ? params.years.join(', ') : params.years} ans
                                </span>
                              )}
                              {params.min_employees && (
                                <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                  {params.min_employees}+ emp.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={query.is_active}
                            onCheckedChange={() => updatePappersQuery.mutateAsync({ id: query.id, is_active: !query.is_active })}
                            disabled={updatePappersQuery.isPending}
                          />
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => deletePappersQuery.mutateAsync(query.id)}
                            disabled={deletePappersQuery.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Aucune requête configurée</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Filters Pappers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-emerald-500" />
                Paramètres de Scan Pappers
              </CardTitle>
              <CardDescription>
                Configurez l'anticipation et les filtres pour les scans d'anniversaires
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Anticipation */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">Anticipation des anniversaires</Label>
                  <Badge variant="secondary" className="text-base px-3">
                    {pappersAnticipationMonths} mois
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Scanner les entreprises qui fêteront leur anniversaire dans <strong>{pappersAnticipationMonths} mois</strong>.
                  {(() => {
                    const futureDate = new Date();
                    futureDate.setMonth(futureDate.getMonth() + pappersAnticipationMonths);
                    return (
                      <span className="ml-1">
                        Aujourd'hui → Anniversaires du <strong>{futureDate.toLocaleDateString('fr-FR')}</strong>
                      </span>
                    );
                  })()}
                </p>
                <Slider
                  value={[pappersAnticipationMonths]}
                  onValueChange={(values) => setPappersAnticipationMonths(values[0])}
                  min={1}
                  max={12}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 mois</span>
                  <span>6 mois</span>
                  <span>12 mois</span>
                </div>
              </div>

              {/* CA Slider */}
              <RevenueSlider
                value={revenueSettings?.min_revenue_pappers || REVENUE_FLOOR}
                onChange={(value) => updateRevenueSetting.mutate({ key: 'min_revenue_pappers', value })}
                description="Les entreprises avec un CA inférieur ne seront pas affichées. Les données CA viennent directement de Pappers."
                disabled={updateRevenueSetting.isPending}
              />

              {/* Effectif minimum */}
              <div>
                <Label>Effectif minimum</Label>
                <div className="flex items-center gap-2 mt-2">
                  <Input 
                    type="number" 
                    value={minEmployeesPappers} 
                    onChange={(e) => setMinEmployeesPappers(Number(e.target.value))} 
                    min={0} 
                    max={1000} 
                    className="w-24" 
                  />
                  <span className="text-sm text-muted-foreground">salariés minimum</span>
                </div>
              </div>

              <Button onClick={handleSavePappersFilters} disabled={updateSetting.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder les paramètres
              </Button>
            </CardContent>
          </Card>

          {/* Personas Pappers */}
          <PersonaConfigCard 
            scannerType="pappers" 
            description="Profils ciblés lors de l'enrichissement des contacts Pappers"
          />
        </TabsContent>

        {/* ========== TAB: LINKEDIN ========== */}
        <TabsContent value="linkedin" className="space-y-6">
          {/* Credit Alerts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CreditAlert
              credits={apifyCredits}
              serviceName="Apify"
              planName={apifyPlan?.plan_name || 'Starter'}
            />
            <CreditAlert
              credits={manusCredits}
              serviceName="Manus"
              planName={manusPlan?.plan_name || 'Standard'}
            />
          </div>

          {/* Engagement Weighting */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-500" />
                Pondération des engagements
              </CardTitle>
              <CardDescription>
                Poids attribués aux différents types d'interactions LinkedIn
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-blue-600">5</p>
                  <p className="text-sm text-muted-foreground">Commentaires</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-emerald-600">4</p>
                  <p className="text-sm text-muted-foreground">Partages</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-amber-600">3</p>
                  <p className="text-sm text-muted-foreground">Likes</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Ces poids sont utilisés pour calculer le score des signaux LinkedIn
              </p>
            </CardContent>
          </Card>

          {/* Priority Contact Types */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500" />
                Types de contacts prioritaires
              </CardTitle>
              <CardDescription>
                Ces profils sont mis en avant dans les listes de contacts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-700">
                  <Star className="h-3 w-3 mr-1 fill-amber-500" />
                  Assistant(e) de direction
                </Badge>
                <Badge variant="outline" className="bg-violet-500/10 border-violet-500/30 text-violet-700">
                  <Star className="h-3 w-3 mr-1 fill-violet-500" />
                  Office Manager
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Filters LinkedIn */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-500" />
                Filtres LinkedIn
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* CA Slider */}
              <RevenueSlider
                value={revenueSettings?.min_revenue_linkedin || REVENUE_FLOOR}
                onChange={(value) => updateRevenueSetting.mutate({ key: 'min_revenue_linkedin', value })}
                description="Les engagers dont l'entreprise a un CA inférieur ne seront pas affichés. CA enrichi via Perplexity ou estimé par effectif."
                disabled={updateRevenueSetting.isPending}
              />

              <div>
                <Label>Effectif minimum</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" value={minEmployeesLinkedin} onChange={(e) => setMinEmployeesLinkedin(Number(e.target.value))} min={0} max={1000} className="w-24" />
                  <span className="text-sm text-muted-foreground">salariés</span>
                </div>
              </div>
              <Button onClick={handleSaveLinkedinFilters} disabled={updateSetting.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder
              </Button>
            </CardContent>
          </Card>

          {/* Personas LinkedIn */}
          <PersonaConfigCard 
            scannerType="linkedin" 
            description="Profils ciblés lors de l'enrichissement des engagers LinkedIn"
          />
        </TabsContent>

        {/* ========== TAB: STYLE DE MESSAGERIE ========== */}
        <TabsContent value="style" className="space-y-6">
          <TonalCharterTab />
        </TabsContent>

        {/* ========== TAB: API & CREDITS ========== */}
        <TabsContent value="api" className="space-y-6">
          {/* API Keys */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Clés d'authentification API
              </CardTitle>
              <CardDescription>
                Configurez vos clés d'accès aux différents services
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ApiKeyInput
                  label="NewsAPI"
                  value={newsApiKey}
                  onChange={setNewsApiKey}
                  show={showNewsApiKey}
                  onToggleShow={() => setShowNewsApiKey(!showNewsApiKey)}
                  placeholder="Clé NewsAPI..."
                  helpUrl="https://newsapi.org"
                  helpText="Collecte d'articles"
                />
                <ApiKeyInput
                  label="Claude (Anthropic)"
                  value={claudeApiKey}
                  onChange={setClaudeApiKey}
                  show={showClaudeKey}
                  onToggleShow={() => setShowClaudeKey(!showClaudeKey)}
                  placeholder="sk-ant-..."
                  helpUrl="https://console.anthropic.com"
                  helpText="Analyse IA des articles"
                />
                <ApiKeyInput
                  label="Manus"
                  value={manusApiKey}
                  onChange={setManusApiKey}
                  show={showManusKey}
                  onToggleShow={() => setShowManusKey(!showManusKey)}
                  placeholder="Clé Manus..."
                  helpUrl="https://manus.im"
                  helpText="Enrichissement LinkedIn"
                />
                <ApiKeyInput
                  label="Apify"
                  value={apifyApiKey}
                  onChange={setApifyApiKey}
                  show={showApifyKey}
                  onToggleShow={() => setShowApifyKey(!showApifyKey)}
                  placeholder="Clé Apify..."
                  helpUrl="https://apify.com"
                  helpText="Scraping web"
                />
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
              </div>

              <Button onClick={handleSaveApiKeys} disabled={updateSetting.isPending} className="mt-4">
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder les clés
              </Button>
            </CardContent>
          </Card>

          {/* Credits & Plans */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

        {/* ========== TAB: HISTORY ========== */}
        <TabsContent value="history" className="space-y-6">
          <ScanHistoryTab />
        </TabsContent>

        {/* ========== TAB: GENERAL ========== */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Paramètres généraux</CardTitle>
              <CardDescription>
                Paramètres transversaux à tous les modules
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Filtre les signaux affichés selon leur score de pertinence
                  </p>
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

              <Button onClick={handleSaveGeneralSettings} disabled={updateSetting.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder les paramètres
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
                  Les filtres d'effectifs (configurés par scanner) évitent de générer des signaux pour de petites structures non pertinentes pour le cadeau d'affaires B2B.
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
    <div className={cn('p-3 rounded-lg border', isPriority && 'border-emerald-500/50 bg-emerald-500/5')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color || '#888' }} />
          <span className="font-medium text-sm">{zone.name}</span>
          {zone.is_default_priority && <Badge variant="secondary" className="text-[10px]">Défaut</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {isPriority && onRemovePriority && (
            <Button variant="ghost" size="sm" onClick={onRemovePriority} className="text-muted-foreground hover:text-destructive h-6 text-xs">
              <ArrowDown className="h-3 w-3 mr-1" />
              Retirer
            </Button>
          )}
          <Switch checked={zone.is_active ?? false} onCheckedChange={onToggleActive} />
        </div>
      </div>
      {zone.departments && zone.departments.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          Dép. : {zone.departments.join(', ')}
        </div>
      )}
      {((zone.cities && zone.cities.length > 0) || newCity) && (
        <div className="mt-2 pt-2 border-t">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Villes :</span>
            {!newCity && (
              <Button variant="ghost" size="sm" onClick={onAddCity} className="h-5 text-xs p-0">
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
                  className="h-6 w-28 text-xs"
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
