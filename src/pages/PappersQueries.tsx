import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Plus, 
  Calendar, 
  Building2, 
  Award,
  Trash2,
  Edit,
  Play,
  Pause,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface PappersQuery {
  id: string;
  name: string;
  type: 'anniversary' | 'nomination' | 'capital_increase' | 'creation';
  is_active: boolean;
  parameters: {
    region?: string;
    code_naf?: string[];
    min_employees?: string;
    min_revenue?: number;
    years?: number[]; // For anniversaries: 10, 25, 50, 100
  };
  last_run_at?: string;
  signals_count: number;
}

const mockQueries: PappersQuery[] = [
  {
    id: '1',
    name: 'Anniversaires 10 ans - IDF',
    type: 'anniversary',
    is_active: true,
    parameters: {
      region: '11', // Île-de-France
      years: [10],
      min_employees: '20',
    },
    last_run_at: new Date().toISOString(),
    signals_count: 45,
  },
  {
    id: '2',
    name: 'Anniversaires 25 ans - Premium',
    type: 'anniversary',
    is_active: true,
    parameters: {
      region: '11',
      years: [25],
      min_employees: '50',
      min_revenue: 5000000,
    },
    signals_count: 12,
  },
  {
    id: '3',
    name: 'Nominations DG - Grandes entreprises',
    type: 'nomination',
    is_active: false,
    parameters: {
      min_employees: '100',
    },
    signals_count: 28,
  },
];

const QUERY_TYPE_CONFIG = {
  anniversary: { label: 'Anniversaire', icon: Calendar, color: 'text-amber-500' },
  nomination: { label: 'Nomination', icon: Award, color: 'text-blue-500' },
  capital_increase: { label: 'Augmentation capital', icon: Building2, color: 'text-emerald-500' },
  creation: { label: 'Création', icon: Building2, color: 'text-cyan-500' },
};

export default function PappersQueries() {
  const { toast } = useToast();
  const [queries, setQueries] = useState<PappersQuery[]>(mockQueries);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newQuery, setNewQuery] = useState({
    name: '',
    type: 'anniversary' as const,
    region: '11',
    years: '10',
    min_employees: '20',
  });

  const toggleQueryActive = (queryId: string) => {
    setQueries(prev => prev.map(q => 
      q.id === queryId ? { ...q, is_active: !q.is_active } : q
    ));
    toast({
      title: 'Requête mise à jour',
      description: 'Le statut de la requête a été modifié.',
    });
  };

  const handleAddQuery = () => {
    const query: PappersQuery = {
      id: Date.now().toString(),
      name: newQuery.name,
      type: newQuery.type,
      is_active: true,
      parameters: {
        region: newQuery.region,
        years: [parseInt(newQuery.years)],
        min_employees: newQuery.min_employees,
      },
      signals_count: 0,
    };
    setQueries(prev => [...prev, query]);
    setIsAddDialogOpen(false);
    setNewQuery({ name: '', type: 'anniversary', region: '11', years: '10', min_employees: '20' });
    toast({
      title: 'Requête créée',
      description: 'La nouvelle requête a été ajoutée.',
    });
  };

  const deleteQuery = (queryId: string) => {
    setQueries(prev => prev.filter(q => q.id !== queryId));
    toast({
      title: 'Requête supprimée',
      description: 'La requête a été supprimée.',
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/pappers">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Requêtes Pappers</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configurez vos critères de recherche de leads
            </p>
          </div>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle requête
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer une requête</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nom de la requête</Label>
                <Input 
                  placeholder="Ex: Anniversaires 10 ans - IDF"
                  value={newQuery.name}
                  onChange={(e) => setNewQuery(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Type de signal</Label>
                <Select 
                  value={newQuery.type} 
                  onValueChange={(value: any) => setNewQuery(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anniversary">Anniversaire d'entreprise</SelectItem>
                    <SelectItem value="nomination">Nomination dirigeant</SelectItem>
                    <SelectItem value="capital_increase">Augmentation de capital</SelectItem>
                    <SelectItem value="creation">Création d'entreprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newQuery.type === 'anniversary' && (
                <div className="space-y-2">
                  <Label>Années d'anniversaire</Label>
                  <Select 
                    value={newQuery.years} 
                    onValueChange={(value) => setNewQuery(prev => ({ ...prev, years: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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
                  value={newQuery.region} 
                  onValueChange={(value) => setNewQuery(prev => ({ ...prev, region: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                  value={newQuery.min_employees} 
                  onValueChange={(value) => setNewQuery(prev => ({ ...prev, min_employees: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleAddQuery} disabled={!newQuery.name}>
                Créer la requête
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Queries List */}
      <div className="space-y-4">
        {queries.map((query) => {
          const config = QUERY_TYPE_CONFIG[query.type];
          const Icon = config.icon;
          
          return (
            <Card key={query.id} className={!query.is_active ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg bg-muted ${config.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{query.name}</h3>
                        <Badge variant={query.is_active ? 'default' : 'secondary'}>
                          {query.is_active ? 'Actif' : 'Inactif'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {config.label} • {query.signals_count} signaux détectés
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        {query.parameters.region && (
                          <span className="bg-muted px-2 py-0.5 rounded">
                            {query.parameters.region === '11' ? 'Île-de-France' : query.parameters.region}
                          </span>
                        )}
                        {query.parameters.years && (
                          <span className="bg-muted px-2 py-0.5 rounded">
                            {query.parameters.years.join(', ')} ans
                          </span>
                        )}
                        {query.parameters.min_employees && (
                          <span className="bg-muted px-2 py-0.5 rounded">
                            {query.parameters.min_employees}+ employés
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={query.is_active}
                      onCheckedChange={() => toggleQueryActive(query.id)}
                    />
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" onClick={() => deleteQuery(query.id)} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info Card */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Signaux les plus pertinents</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Les <strong>anniversaires d'entreprise</strong> (10, 25, 50 ans) sont excellents pour offrir des cadeaux corporate.
                Les <strong>nominations de dirigeants</strong> sont idéales pour établir un premier contact.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
