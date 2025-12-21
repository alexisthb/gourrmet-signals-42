import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Cpu, 
  Newspaper, 
  FileSearch, 
  Save, 
  AlertTriangle,
  ArrowLeft,
  Settings2
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useManusPlanSettings, useManusCreditsSummary } from '@/hooks/useManusCredits';
import { useApifyPlanSettings, useApifyCreditsSummary } from '@/hooks/useApifyCredits';
import { usePappersPlanSettings, usePappersCreditsSummary } from '@/hooks/usePappersCredits';

export default function ApiSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Manus
  const { data: manusPlan, isLoading: manusLoading } = useManusPlanSettings();
  const manusCredits = useManusCreditsSummary();
  const [manusPlanName, setManusPlanName] = useState('');
  const [manusMonthlyCredits, setManusMonthlyCredits] = useState(0);
  const [manusThreshold, setManusThreshold] = useState(80);
  const [manusCostPerEnrichment, setManusCostPerEnrichment] = useState(1);

  // Apify
  const { data: apifyPlan, isLoading: apifyLoading } = useApifyPlanSettings();
  const apifyCredits = useApifyCreditsSummary();
  const [apifyPlanName, setApifyPlanName] = useState('');
  const [apifyMonthlyCredits, setApifyMonthlyCredits] = useState(0);
  const [apifyThreshold, setApifyThreshold] = useState(80);
  const [apifyCostPerScrape, setApifyCostPerScrape] = useState(0.5);

  // Pappers
  const { data: pappersPlan, isLoading: pappersLoading } = usePappersPlanSettings();
  const pappersCredits = usePappersCreditsSummary();
  const [pappersPlanName, setPappersPlanName] = useState('');
  const [pappersMonthlyCredits, setPappersMonthlyCredits] = useState(0);
  const [pappersThreshold, setPappersThreshold] = useState(80);
  const [pappersRateLimit, setPappersRateLimit] = useState(2);

  // Initialize form values when data loads
  useState(() => {
    if (manusPlan) {
      setManusPlanName(manusPlan.plan_name);
      setManusMonthlyCredits(manusPlan.monthly_credits);
      setManusThreshold(manusPlan.alert_threshold_percent);
      setManusCostPerEnrichment(manusPlan.cost_per_enrichment);
    }
  });

  useState(() => {
    if (apifyPlan) {
      setApifyPlanName(apifyPlan.plan_name);
      setApifyMonthlyCredits(apifyPlan.monthly_credits);
      setApifyThreshold(apifyPlan.alert_threshold_percent);
      setApifyCostPerScrape(apifyPlan.cost_per_scrape);
    }
  });

  useState(() => {
    if (pappersPlan) {
      setPappersPlanName(pappersPlan.plan_name);
      setPappersMonthlyCredits(pappersPlan.monthly_credits);
      setPappersThreshold(pappersPlan.alert_threshold_percent);
      setPappersRateLimit(pappersPlan.rate_limit_per_second);
    }
  });

  const handleSaveManus = async () => {
    try {
      const { error } = await supabase
        .from('manus_plan_settings')
        .upsert({
          id: manusPlan?.id || crypto.randomUUID(),
          plan_name: manusPlanName || manusPlan?.plan_name || 'Standard',
          monthly_credits: manusMonthlyCredits || manusPlan?.monthly_credits || 1000,
          alert_threshold_percent: manusThreshold,
          cost_per_enrichment: manusCostPerEnrichment,
        });

      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['manus-plan-settings'] });
      toast({ title: 'Forfait Manus sauvegardé' });
    } catch (error) {
      toast({ 
        title: 'Erreur', 
        description: error instanceof Error ? error.message : 'Erreur lors de la sauvegarde',
        variant: 'destructive' 
      });
    }
  };

  const handleSaveApify = async () => {
    try {
      const { error } = await supabase
        .from('apify_plan_settings')
        .upsert({
          id: apifyPlan?.id || crypto.randomUUID(),
          plan_name: apifyPlanName || apifyPlan?.plan_name || 'Starter',
          monthly_credits: apifyMonthlyCredits || apifyPlan?.monthly_credits || 5000,
          alert_threshold_percent: apifyThreshold,
          cost_per_scrape: apifyCostPerScrape,
        });

      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['apify-plan-settings'] });
      toast({ title: 'Forfait Apify sauvegardé' });
    } catch (error) {
      toast({ 
        title: 'Erreur', 
        description: error instanceof Error ? error.message : 'Erreur lors de la sauvegarde',
        variant: 'destructive' 
      });
    }
  };

  const handleSavePappers = async () => {
    try {
      const { error } = await supabase
        .from('pappers_plan_settings')
        .upsert({
          id: pappersPlan?.id || crypto.randomUUID(),
          plan_name: pappersPlanName || pappersPlan?.plan_name || 'Standard',
          monthly_credits: pappersMonthlyCredits || pappersPlan?.monthly_credits || 10000,
          alert_threshold_percent: pappersThreshold,
          rate_limit_per_second: pappersRateLimit,
        });

      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['pappers-plan-settings'] });
      toast({ title: 'Forfait Pappers sauvegardé' });
    } catch (error) {
      toast({ 
        title: 'Erreur', 
        description: error instanceof Error ? error.message : 'Erreur lors de la sauvegarde',
        variant: 'destructive' 
      });
    }
  };

  const getProgressColor = (percent: number, threshold: number) => {
    if (percent >= 100) return 'bg-destructive';
    if (percent >= threshold) return 'bg-destructive';
    if (percent >= threshold - 10) return 'bg-amber-500';
    return 'bg-primary';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Settings2 className="h-6 w-6 text-primary" />
              Configuration des Forfaits API
            </h1>
            <p className="text-sm text-muted-foreground">
              Gérez vos limites de crédits et seuils d'alerte
            </p>
          </div>
        </div>
      </div>

      {/* API Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Manus Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-violet-500" />
              Manus (Enrichissement)
            </CardTitle>
            <CardDescription>
              Crédits pour l'enrichissement des données entreprise et contacts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Usage */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Utilisation actuelle</span>
                <Badge variant={manusCredits.isCritical ? 'destructive' : manusCredits.isWarning ? 'outline' : 'secondary'}>
                  {manusCredits.percent}%
                </Badge>
              </div>
              <Progress 
                value={Math.min(manusCredits.percent, 100)} 
                className={`h-2 [&>div]:${getProgressColor(manusCredits.percent, manusThreshold)}`}
              />
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>{manusCredits.used.toLocaleString()} utilisés</span>
                <span>{manusCredits.limit.toLocaleString()} limite</span>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="manus-plan">Nom du forfait</Label>
                <Input
                  id="manus-plan"
                  defaultValue={manusPlan?.plan_name || 'Standard'}
                  onChange={(e) => setManusPlanName(e.target.value)}
                  placeholder="Standard"
                />
              </div>
              <div>
                <Label htmlFor="manus-credits">Crédits mensuels</Label>
                <Input
                  id="manus-credits"
                  type="number"
                  defaultValue={manusPlan?.monthly_credits || 1000}
                  onChange={(e) => setManusMonthlyCredits(Number(e.target.value))}
                  min={0}
                />
              </div>
              <div>
                <Label htmlFor="manus-cost">Coût par enrichissement</Label>
                <Input
                  id="manus-cost"
                  type="number"
                  defaultValue={manusPlan?.cost_per_enrichment || 1}
                  onChange={(e) => setManusCostPerEnrichment(Number(e.target.value))}
                  min={0}
                  step={0.1}
                />
              </div>
              <div>
                <Label className="flex items-center justify-between">
                  <span>Seuil d'alerte</span>
                  <span className="text-sm text-muted-foreground">{manusThreshold}%</span>
                </Label>
                <Slider
                  defaultValue={[manusPlan?.alert_threshold_percent || 80]}
                  onValueChange={(value) => setManusThreshold(value[0])}
                  max={100}
                  min={50}
                  step={5}
                  className="mt-2"
                />
              </div>
            </div>

            <Button onClick={handleSaveManus} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Sauvegarder
            </Button>
          </CardContent>
        </Card>

        {/* Apify Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-blue-500" />
              Apify (Scraping)
            </CardTitle>
            <CardDescription>
              Crédits pour le scraping LinkedIn et autres sources
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Usage */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Utilisation actuelle</span>
                <Badge variant={apifyCredits.isCritical ? 'destructive' : apifyCredits.isWarning ? 'outline' : 'secondary'}>
                  {apifyCredits.percent}%
                </Badge>
              </div>
              <Progress 
                value={Math.min(apifyCredits.percent, 100)} 
                className={`h-2 [&>div]:${getProgressColor(apifyCredits.percent, apifyThreshold)}`}
              />
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>{apifyCredits.used.toLocaleString()} utilisés</span>
                <span>{apifyCredits.limit.toLocaleString()} limite</span>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="apify-plan">Nom du forfait</Label>
                <Input
                  id="apify-plan"
                  defaultValue={apifyPlan?.plan_name || 'Starter'}
                  onChange={(e) => setApifyPlanName(e.target.value)}
                  placeholder="Starter"
                />
              </div>
              <div>
                <Label htmlFor="apify-credits">Crédits mensuels</Label>
                <Input
                  id="apify-credits"
                  type="number"
                  defaultValue={apifyPlan?.monthly_credits || 5000}
                  onChange={(e) => setApifyMonthlyCredits(Number(e.target.value))}
                  min={0}
                />
              </div>
              <div>
                <Label htmlFor="apify-cost">Coût par scrape</Label>
                <Input
                  id="apify-cost"
                  type="number"
                  defaultValue={apifyPlan?.cost_per_scrape || 0.5}
                  onChange={(e) => setApifyCostPerScrape(Number(e.target.value))}
                  min={0}
                  step={0.1}
                />
              </div>
              <div>
                <Label className="flex items-center justify-between">
                  <span>Seuil d'alerte</span>
                  <span className="text-sm text-muted-foreground">{apifyThreshold}%</span>
                </Label>
                <Slider
                  defaultValue={[apifyPlan?.alert_threshold_percent || 80]}
                  onValueChange={(value) => setApifyThreshold(value[0])}
                  max={100}
                  min={50}
                  step={5}
                  className="mt-2"
                />
              </div>
            </div>

            <Button onClick={handleSaveApify} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Sauvegarder
            </Button>
          </CardContent>
        </Card>

        {/* Pappers Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-emerald-500" />
              Pappers (Données légales)
            </CardTitle>
            <CardDescription>
              Crédits pour les recherches d'entreprises françaises
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Usage */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Utilisation actuelle</span>
                <Badge variant={pappersCredits.isCritical ? 'destructive' : pappersCredits.isWarning ? 'outline' : 'secondary'}>
                  {pappersCredits.percent}%
                </Badge>
              </div>
              <Progress 
                value={Math.min(pappersCredits.percent, 100)} 
                className={`h-2 [&>div]:${getProgressColor(pappersCredits.percent, pappersThreshold)}`}
              />
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>{pappersCredits.used.toLocaleString()} utilisés</span>
                <span>{pappersCredits.limit.toLocaleString()} limite</span>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="pappers-plan">Nom du forfait</Label>
                <Input
                  id="pappers-plan"
                  defaultValue={pappersPlan?.plan_name || 'Standard'}
                  onChange={(e) => setPappersPlanName(e.target.value)}
                  placeholder="Standard"
                />
              </div>
              <div>
                <Label htmlFor="pappers-credits">Crédits mensuels</Label>
                <Input
                  id="pappers-credits"
                  type="number"
                  defaultValue={pappersPlan?.monthly_credits || 10000}
                  onChange={(e) => setPappersMonthlyCredits(Number(e.target.value))}
                  min={0}
                />
              </div>
              <div>
                <Label htmlFor="pappers-rate">Requêtes par seconde</Label>
                <Input
                  id="pappers-rate"
                  type="number"
                  defaultValue={pappersPlan?.rate_limit_per_second || 2}
                  onChange={(e) => setPappersRateLimit(Number(e.target.value))}
                  min={1}
                  max={10}
                />
              </div>
              <div>
                <Label className="flex items-center justify-between">
                  <span>Seuil d'alerte</span>
                  <span className="text-sm text-muted-foreground">{pappersThreshold}%</span>
                </Label>
                <Slider
                  defaultValue={[pappersPlan?.alert_threshold_percent || 80]}
                  onValueChange={(value) => setPappersThreshold(value[0])}
                  max={100}
                  min={50}
                  step={5}
                  className="mt-2"
                />
              </div>
            </div>

            <Button onClick={handleSavePappers} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Sauvegarder
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Info Alert */}
      <Card className="bg-amber-500/10 border-amber-500/20">
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-foreground">À propos des seuils d'alerte</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Lorsque votre consommation atteint le seuil d'alerte configuré, une notification s'affiche sur le dashboard 
              et les cartes de crédits changent de couleur pour vous avertir. À 100%, les opérations seront bloquées.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
