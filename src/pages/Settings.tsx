import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Key, Eye, EyeOff, RefreshCw, Plus, Check, AlertCircle, Search as SearchIcon, 
  Zap, MapPin, Star, ArrowUp, ArrowDown, X, Save, AlertTriangle, Settings2,
  Cpu, Newspaper, FileSearch, Users, Calendar, Award, Building2, Trash2, Loader2,
  History as HistoryIcon, MessageSquare, Gift
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
import type { SignalType } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  useAllGeoZones,
  useUpdateGeoZonePriority,
  useToggleGeoZoneActive,
  useAddCityToZone,
  GeoZone,
} from '@/hooks/useGeoZones';
// Manus retiré : plus de useManusCredits.
import { useApifyPlanSettings, useApifyCreditsSummary } from '@/hooks/useApifyCredits';
import { usePappersPlanSettings, usePappersCreditsSummary } from '@/hooks/usePappersCredits';
import { usePappersQueries, useCreatePappersQuery, useUpdatePappersQuery, useDeletePappersQuery } from '@/hooks/usePappers';
import { useNewsApiPlanSettings, useNewsApiCreditsSummary, useNewsApiStats } from '@/hooks/useNewsApiCredits';
import { useRevenueSettings, useUpdateRevenueSetting, REVENUE_FLOOR } from '@/hooks/useRevenueSettings';
import { usePerplexityStats, usePerplexityUsageTelemetry } from '@/hooks/usePerplexityCredits';
import {
  useDropcontactBalanceStatus,
  useLovableAITelemetry,
  type DropcontactBalanceStatus,
  type TokenTelemetry,
} from '@/hooks/useProviderTelemetry';
import { CreditAlert } from '@/components/CreditAlert';
import { RevenueSlider } from '@/components/RevenueSlider';
import { PersonaConfigCard } from '@/components/PersonaConfigCard';
import { ScanHistoryTab } from '@/components/ScanHistoryTab';
import { TonalCharterTab } from '@/components/TonalCharterTab';
import { GiftTemplatesTab } from '@/components/GiftTemplatesTab';
import { cn } from '@/lib/utils';

// Config for Pappers query types
const PAPPERS_QUERY_TYPE_CONFIG: Record<string, { label: string; icon: typeof Calendar; color: string }> = {
  anniversary: { label: 'Anniversaire', icon: Calendar, color: 'text-amber-500' },
  nomination: { label: 'Nomination', icon: Award, color: 'text-blue-500' },
  capital_increase: { label: 'Augmentation capital', icon: Building2, color: 'text-emerald-500' },
  creation: { label: 'Création', icon: Building2, color: 'text-cyan-500' },
};
const PAPPERS_SUPPORTED_QUERY_TYPES = new Set(['anniversary', 'creation']);
const RETROACTIVE_ENRICHMENT_BATCH_SIZE = 100;

interface EnrichmentBatchStatus {
  total_count: number;
  ready_count: number;
  active_count: number;
  cooldown_count: number;
  manual_retry_required_count: number;
  enqueued_count?: number;
}

