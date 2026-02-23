import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

/**
 * Persists filter state in URL search params so filters survive navigation.
 * Usage: const [filters, setFilters] = usePersistedFilters(defaultFilters);
 */
export function usePersistedFilters<T extends Record<string, string | number>>(
  defaults: T
): [T, (updates: Partial<T>) => void, () => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const param = searchParams.get(key);
      if (param !== null) {
        const defaultVal = defaults[key];
        if (typeof defaultVal === 'number') {
          (result as any)[key] = parseInt(param, 10) || defaultVal;
        } else {
          (result as any)[key] = param;
        }
      }
    }
    return result;
  }, [searchParams, defaults]);

  const setFilters = useCallback(
    (updates: Partial<T>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === defaults[key as keyof T]) {
            next.delete(key); // Don't clutter URL with defaults
          } else {
            next.set(key, String(value));
          }
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams, defaults]
  );

  const resetFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return [filters, setFilters, resetFilters];
}
