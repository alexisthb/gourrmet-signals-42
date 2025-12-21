import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Plus, 
  Calendar, 
  Building2, 
  Award,
  Trash2,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { LoadingPage } from '@/components/LoadingSpinner';
import { 
  usePappersQueries, 
  useCreatePappersQuery, 
  useUpdatePappersQuery, 
  useDeletePappersQuery 
} from '@/hooks/usePappers';

const QUERY_TYPE_CONFIG: Record<string, { label: string; icon: typeof Calendar; color: string }> = {
  anniversary: { label: 'Anniversaire', icon: Calendar, color: 'text-amber-500' },
  nomination: { label: 'Nomination', icon: Award, color: 'text-blue-500' },
  capital_increase: { label: 'Augmentation capital', icon: Building2, color: 'text-emerald-500' },
  creation: { label: 'Création', icon: Building2, color: 'text-cyan-500' },
};

export default function PappersQueries() {
  const { data: queries, isLoading } = usePappersQueries();
  const createQuery = useCreatePappersQuery();
  const updateQuery = useUpdatePappersQuery();
  const deleteQuery = useDeletePappersQuery();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newQuery, setNewQuery] = useState({
    name: '',
    type: 'anniversary' as const,
    region: '11',
    years: '10',
    min_employees: '20',
  });

  if (isLoading) {
    return <LoadingPage />;
  }

  const toggleQueryActive = async (queryId: string, currentState: boolean) => {
    await updateQuery.mutateAsync({ id: queryId, is_active: !currentState });
  };

  const handleAddQuery = async () => {
    await createQuery.mutateAsync({
      name: newQuery.name,
      type: newQuery.type,
      is_active: true,
      parameters: {
        region: newQuery.region,
        years: [parseInt(newQuery.years)],
        min_employees: newQuery.min_employees,
      },
    });
    setIsAddDialogOpen(false);
    setNewQuery({ name: '', type: 'anniversary', region: '11', years: '10', min_employees: '20' });
  };

  const handleDeleteQuery = async (queryId: string) => {
    await deleteQuery.mutateAsync(queryId);
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
              <Button 
                onClick={handleAddQuery} 
                disabled={!newQuery.name || createQuery.isPending}
              >
                {createQuery.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Créer la requête'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Queries List */}
      <div className="space-y-4">
        {queries?.map((query) => {
          const config = QUERY_TYPE_CONFIG[query.type] || QUERY_TYPE_CONFIG.anniversary;
          const Icon = config.icon;
          const params = query.parameters || {};
          
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
                        {params.region && params.region !== 'all' && (
                          <span className="bg-muted px-2 py-0.5 rounded">
                            {params.region === '11' ? 'Île-de-France' : 
                             params.region === '84' ? 'Auvergne-Rhône-Alpes' : 
                             params.region === '93' ? 'PACA' : params.region}
                          </span>
                        )}
                        {params.years && (
                          <span className="bg-muted px-2 py-0.5 rounded">
                            {Array.isArray(params.years) ? params.years.join(', ') : params.years} ans
                          </span>
                        )}
                        {params.min_employees && (
                          <span className="bg-muted px-2 py-0.5 rounded">
                            {params.min_employees}+ employés
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={query.is_active}
                      onCheckedChange={() => toggleQueryActive(query.id, query.is_active)}
                      disabled={updateQuery.isPending}
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteQuery(query.id)}
                      disabled={deleteQuery.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {(!queries || queries.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="font-semibold text-lg">Aucune requête configurée</h3>
              <p className="text-muted-foreground mt-2">
                Créez votre première requête pour détecter des leads via Pappers.
              </p>
            </CardContent>
          </Card>
        )}
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
