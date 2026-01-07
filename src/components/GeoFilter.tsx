import { useState } from 'react';
import { MapPin, ChevronDown, Check, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useGeoZones, GeoZone } from '@/hooks/useGeoZones';
import { cn } from '@/lib/utils';

interface GeoFilterProps {
  selectedZones: string[];
  onZonesChange: (zones: string[]) => void;
  priorityOnly: boolean;
  onPriorityOnlyChange: (value: boolean) => void;
  className?: string;
}

export function GeoFilter({
  selectedZones,
  onZonesChange,
  priorityOnly,
  onPriorityOnlyChange,
  className,
}: GeoFilterProps) {
  const { data: zones = [], isLoading } = useGeoZones();

  const priorityZones = zones.filter(z => z.priority < 99);
  const otherZones = zones.filter(z => z.priority >= 99 && z.slug !== 'unknown');
  const unknownZone = zones.find(z => z.slug === 'unknown');

  const toggleZone = (zoneId: string) => {
    if (selectedZones.includes(zoneId)) {
      onZonesChange(selectedZones.filter(id => id !== zoneId));
    } else {
      onZonesChange([...selectedZones, zoneId]);
    }
  };

  const selectAllPriority = () => {
    const priorityIds = priorityZones.map(z => z.id);
    onZonesChange(priorityIds);
  };

  const selectAll = () => {
    onZonesChange(zones.map(z => z.id));
  };

  const clearAll = () => {
    onZonesChange([]);
  };

  const getSelectedLabel = () => {
    if (selectedZones.length === 0) return 'Toutes les zones';
    if (selectedZones.length === zones.length) return 'Toutes les zones';
    if (selectedZones.length === 1) {
      const zone = zones.find(z => z.id === selectedZones[0]);
      return zone?.name || '1 zone';
    }
    return `${selectedZones.length} zones`;
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <MapPin className="h-4 w-4" />
            {getSelectedLabel()}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Zones géographiques</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={selectAllPriority}
              >
                Prioritaires
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={clearAll}
              >
                Aucune
              </Button>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Zones prioritaires */}
          {priorityZones.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                Zones prioritaires
              </DropdownMenuLabel>
              {priorityZones.map(zone => (
                <DropdownMenuCheckboxItem
                  key={zone.id}
                  checked={selectedZones.includes(zone.id)}
                  onCheckedChange={() => toggleZone(zone.id)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span>{zone.name}</span>
                    {zone.is_default_priority && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        Défaut
                      </Badge>
                    )}
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          {/* Autres zones */}
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Autres régions
          </DropdownMenuLabel>
          <div className="max-h-48 overflow-y-auto">
            {otherZones.map(zone => (
              <DropdownMenuCheckboxItem
                key={zone.id}
                checked={selectedZones.includes(zone.id)}
                onCheckedChange={() => toggleZone(zone.id)}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: zone.color }}
                  />
                  <span>{zone.name}</span>
                </div>
              </DropdownMenuCheckboxItem>
            ))}
          </div>

          {/* Zone inconnue */}
          {unknownZone && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={selectedZones.includes(unknownZone.id)}
                onCheckedChange={() => toggleZone(unknownZone.id)}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: unknownZone.color }}
                  />
                  <span className="text-muted-foreground">{unknownZone.name}</span>
                </div>
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Toggle prioritaires uniquement */}
      <div className="flex items-center gap-2">
        <Switch
          id="priority-only"
          checked={priorityOnly}
          onCheckedChange={onPriorityOnlyChange}
        />
        <Label htmlFor="priority-only" className="text-sm cursor-pointer">
          Prioritaires uniquement
        </Label>
      </div>
    </div>
  );
}

// Badge pour afficher la zone d'un signal
interface GeoZoneBadgeProps {
  zoneName?: string | null;
  zoneColor?: string | null;
  priority?: number | null;
  city?: string | null;
  className?: string;
}

export function GeoZoneBadge({
  zoneName,
  zoneColor,
  priority,
  city,
  className,
}: GeoZoneBadgeProps) {
  if (!zoneName) return null;

  const isPriority = priority && priority < 99;

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 text-xs',
        isPriority && 'border-emerald-500/50 bg-emerald-500/10',
        className
      )}
    >
      {isPriority && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: zoneColor || '#9CA3AF' }}
      />
      <span>{city || zoneName}</span>
    </Badge>
  );
}

