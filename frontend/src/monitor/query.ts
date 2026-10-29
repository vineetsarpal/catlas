import { QueryClient, QueryObserver } from '@tanstack/react-query';

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

/** Query owns feed state; a session timer preserves Monitor's fixed refresh cadence. */
export function startMonitorPolling<T>(client: QueryClient, feed: MonitorFeed, load: (signal: AbortSignal) => Promise<T>, interval: number, publish: (state: Remote<T>) => void): () => void {
  let disposed = false;
  const queryKey = ['monitor', feed] as const;
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: ({ signal }) => load(AbortSignal.any([signal, AbortSignal.timeout(25000)])),
  });
  // Query clears an initial error when retrying; Monitor keeps it until success.
  let error = observer.getCurrentResult().error?.message ?? '';
  const update = () => {
    const result = observer.getCurrentResult();
    if (result.error) error = result.error.message;
    else if (result.isSuccess) error = '';
    publish({
      data: result.data ?? null,
      checkedAt: result.dataUpdatedAt ? new Date(result.dataUpdatedAt).toISOString() : '',
      error,
      loading: result.isFetching,
    });
  };
  const unsubscribe = observer.subscribe(update);
  update();
  const refresh = () => {
    if (disposed) return;
    if (document.visibilityState !== 'visible' || !navigator.onLine) {
      void client.cancelQueries({ queryKey, exact: true });
      return;
    }
    void observer.refetch({ cancelRefetch: false });
  };
  refresh();
  const timer = setInterval(refresh, interval);
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    disposed = true;
    clearInterval(timer);
    void client.cancelQueries({ queryKey, exact: true });
    unsubscribe();
    window.removeEventListener('online', refresh);
    window.removeEventListener('offline', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
