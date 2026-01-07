import { useState } from 'react';
import { MapPin, Star, ArrowUp, ArrowDown, Check, X, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  useAllGeoZones,
  useUpdateGeoZonePriority,
  useToggleGeoZoneActive,
  useAddCityToZone,
  GeoZone,
} from '@/hooks/useGeoZones';
import { cn } from '@/lib/utils';

export default function GeoSettings() {
  const { toast } = useToast();
  const { data: zones = [], isLoading } = useAllGeoZones();
  const updatePriority = useUpdateGeoZonePriority();
  const toggleActive = useToggleGeoZoneActive();
  const addCity = useAddCityToZone();

  const [newCity, setNewCity] = useState<{ zoneId: string; value: string } | null>(null);

  const priorityZones = zones.filter(z => z.priority < 99 && z.slug !== 'unknown');
  const otherZones = zones.filter(z => z.priority >= 99 && z.slug !== 'unknown');
  const unknownZone = zones.find(z => z.slug === 'unknown');

  const handleSetPriority = async (zone: GeoZone, newPriority: number) => {
    try {
      await updatePriority.mutateAsync({ zoneId: zone.id, priority: newPriority });
      toast({
        title: newPriority < 99 ? 'Zone prioritaire' : 'Zone standard',
        description: `${zone.name} a été ${newPriority < 99 ? 'ajoutée aux priorités' : 'retirée des priorités'}.`,
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de modifier la priorité.',
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (zone: GeoZone) => {
    try {
      await toggleActive.mutateAsync({ zoneId: zone.id, isActive: !zone.is_active });
      toast({
        title: zone.is_active ? 'Zone désactivée' : 'Zone activée',
        description: `${zone.name} est maintenant ${zone.is_active ? 'masquée' : 'visible'}.`,
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de modifier le statut.',
        variant: 'destructive',
      });
    }
  };

  const handleAddCity = async () => {
    if (!newCity || !newCity.value.trim()) return;

    try {
      await addCity.mutateAsync({ zoneId: newCity.zoneId, city: newCity.value.trim() });
      toast({
        title: 'Ville ajoutée',
        description: `${newCity.value} a été ajoutée à la zone.`,
      });
      setNewCity(null);
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter la ville.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-medium text-foreground flex items-center gap-3">
          <MapPin className="h-8 w-8 text-primary" />
          Configuration géographique
        </h1>
          <p className="text-muted-foreground mt-2">
            Définissez vos zones prioritaires pour filtrer les signaux par région.
          </p>
        </div>

        {/* Zones prioritaires */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              Zones prioritaires
            </CardTitle>
            <CardDescription>
              Les signaux de ces zones apparaîtront en premier dans vos listes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {priorityZones.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">
                Aucune zone prioritaire configurée. Ajoutez-en depuis la liste ci-dessous.
              </p>
            ) : (
              <div className="space-y-3">
                {priorityZones.map((zone, index) => (
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
          </CardContent>
        </Card>

        {/* Autres zones */}
        <Card>
          <CardHeader>
            <CardTitle>Autres régions de France</CardTitle>
            <CardDescription>
              Cliquez sur une zone pour la passer en prioritaire.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {otherZones.map(zone => (
                <div
                  key={zone.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border transition-colors',
                    'hover:border-primary/50 hover:bg-muted/50 cursor-pointer',
                    !zone.is_active && 'opacity-50'
                  )}
                  onClick={() => handleSetPriority(zone, 1)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span className="font-medium">{zone.name}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="gap-1">
                    <ArrowUp className="h-4 w-4" />
                    Prioritaire
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Zone indéterminée */}
        {unknownZone && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-muted-foreground">Zone "Non déterminé"</CardTitle>
              <CardDescription>
                Les signaux sans localisation détectable sont classés ici avec la priorité la plus basse.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: unknownZone.color }}
                  />
                  <span>{unknownZone.name}</span>
                  <Badge variant="secondary">Priorité {unknownZone.priority}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Active</span>
                  <Switch
                    checked={unknownZone.is_active}
                    onCheckedChange={() => handleToggleActive(unknownZone)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}

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

function ZoneCard({
  zone,
  isPriority,
  onRemovePriority,
  onToggleActive,
  onAddCity,
  newCity,
  onNewCityChange,
  onNewCitySubmit,
  onNewCityCancel,
}: ZoneCardProps) {
  return (
    <div
      className={cn(
        'p-4 rounded-lg border',
        isPriority && 'border-emerald-500/50 bg-emerald-500/5'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: zone.color }}
          />
          <span className="font-semibold text-lg">{zone.name}</span>
          {zone.is_default_priority && (
            <Badge variant="secondary">Défaut</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isPriority && onRemovePriority && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemovePriority}
              className="text-muted-foreground hover:text-destructive"
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              Retirer
            </Button>
          )}
          <Switch
            checked={zone.is_active}
            onCheckedChange={onToggleActive}
          />
        </div>
      </div>

      {/* Départements */}
      <div className="mb-2">
        <span className="text-xs text-muted-foreground">Départements : </span>
        <span className="text-xs">{zone.departments.join(', ')}</span>
      </div>

      {/* Villes personnalisées */}
      {(zone.cities.length > 0 || newCity) && (
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
            {zone.cities.map(city => (
              <Badge key={city} variant="outline" className="text-xs">
                {city}
              </Badge>
            ))}
            {newCity && (
              <div className="flex items-center gap-1">
                <Input
                  value={newCity.value}
                  onChange={(e) => onNewCityChange(e.target.value)}
                  placeholder="Nom de la ville"
                  className="h-6 w-32 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNewCitySubmit();
                    if (e.key === 'Escape') onNewCityCancel();
                  }}
                />
                <Button size="sm" className="h-6 w-6 p-0" onClick={onNewCitySubmit}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onNewCityCancel}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

