import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { discoverEarthquakes } from '../exposure/live';
import { discoverBackendWind } from './backend';
import { discoverCyclones } from './feeds';
import { discoverAlerts, discoverFires, discoverPerimeters } from './hazard-feeds';
import type { MonitorFeed, Remote } from './query';

const feeds = ['earthquakes', 'cyclones', 'wind', 'fires', 'perimeters', 'alerts'] as const;
const cadence: Record<MonitorFeed, number> = {
  earthquakes: 60_000, cyclones: 300_000, wind: 1_800_000,
  fires: 600_000, perimeters: 300_000, alerts: 60_000,
};
export const monitorFeedLoaders = {
  earthquakes: discoverEarthquakes, cyclones: discoverCyclones, wind: discoverBackendWind,
  fires: discoverFires, perimeters: discoverPerimeters, alerts: discoverAlerts,
};
export type MonitorData = { [K in MonitorFeed]: Awaited<ReturnType<typeof monitorFeedLoaders[K]>> };
type FeedData = Record<MonitorFeed, unknown>;
type Loaders<Data extends FeedData> = { [K in MonitorFeed]: (signal: AbortSignal) => Promise<Data[K]> };
export type MonitorSnapshot<Data extends FeedData> = { [K in MonitorFeed]: Remote<Data[K]> } & { now: number; online: boolean };
type ActiveFeed = { refresh: () => void; stop: () => void };
const empty = <T>(): Remote<T> => ({ data: null, checkedAt: '', error: '', loading: false });

/** One browser session owns fixed feed cadences, environment events and the display clock. */
export class MonitorSession<Data extends FeedData> {
  private state: MonitorSnapshot<Data> = {
    earthquakes: empty(), cyclones: empty(), wind: empty(), fires: empty(), perimeters: empty(), alerts: empty(),
    now: Date.now(), online: navigator.onLine,
  };
  private listeners = new Set<() => void>();
  private active = new Map<MonitorFeed, ActiveFeed>();
  private enabled = new Set<MonitorFeed>();
  private connected = false;
  constructor(private client: QueryClient, private loaders: Loaders<Data>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() { this.listeners.forEach(listener => listener()); }
  private updateFeed<K extends MonitorFeed>(feed: K, next: Remote<Data[K]>) {
    this.state = { ...this.state, [feed]: next };
    this.publish();
  }
  private tick = () => {
    const now = Date.now(), online = navigator.onLine;
    if (now === this.state.now && online === this.state.online) return;
    this.state = { ...this.state, now, online };
    this.publish();
  };
  private environmentChanged = () => {
    this.tick();
    this.active.forEach(entry => entry.refresh());
  };
  connect = () => {
    if (this.connected) throw new Error('Monitor session is already connected.');
    this.connected = true;
    this.tick();
    window.addEventListener('online', this.environmentChanged);
    window.addEventListener('offline', this.environmentChanged);
    document.addEventListener('visibilitychange', this.environmentChanged);
    const clock = setInterval(this.tick, 30_000);
    this.enabled.forEach(feed => this.start(feed));
    return () => {
      this.connected = false;
      clearInterval(clock);
      window.removeEventListener('online', this.environmentChanged);
      window.removeEventListener('offline', this.environmentChanged);
      document.removeEventListener('visibilitychange', this.environmentChanged);
      feeds.forEach(feed => this.stop(feed));
    };
  };
  /** Only changed toggles alter observers; view/filter/watch changes never restart acquisition. */
  configure = (enabledFeeds: readonly MonitorFeed[]) => {
    const next = new Set(enabledFeeds);
    feeds.forEach(feed => {
      if (!next.has(feed)) this.stop(feed);
      else if (this.connected && !this.active.has(feed)) this.start(feed);
    });
    this.enabled = next;
  };
  /** Explicit refresh cancels outstanding reads and resets each enabled feed's fixed cadence. */
  refresh = () => {
    if (!this.connected) return;
    this.enabled.forEach(feed => this.stop(feed));
    this.enabled.forEach(feed => this.start(feed));
  };
  private stop(feed: MonitorFeed) {
    const entry = this.active.get(feed);
    if (!entry) return;
    entry.stop();
    this.active.delete(feed);
  }
  private start<K extends MonitorFeed>(feed: K) {
    const queryKey = ['monitor', feed] as const;
    const observer = new QueryObserver(this.client, {
      queryKey,
      queryFn: ({ signal }) => this.loaders[feed](AbortSignal.any([signal, AbortSignal.timeout(25_000)])),
    });
    let disposed = false;
    // Query clears an initial error when retrying; Monitor retains it until success.
    let error = observer.getCurrentResult().error?.message ?? '';
    const update = () => {
      if (disposed) return;
      const result = observer.getCurrentResult();
      if (result.error) error = result.error.message;
      else if (result.isSuccess) error = '';
      this.updateFeed(feed, {
        data: result.data ?? null,
        checkedAt: result.dataUpdatedAt ? new Date(result.dataUpdatedAt).toISOString() : '',
        error, loading: result.isFetching,
      });
    };
    const unsubscribe = observer.subscribe(update);
    update();
    const refresh = () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible' || !navigator.onLine) {
        void this.client.cancelQueries({ queryKey, exact: true });
      } else void observer.refetch({ cancelRefetch: false });
    };
    const timer = setInterval(refresh, cadence[feed]);
    this.active.set(feed, {
      refresh,
      stop: () => {
        clearInterval(timer);
        // Publish cancellation's reverted state before disposing the subscription.
        void this.client.cancelQueries({ queryKey, exact: true });
        disposed = true;
        unsubscribe();
      },
    });
    refresh();
  }
}
