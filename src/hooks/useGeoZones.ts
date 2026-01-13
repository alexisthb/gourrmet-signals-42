import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type GeoZone = Tables<'geo_zones'>;

export function useGeoZones() {
  return useQuery({
    queryKey: ['geo-zones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geo_zones')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (error) throw error;
      return data || [];
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
        .order('priority', { ascending: true });

      if (error) throw error;
      return data || [];
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
        .eq('is_default_priority', true)
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });
}

export function useUpdateGeoZonePriority() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ zoneId, priority }: { zoneId: string; priority: number }) => {
      const { error } = await supabase
        .from('geo_zones')
        .update({ priority })
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
        .update({ is_active: isActive })
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
      // Get current cities
      const { data: zone, error: fetchError } = await supabase
        .from('geo_zones')
        .select('cities')
        .eq('id', zoneId)
        .single();

      if (fetchError) throw fetchError;

      const currentCities = zone?.cities || [];
      const updatedCities = [...currentCities, city];

      const { error } = await supabase
        .from('geo_zones')
        .update({ cities: updatedCities })
        .eq('id', zoneId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geo-zones'] });
      queryClient.invalidateQueries({ queryKey: ['geo-zones-all'] });
    },
  });
}
