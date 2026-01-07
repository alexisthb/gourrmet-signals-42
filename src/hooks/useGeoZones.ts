import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface GeoZone {
  id: string;
  name: string;
  slug: string;
  priority: number;
  departments: string[];
  postal_prefixes: string[];
  cities: string[];
  regions: string[];
  is_active: boolean;
  is_default_priority: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

// Note: La table geo_zones n'existe pas encore dans la base de données
// Ces hooks sont stub pour éviter les erreurs de build

export function useGeoZones() {
  return useQuery({
    queryKey: ['geo-zones'],
    queryFn: async () => {
      // Table non disponible - retourner un tableau vide
      return [] as GeoZone[];
    },
  });
}

export function useAllGeoZones() {
  return useQuery({
    queryKey: ['geo-zones-all'],
    queryFn: async () => {
      // Table non disponible - retourner un tableau vide
      return [] as GeoZone[];
    },
  });
}

export function usePriorityZones() {
  return useQuery({
    queryKey: ['geo-zones-priority'],
    queryFn: async () => {
      // Table non disponible - retourner un tableau vide
      return [] as GeoZone[];
    },
  });
}

export function useUpdateGeoZonePriority() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_params: { zoneId: string; priority: number }) => {
      throw new Error('Table geo_zones non disponible');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geo-zones'] });
      queryClient.invalidateQueries({ queryKey: ['geo-zones-all'] });
      queryClient.invalidateQueries({ queryKey: ['geo-zones-priority'] });
    },
  });
}

export function useToggleGeoZoneActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_params: { zoneId: string; isActive: boolean }) => {
      throw new Error('Table geo_zones non disponible');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geo-zones'] });
      queryClient.invalidateQueries({ queryKey: ['geo-zones-all'] });
    },
  });
}

export function useAddCityToZone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_params: { zoneId: string; city: string }) => {
      throw new Error('Table geo_zones non disponible');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geo-zones'] });
      queryClient.invalidateQueries({ queryKey: ['geo-zones-all'] });
    },
  });
}