const SETTINGS_TABS = new Set(['presse', 'pappers', 'cadeaux', 'style', 'api', 'history', 'general']);

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Onglet pilotable par l'URL (?tab=pappers) pour le deep-linking depuis le
  // dashboard (ex: bouton "Requêtes" du dashboard Pappers).
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab && SETTINGS_TABS.has(requestedTab) ? requestedTab : 'presse';
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: queries, isLoading: queriesLoading } = useSearchQueries();
  const { data: scanLogs } = useScanLogs();
  
  const updateSetting = useUpdateSetting();
  const toggleQuery = useToggleSearchQuery();
  const addQuery = useAddSearchQuery();
  const deleteQuery = useDeleteSearchQuery();
  const runScan = useRunScan();

  // Geo zones hooks
  const { data: zones = [], isLoading: zonesLoading } = useAllGeoZones();
  const updatePriority = useUpdateGeoZonePriority();
  const toggleActive = useToggleGeoZoneActive();
  const addCity = useAddCityToZone();
  const [newCity, setNewCity] = useState<{ zoneId: string; value: string } | null>(null);

  // API Credits hooks
  // Manus retiré : plus de crédits Manus dans les settings.

  const { data: apifyPlan } = useApifyPlanSettings();
  const apifyCredits = useApifyCreditsSummary();
  const { data: pappersPlan } = usePappersPlanSettings();
  const pappersCredits = usePappersCreditsSummary();
  const { data: newsApiPlan } = useNewsApiPlanSettings();
  const newsApiCredits = useNewsApiCreditsSummary();
  const newsApiStats = useNewsApiStats();
  
  // Perplexity stats
  const { data: perplexityStats } = usePerplexityStats();
  const perplexityTelemetry = usePerplexityUsageTelemetry();
  const lovableAITelemetry = useLovableAITelemetry();
  const dropcontactBalance = useDropcontactBalanceStatus();
  
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

  // Plan settings state
  const [apifyPlanName, setApifyPlanName] = useState('');
  const [apifyMonthlyRunLimit, setApifyMonthlyRunLimit] = useState(0);
  const [apifyThreshold, setApifyThreshold] = useState(80);
  const [apifyPeriodStart, setApifyPeriodStart] = useState('');
  const [apifyPeriodEnd, setApifyPeriodEnd] = useState('');
  const [pappersPlanName, setPappersPlanName] = useState('');
  const [pappersMonthlyCredits, setPappersMonthlyCredits] = useState(0);
  const [pappersThreshold, setPappersThreshold] = useState(80);
  const [pappersRateLimit, setPappersRateLimit] = useState(2);
  const [pappersPeriodStart, setPappersPeriodStart] = useState('');
  const [pappersPeriodEnd, setPappersPeriodEnd] = useState('');
  const [newsApiPlanName, setNewsApiPlanName] = useState('');
  const [newsApiDailyRequests, setNewsApiDailyRequests] = useState(0);
  const [newsApiThreshold, setNewsApiThreshold] = useState(80);

  // Employee filters state
  const [minEmployeesPresse, setMinEmployeesPresse] = useState(20);
  const [minEmployeesPappers, setMinEmployeesPappers] = useState(20);
  const [pappersAnticipationMonths, setPappersAnticipationMonths] = useState(9);
  const [pappersEnrichmentEnabled, setPappersEnrichmentEnabled] = useState(false);
  const [pappersAutoEnrichEnabled, setPappersAutoEnrichEnabled] = useState(false);
  const [pappersAutoEnrichBatch, setPappersAutoEnrichBatch] = useState(10);

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
  const [newPappersQuery, setNewPappersQuery] = useState<{
    name: string;
    type: 'anniversary' | 'creation';
    region: string;
    years: string;
    min_employees: string;
  }>({
    name: '',
    type: 'anniversary',
    region: '11',
    years: '10',
    min_employees: '20',
  });

  // Le backlog est compté exactement côté base; aucune liste potentiellement
  // tronquée par PostgREST n'est chargée dans le navigateur.
  const { data: eligibleBatchStatus } = useQuery({
    queryKey: ['eligible-enrichment-batch-status', autoEnrichMinScore],
    queryFn: async () => {
      const minScoreNum = parseInt(autoEnrichMinScore, 10);
      const { data, error } = await supabase.rpc('enrichment_batch_status', {
        p_min_score: minScoreNum,
      });
      if (error) throw error;
      return data as unknown as EnrichmentBatchStatus;
    },
    refetchInterval: 10_000,
  });

  // Initialize settings from DB
  useEffect(() => {
    if (settings) {
      setMinScore(settings.min_score_display || '3');
      setDaysToFetch(settings.days_to_fetch || '1');
      setAutoEnrichEnabled(settings.auto_enrich_enabled !== 'false');
      setAutoEnrichMinScore(settings.auto_enrich_min_score || '4');
      setMinEmployeesPresse(parseInt(settings.min_employees_presse) || 20);
      setMinEmployeesPappers(parseInt(settings.min_employees_pappers) || 20);
      setPappersAnticipationMonths(parseInt(settings.pappers_anticipation_months) || 9);
      setPappersEnrichmentEnabled(settings.pappers_enrichment_enabled === 'true');
      setPappersAutoEnrichEnabled(settings.pappers_auto_enrich_enabled === 'true');
      setPappersAutoEnrichBatch(parseInt(settings.pappers_auto_enrich_batch) || 10);
      setPerplexityEnrichPresse(settings.perplexity_enrich_presse !== 'false');
    }
  }, [settings]);

  // Manus retiré : plus d'init du forfait Manus.


  useEffect(() => {
    if (apifyPlan) {
      setApifyPlanName(apifyPlan.plan_name);
      setApifyMonthlyRunLimit(apifyPlan.monthly_run_limit);
      setApifyThreshold(apifyPlan.alert_threshold_percent);
      setApifyPeriodStart(apifyPlan.current_period_start.slice(0, 10));
      setApifyPeriodEnd(apifyPlan.current_period_end.slice(0, 10));
    }
  }, [apifyPlan]);

  useEffect(() => {
    if (pappersPlan) {
      setPappersPlanName(pappersPlan.plan_name);
      setPappersMonthlyCredits(pappersPlan.monthly_credits);
      setPappersThreshold(pappersPlan.alert_threshold_percent);
      setPappersRateLimit(pappersPlan.rate_limit_per_second);
      setPappersPeriodStart(pappersPlan.current_period_start.slice(0, 10));
      setPappersPeriodEnd(pappersPlan.current_period_end.slice(0, 10));
    }
  }, [pappersPlan]);

  useEffect(() => {
    if (newsApiPlan) {
      setNewsApiPlanName(newsApiPlan.plan_name);
      setNewsApiDailyRequests(newsApiPlan.daily_requests);
      setNewsApiThreshold(newsApiPlan.alert_threshold_percent);
    }
  }, [newsApiPlan]);

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

  // Convention unique : 1..98 = prioritaire, 99 = standard, is_active = disponible.
  const priorityZones = zones
    .filter(z => z.is_active && (z.priority ?? 99) < 99 && z.slug !== 'unknown')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  const otherZones = zones
    .filter(z => !(z.is_active && (z.priority ?? 99) < 99) && z.slug !== 'unknown')
    .sort((a, b) => a.name.localeCompare(b.name));
  const unknownZone = zones.find(z => z.slug === 'unknown');

  // === Handlers ===
  // Manus retiré : handleSaveManus supprimé.


  const handleSaveApify = async () => {
    if (!apifyPeriodStart || !apifyPeriodEnd || apifyPeriodStart > apifyPeriodEnd) {
      toast({ title: 'Période Apify invalide', description: 'Renseignez des dates contractuelles cohérentes.', variant: 'destructive' });
      return;
    }
    if (!Number.isSafeInteger(apifyMonthlyRunLimit) || apifyMonthlyRunLimit < 0) {
      toast({ title: 'Plafond Apify invalide', description: 'Le plafond doit être un nombre entier de runs Actor.', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase
        .from('apify_plan_settings')
        .upsert({
          id: apifyPlan?.id && apifyPlan.id !== 'default' ? apifyPlan.id : crypto.randomUUID(),
          plan_name: apifyPlanName || 'Non configuré',
          monthly_credits: 0,
          cost_per_scrape: 0,
          monthly_run_limit: Math.max(0, apifyMonthlyRunLimit),
          quota_unit: 'actor_runs',
          current_period_start: apifyPeriodStart,
          current_period_end: apifyPeriodEnd,
          alert_threshold_percent: apifyThreshold,
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['apify-plan-settings'] });
      queryClient.invalidateQueries({ queryKey: ['apify-actor-run-quota'] });
      toast({ title: 'Forfait Apify sauvegardé' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };

  const handleSavePappers = async () => {
    if (!pappersPeriodStart || !pappersPeriodEnd || pappersPeriodStart > pappersPeriodEnd) {
      toast({ title: 'Période Pappers invalide', description: 'Renseignez des dates contractuelles cohérentes.', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase
        .from('pappers_plan_settings')
        .upsert({
          id: pappersPlan?.id && pappersPlan.id !== 'default' ? pappersPlan.id : crypto.randomUUID(),
          plan_name: pappersPlanName || 'Non configuré',
          monthly_credits: Math.max(0, pappersMonthlyCredits),
          current_period_start: pappersPeriodStart,
          current_period_end: pappersPeriodEnd,
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

  const handleSaveNewsApi = async () => {
    try {
      const { error } = await supabase
        .from('newsapi_plan_settings')
        .upsert({
          id: newsApiPlan?.id && newsApiPlan.id !== 'default' ? newsApiPlan.id : crypto.randomUUID(),
          plan_name: newsApiPlanName || 'Non configuré',
          daily_requests: Math.max(0, newsApiDailyRequests),
          current_period_start: new Date(new Date().toISOString().slice(0, 10)).toISOString(),
          alert_threshold_percent: newsApiThreshold,
        });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['newsapi-plan-settings'] });
      queryClient.invalidateQueries({ queryKey: ['newsapi-quota-status'] });
      toast({ title: 'Forfait NewsAPI sauvegardé' });
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
        updateSetting.mutateAsync({ key: 'pappers_enrichment_enabled', value: pappersEnrichmentEnabled ? 'true' : 'false' }),
        updateSetting.mutateAsync({ key: 'pappers_auto_enrich_enabled', value: pappersAutoEnrichEnabled ? 'true' : 'false' }),
        updateSetting.mutateAsync({ key: 'pappers_auto_enrich_batch', value: String(Math.max(1, Math.min(100, pappersAutoEnrichBatch))) }),
      ]);
      toast({ title: 'Filtres Pappers sauvegardés' });
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

  const handlePromoteZone = async (zone: GeoZone) => {
    try {
      if (!zone.is_active) {
        await toggleActive.mutateAsync({ zoneId: zone.id, isActive: true });
      }
      const nextPriority = Math.min(
        98,
        Math.max(0, ...priorityZones.map(item => item.priority ?? 0)) + 1,
      );
      await updatePriority.mutateAsync({ zoneId: zone.id, priority: nextPriority });
      toast({ title: 'Zone ajoutée aux priorités commerciales' });
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
    toast({ title: 'Démarrage du scan…' });
    try {
      await runScan.mutateAsync();
      toast({
        title: 'Scan lancé',
        description: 'La collecte et l’analyse s’exécutent en arrière-plan. Le résultat apparaîtra dans l’historique.',
      });
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

      <Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v })} className="space-y-6">
        <TabsList className="grid w-full grid-cols-7 h-auto p-1">
          <TabsTrigger value="presse" className="text-xs sm:text-sm py-2">
            <Newspaper className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Presse
          </TabsTrigger>
          <TabsTrigger value="pappers" className="text-xs sm:text-sm py-2">
            <Building2 className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Pappers
          </TabsTrigger>
          <TabsTrigger value="cadeaux" className="text-xs sm:text-sm py-2">
            <Gift className="h-4 w-4 mr-1.5 hidden sm:inline" />
            Cadeaux
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
            planName={newsApiPlan?.plan_name || 'Non configuré'}
            periodLabel="day"
          />
          
          {/* Statistiques réelles : le ledger fournisseur n'est jamais réinitialisé depuis l'UI. */}
          <Card className="border-l-4 border-l-violet-500 bg-violet-500/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Newspaper className="h-5 w-5 text-violet-500" />
                  <div>
                    <p className="font-medium">Statistiques du jour</p>
                    {newsApiStats.lastFetch ? (
                      <p className="text-sm text-muted-foreground">
                        Dernière collecte {formatDistanceToNow(new Date(newsApiStats.lastFetch), { addSuffix: true, locale: fr })}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Aucune collecte aujourd'hui</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-violet-600">{newsApiStats.articles}</p>
                    <p className="text-xs text-muted-foreground">articles collectés</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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
                  <p className="text-xs text-muted-foreground">Requêtes avec CA trouvé</p>
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
                    La recherche Perplexity est désactivée. Le filtre CA reste actif avec une estimation fondée sur la taille déclarée par l'analyse Presse.
                  </p>
                </div>
              )}
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
                          {CATEGORY_CONFIG.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              <span className="inline-flex items-center gap-2">
                                <span aria-hidden="true">{category.emoji}</span>
                                {category.label}
                              </span>
                            </SelectItem>
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
                description="Les signaux sous ce seuil ne seront pas créés. Plancher absolu de 1M€."
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
            planName={pappersPlan?.plan_name || 'Non configuré'}
          />

          {/* Priorités géographiques partagées Presse + Pappers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-500" />
                Priorités géographiques
              </CardTitle>
              <CardDescription>
                Elles augmentent le score Presse et Pappers, sans exclure les autres régions françaises.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <h3 className="font-medium text-sm">Zones actives</h3>
                </div>
                {priorityZones.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center bg-muted/50 rounded-lg">
                    Aucune zone sélectionnée.
                  </p>
                ) : (
                  <div className="space-y-2">
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

              <div>
                <h3 className="font-medium text-sm mb-2">Autres régions</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {otherZones.map(zone => (
                    <div
                      key={zone.id}
                      className="flex items-center justify-between p-2 rounded-lg border hover:border-primary/50 hover:bg-muted/50 cursor-pointer text-sm"
                      onClick={() => handlePromoteZone(zone)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: zone.color || '#888' }} />
                        <span className="truncate">{zone.name}</span>
                        {!zone.is_active && <span className="text-xs text-muted-foreground">inactive</span>}
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
                        onValueChange={(value: 'anniversary' | 'creation') => setNewPappersQuery(prev => ({ ...prev, type: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="anniversary">Anniversaire d'entreprise</SelectItem>
                          <SelectItem value="creation">Création d'entreprise</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Les publications globales de nomination, capital et transfert ne sont pas proposées : Pappers n'y garantit pas l'identité de la société.
                      </p>
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
                  const isSupported = PAPPERS_SUPPORTED_QUERY_TYPES.has(query.type);
                  
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
                              {!isSupported && (
                                <Badge variant="outline" className="text-xs text-amber-700 border-amber-400">
                                  Identité société indisponible
                                </Badge>
                              )}
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
                            disabled={!isSupported || updatePappersQuery.isPending}
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
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-base font-medium">Enrichissement des contacts Pappers</Label>
                    <p className="text-sm text-muted-foreground">Autorise les enrichissements manuels et automatiques, sous réserve du forfait fournisseur.</p>
                  </div>
                  <Switch checked={pappersEnrichmentEnabled} onCheckedChange={setPappersEnrichmentEnabled} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-base font-medium">Enrichissement automatique après scan</Label>
                    <p className="text-sm text-muted-foreground">Enfile uniquement les signaux au-dessus du score général configuré.</p>
                  </div>
                  <Switch
                    checked={pappersAutoEnrichEnabled}
                    onCheckedChange={setPappersAutoEnrichEnabled}
                    disabled={!pappersEnrichmentEnabled}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Label htmlFor="pappers-auto-enrich-batch">Maximum par scan</Label>
                  <Input
                    id="pappers-auto-enrich-batch"
                    type="number"
                    min={1}
                    max={100}
                    value={pappersAutoEnrichBatch}
                    onChange={(event) => setPappersAutoEnrichBatch(Number(event.target.value))}
                    className="w-24"
                    disabled={!pappersEnrichmentEnabled || !pappersAutoEnrichEnabled}
                  />
                </div>
              </div>

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
                description="Les signaux sous ce seuil ne seront pas créés. Les données CA viennent directement de Pappers."
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

        {/* ========== TAB: CADEAUX ========== */}
        <TabsContent value="cadeaux" className="space-y-6">
          <GiftTemplatesTab />
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
              {/* Clés API : édition retirée (Critical sécurité). Les clés vivent en
                  secrets Edge Functions Supabase, jamais en clair dans l'app/la DB. */}
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary" />
                  Clés configurées côté serveur
                </p>
                <p className="text-sm text-muted-foreground">
                  Pour des raisons de sécurité, les clés API (NewsAPI, Claude, Apify,
                  Pappers, Dropcontact) ne sont plus éditables ici : elles sont stockées
                  comme secrets des Edge Functions et ne transitent jamais par le navigateur.
                </p>
                <p className="text-xs text-muted-foreground">
                  Pour les modifier : réglages backend → Edge Functions → Secrets.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Credits & Plans */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <PlanCard
              title="NewsAPI (Presse)"
              icon={<Newspaper className="h-5 w-5 text-violet-500" />}
              credits={newsApiCredits}
              threshold={newsApiThreshold}
              planName={newsApiPlanName}
              monthlyCredits={newsApiDailyRequests}
              limitLabel="Requêtes quotidiennes"
              onPlanNameChange={setNewsApiPlanName}
              onMonthlyCreditsChange={setNewsApiDailyRequests}
              onThresholdChange={setNewsApiThreshold}
              onSave={handleSaveNewsApi}
              getProgressColor={getProgressColor}
            />

            <PlanCard
              title="Apify (Scraping)"
              icon={<Newspaper className="h-5 w-5 text-blue-500" />}
              credits={apifyCredits}
              threshold={apifyThreshold}
              planName={apifyPlanName}
              monthlyCredits={apifyMonthlyRunLimit}
              limitLabel="Runs Actor autorisés sur la période"
              periodStart={apifyPeriodStart}
              periodEnd={apifyPeriodEnd}
              onPlanNameChange={setApifyPlanName}
              onMonthlyCreditsChange={setApifyMonthlyRunLimit}
              onPeriodStartChange={setApifyPeriodStart}
              onPeriodEndChange={setApifyPeriodEnd}
              onThresholdChange={setApifyThreshold}
              onSave={handleSaveApify}
              getProgressColor={getProgressColor}
            />
            <PlanCard
              title="Pappers (Données légales)"
              icon={<FileSearch className="h-5 w-5 text-emerald-500" />}
              credits={pappersCredits}
              threshold={pappersThreshold}
              planName={pappersPlanName}
              monthlyCredits={pappersMonthlyCredits}
              periodStart={pappersPeriodStart}
              periodEnd={pappersPeriodEnd}
              onPlanNameChange={setPappersPlanName}
              onMonthlyCreditsChange={setPappersMonthlyCredits}
              onPeriodStartChange={setPappersPeriodStart}
              onPeriodEndChange={setPappersPeriodEnd}
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

            <ProviderTokenTelemetryCard
              title="Perplexity (Recherche CA)"
              icon={<Cpu className="h-5 w-5 text-cyan-500" />}
              telemetry={perplexityTelemetry.data}
              isLoading={perplexityTelemetry.isLoading}
              isError={perplexityTelemetry.isError}
              unavailableCopy="Le solde et le forfait Perplexity ne sont pas exposés. Aucun pourcentage ni coût n'est déduit des tokens."
            />

            <DropcontactTelemetryCard
              balance={dropcontactBalance.data}
              isLoading={dropcontactBalance.isLoading}
              isError={dropcontactBalance.isError}
            />

            <ProviderTokenTelemetryCard
              title="Lovable AI"
              icon={<Zap className="h-5 w-5 text-fuchsia-500" />}
              telemetry={lovableAITelemetry.data}
              isLoading={lovableAITelemetry.isLoading}
              isError={lovableAITelemetry.isError}
              unavailableCopy="Le solde du Workspace Lovable n'est pas exposé. Aucun forfait, pourcentage ou coût n'est reconstruit localement."
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
                    {eligibleBatchStatus && eligibleBatchStatus.total_count > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                              {eligibleBatchStatus.ready_count} signal{eligibleBatchStatus.ready_count > 1 ? 'x' : ''} prêt{eligibleBatchStatus.ready_count > 1 ? 's' : ''} à enrichir
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              Comptage exact. Chaque action enfile au plus {RETROACTIVE_ENRICHMENT_BATCH_SIZE} signaux.
                              {eligibleBatchStatus.active_count > 0 && ` ${eligibleBatchStatus.active_count} déjà en file ou en cours.`}
                              {eligibleBatchStatus.cooldown_count > 0 && ` ${eligibleBatchStatus.cooldown_count} en délai de réessai.`}
                              {eligibleBatchStatus.manual_retry_required_count > 0 && ` ${eligibleBatchStatus.manual_retry_required_count} échec${eligibleBatchStatus.manual_retry_required_count > 1 ? 's' : ''} à relancer manuellement depuis le signal.`}
                            </p>
                          </div>
                          {eligibleBatchStatus.ready_count > 0 && <AlertDialog open={retroactiveDialogOpen} onOpenChange={setRetroactiveDialogOpen}>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700">
                                <Zap className="h-4 w-4 mr-1" />
                                Enfiler un lot
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Enrichissement rétroactif</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Enfiler maintenant jusqu'à {Math.min(eligibleBatchStatus.ready_count, RETROACTIVE_ENRICHMENT_BATCH_SIZE)} signal{Math.min(eligibleBatchStatus.ready_count, RETROACTIVE_ENRICHMENT_BATCH_SIZE) > 1 ? 's' : ''} ? Le worker les traitera dans la limite des quotas fournisseurs.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Annuler</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={async () => {
                                    setIsEnrichingRetroactive(true);
                                    try {
                                      const { data, error } = await supabase.rpc('enqueue_eligible_enrichment_batch', {
                                        p_min_score: parseInt(autoEnrichMinScore, 10),
                                        p_batch_size: RETROACTIVE_ENRICHMENT_BATCH_SIZE,
                                      });
                                      if (error) throw error;
                                      const result = data as unknown as EnrichmentBatchStatus;
                                      toast({
                                        title: `${result.enqueued_count || 0} enrichissement${result.enqueued_count === 1 ? '' : 's'} mis en file`,
                                        description: `${result.ready_count} restent prêts pour un prochain lot.`,
                                      });
                                      setRetroactiveDialogOpen(false);
                                      await queryClient.invalidateQueries({ queryKey: ['eligible-enrichment-batch-status'] });
                                      await queryClient.invalidateQueries({ queryKey: ['enrichment-jobs'] });
                                    } catch (error) {
                                      toast({
                                        title: 'Lot non lancé',
                                        description: error instanceof Error ? error.message : 'Erreur inconnue',
                                        variant: 'destructive',
                                      });
                                    } finally {
                                      setIsEnrichingRetroactive(false);
                                    }
                                  }}
                                  disabled={isEnrichingRetroactive}
                                >
                                  {isEnrichingRetroactive ? 'Mise en file…' : 'Confirmer le lot'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>}
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

interface ProviderTokenTelemetryCardProps {
  title: string;
  icon: React.ReactNode;
  telemetry?: TokenTelemetry;
  isLoading: boolean;
  isError: boolean;
  unavailableCopy: string;
}

function ProviderTokenTelemetryCard({
  title,
  icon,
  telemetry,
  isLoading,
  isError,
  unavailableCopy,
}: ProviderTokenTelemetryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>Mesures fournisseur exhaustives du mois en cours</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lecture du journal fournisseur…
          </div>
        ) : isError || !telemetry ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-700">Télémétrie indisponible</p>
            <p className="text-xs text-muted-foreground">Aucun zéro de remplacement n'est affiché.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <TelemetryMetric label="Appels mesurés" value={telemetry.totalRequests.toLocaleString('fr-FR')} />
              <TelemetryMetric label="Tokens exacts" value={telemetry.exactTokens.toLocaleString('fr-FR')} />
              <TelemetryMetric label="Avec compteur tokens" value={telemetry.tokenCountedRequests.toLocaleString('fr-FR')} />
              <TelemetryMetric label="Sans compteur tokens" value={telemetry.requestsWithoutTokenCount.toLocaleString('fr-FR')} warning={telemetry.requestsWithoutTokenCount > 0} />
            </div>
            <p className="text-xs text-muted-foreground">
              {telemetry.latestEventAt
                ? `Dernier appel ${formatDistanceToNow(new Date(telemetry.latestEventAt), { addSuffix: true, locale: fr })}.`
                : 'Aucun appel instrumenté ce mois.'}
              {' '}Les tokens ne sont additionnés que lorsque le fournisseur renvoie explicitement un compteur total.
            </p>
          </>
        )}
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{unavailableCopy}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TelemetryMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className={cn('text-xl font-bold', warning ? 'text-amber-600' : 'text-foreground')}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface DropcontactTelemetryCardProps {
  balance?: DropcontactBalanceStatus;
  isLoading: boolean;
  isError: boolean;
}

const DROPCONTACT_STATUS_COPY: Record<DropcontactBalanceStatus['measurementStatus'], string> = {
  current: 'Le dernier appel a retourné ce solde.',
  stale: 'Le dernier appel n\'a pas retourné de solde ; la dernière valeur observée est conservée.',
  unavailable: 'Des appels ont été observés, mais aucun solde exploitable n\'a été retourné.',
  not_started: 'Aucun appel instrumenté depuis le démarrage de cette mesure.',
};

function formatBalanceAge(seconds: number | null) {
  if (seconds === null) return 'inconnu';
  if (seconds < 60) return 'moins d’une minute';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} h`;
  return `${Math.floor(seconds / 86_400)} j`;
}

function DropcontactTelemetryCard({ balance, isLoading, isError }: DropcontactTelemetryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-orange-500" />
          Dropcontact (Emails)
        </CardTitle>
        <CardDescription>Dernier solde réellement retourné par l'API</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lecture du solde fournisseur…
          </div>
        ) : isError || !balance ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-700">Statut unavailable</p>
            <p className="text-xs text-muted-foreground">La mesure n'est pas accessible ; aucun solde n'est supposé.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-3xl font-bold">
                    {balance.creditsLeft === null ? '—' : balance.creditsLeft.toLocaleString('fr-FR')}
                  </p>
                  <p className="text-xs text-muted-foreground">crédits restants observés</p>
                </div>
                <Badge variant={balance.measurementStatus === 'current' ? 'secondary' : 'outline'}>
                  {balance.measurementStatus}
                </Badge>
              </div>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>{DROPCONTACT_STATUS_COPY[balance.measurementStatus]}</p>
              <p>
                Observation du solde : {balance.balanceObservedAt
                  ? new Date(balance.balanceObservedAt).toLocaleString('fr-FR')
                  : 'jamais'} · âge {formatBalanceAge(balance.balanceAgeSeconds)}
              </p>
              <p>
                Dernier appel : {balance.latestCallAt
                  ? new Date(balance.latestCallAt).toLocaleString('fr-FR')
                  : 'jamais'}
              </p>
            </div>
          </>
        )}
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Le forfait et la consommation Dropcontact ne sont pas exposés. Aucune consommation n'est déduite des variations de solde.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface PlanCardProps {
  title: string;
  icon: React.ReactNode;
  credits: { used: number; limit: number; percent: number; isWarning: boolean; isCritical: boolean; isMeasured?: boolean; measuredCurrency?: string };
  threshold: number;
  planName: string;
  monthlyCredits: number;
  limitLabel?: string;
  periodStart?: string;
  periodEnd?: string;
  onPlanNameChange: (value: string) => void;
  onMonthlyCreditsChange: (value: number) => void;
  onPeriodStartChange?: (value: string) => void;
  onPeriodEndChange?: (value: string) => void;
  onThresholdChange: (value: number) => void;
  onSave: () => void;
  extraField?: React.ReactNode;
  getProgressColor: (percent: number, threshold: number) => string;
}

function PlanCard({ title, icon, credits, threshold, planName, monthlyCredits, limitLabel = 'Crédits mensuels', periodStart, periodEnd, onPlanNameChange, onMonthlyCreditsChange, onPeriodStartChange, onPeriodEndChange, onThresholdChange, onSave, extraField, getProgressColor }: PlanCardProps) {
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
          {credits.isMeasured === false ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">Quota fournisseur indisponible</p>
              <p className="text-xs text-muted-foreground">
                La consommation autoritaire des runs Actor n'a pas pu être lue. Les nouveaux enrichissements restent bloqués jusqu'au retour de cette mesure.
              </p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Label>Nom du forfait</Label>
            <Input value={planName} onChange={(e) => onPlanNameChange(e.target.value)} />
          </div>
          <div>
            <Label>{limitLabel}</Label>
            <Input type="number" value={monthlyCredits} onChange={(e) => onMonthlyCreditsChange(Number(e.target.value))} min={0} />
          </div>
          {onPeriodStartChange && onPeriodEndChange && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Début de période</Label>
                <Input type="date" value={periodStart || ''} onChange={(e) => onPeriodStartChange(e.target.value)} />
              </div>
              <div>
                <Label>Fin de période</Label>
                <Input type="date" value={periodEnd || ''} onChange={(e) => onPeriodEndChange(e.target.value)} />
              </div>
            </div>
          )}
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
