import { QueryClient } from '@tanstack/react-query';

export type MonitorFeed = 'earthquakes' | 'cyclones' | 'wind' | 'fires' | 'perimeters' | 'alerts';
export type Remote<T> = { data: T | null; checkedAt: string; error: string; loading: boolean };

export function createMonitorQueryClient() {
  const client = new QueryClient();
  client.setQueryDefaults(['monitor'], {
    enabled: false,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    networkMode: 'always',
    staleTime: 0,
    gcTime: Infinity,
    // Successful metadata refresh must retrigger wind-grid acquisition, even if unchanged.
    structuralSharing: false,
  });
  return client;
}
