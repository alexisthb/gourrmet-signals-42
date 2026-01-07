import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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

export function useGeoZones() {
  return useQuery({
    queryKey: ['geo-zones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geo_zones')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return data as GeoZone[];
    },
  });
}

export function useAllGeoZones() {
  return useQuery({
    queryKey: ['geo-zones-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geo_zones')
        .select('*')
        .order('priority', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      return data as GeoZone[];
    },
  });
}

export function usePriorityZones() {
  return useQuery({
    queryKey: ['geo-zones-priority'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geo_zones')
        .select('*')
        .eq('is_active', true)
        .lt('priority', 99)
        .order('priority', { ascending: true });

      if (error) throw error;
      return data as GeoZone[];
    },
  });
}

export function useUpdateGeoZonePriority() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ zoneId, priority }: { zoneId: string; priority: number }) => {
      const { error } = await supabase
        .from('geo_zones')
        .update({ 
          priority,
          is_default_priority: priority === 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', zoneId);

      if (error) throw error;
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
    mutationFn: async ({ zoneId, isActive }: { zoneId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('geo_zones')
        .update({ 
          is_active: isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', zoneId);

      if (error) throw error;
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
    mutationFn: async ({ zoneId, city }: { zoneId: string; city: string }) => {
      // Récupérer les villes actuelles
      const { data: zone, error: fetchError } = await supabase
        .from('geo_zones')
        .select('cities')
        .eq('id', zoneId)
        .single();

      if (fetchError) throw fetchError;

      const cities = [...(zone.cities || []), city];

      const { error } = await supabase
        .from('geo_zones')
        .update({ 
          cities,
          updated_at: new Date().toISOString()
        })
        .eq('id', zoneId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geo-zones'] });
      queryClient.invalidateQueries({ queryKey: ['geo-zones-all'] });
    },
  });
}

