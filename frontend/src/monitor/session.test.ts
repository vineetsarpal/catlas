import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitorQueryClient, type MonitorFeed } from './query';
import { MonitorSession } from './session';

type Data = Record<MonitorFeed, unknown>;
type Loaders = { [K in MonitorFeed]: (signal: AbortSignal) => Promise<unknown> };
const feeds = ['earthquakes', 'cyclones', 'wind', 'fires', 'perimeters', 'alerts'] as const;
let client: ReturnType<typeof createMonitorQueryClient>;
let session: MonitorSession<Data>;
let disconnect: (() => void) | undefined;
let documentEvents: EventTarget & { visibilityState: string };
let windowEvents: EventTarget;
let network: { onLine: boolean };
function start(loaders: Partial<Loaders> = {}, enabled: readonly MonitorFeed[] = ['earthquakes']) {
  session = new MonitorSession<Data>(client, {
    earthquakes: async () => 1, cyclones: async () => 2, wind: async () => 3,
    fires: async () => 4, perimeters: async () => 5, alerts: async () => 6, ...loaders,
  });
  disconnect = session.connect();
  session.configure(enabled);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  windowEvents = new EventTarget(); network = { onLine: true };
  vi.stubGlobal('document', documentEvents); vi.stubGlobal('window', windowEvents); vi.stubGlobal('navigator', network);
  client = createMonitorQueryClient();
});
afterEach(() => {
  disconnect?.(); disconnect = undefined; client.clear();
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Monitor session interface', () => {
  it('publishes fresh metadata even when values match so a failed wind grid can be retried', async () => {
    start({ wind: async () => ({ times: ['2026-10-29T12:00:00Z'] }) }, ['wind']);
    await vi.advanceTimersByTimeAsync(0);
    const initial = session.getSnapshot().wind.data;
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(session.getSnapshot().wind.data).toEqual(initial);
    expect(session.getSnapshot().wind.data).not.toBe(initial);
    expect(session.getSnapshot().wind.checkedAt).toBe('2026-10-29T12:30:00.000Z');
  });

  it('retains observations and errors while inactive and refreshes immediately on return', async () => {
    let complete: ((value: number) => void) | undefined;
    const load = vi.fn<(signal: AbortSignal) => Promise<number>>()
      .mockResolvedValueOnce(42).mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    start({ earthquakes: load });
    await vi.advanceTimersByTimeAsync(60_000);
    const retained = { data: 42, checkedAt: '2026-10-29T12:00:00.000Z', error: 'Provider unavailable', loading: false };
    expect(session.getSnapshot().earthquakes).toEqual(retained);
    session.configure([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().earthquakes).toEqual(retained);
    session.configure(['earthquakes']);
    expect(load).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().earthquakes).toEqual({ ...retained, loading: true });
    complete!(43); await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().earthquakes).toEqual({ data: 43, checkedAt: '2026-10-29T12:03:00.000Z', error: '', loading: false });
  });

  it('manual refresh restarts a request and cadence while rejecting its late completion', async () => {
    const signals: AbortSignal[] = [], complete: ((value: number) => void)[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal); return new Promise<number>(resolve => complete.push(resolve));
    });
    start({ earthquakes: load });
    await vi.advanceTimersByTimeAsync(10_000); session.refresh();
    expect(signals[0].aborted).toBe(true); expect(load).toHaveBeenCalledTimes(2);
    complete[0](99); complete[1](42); await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().earthquakes.data).toBe(42);
    await vi.advanceTimersByTimeAsync(59_999); expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps six independent snapshots and ignores ordinary window focus', async () => {
    start({}, feeds); await vi.advanceTimersByTimeAsync(0);
    expect(feeds.map(feed => session.getSnapshot()[feed].data)).toEqual([1, 2, 3, 4, 5, 6]);
    const before = session.getSnapshot();
    windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toBe(before);
  });

  it('limits acquisition to 25 seconds without overlapping or automatic retries', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<number>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    start({ earthquakes: load });
    // Repeated environment events cannot overlap an acquisition.
    windowEvents.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(24_999);
    expect(load).toHaveBeenCalledTimes(1); expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);
    expect(session.getSnapshot().earthquakes).toMatchObject({ loading: false, error: 'Deadline exceeded' });
    await vi.advanceTimersByTimeAsync(34_999); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(2);
  });

  it('retains the acquisition error during the next request and retries only on schedule', async () => {
    let complete: ((value: number) => void) | undefined;
    const load = vi.fn<(signal: AbortSignal) => Promise<number>>()
      .mockRejectedValueOnce(new Error('Source unavailable'))
      .mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    start({ earthquakes: load }); await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().earthquakes).toEqual({ data: null, checkedAt: '', error: 'Source unavailable', loading: false });
    await vi.advanceTimersByTimeAsync(59_999); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getSnapshot().earthquakes).toEqual({ data: null, checkedAt: '', error: 'Source unavailable', loading: true });
    complete!(7); await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().earthquakes).toEqual({ data: 7, checkedAt: '2026-10-29T12:01:00.000Z', error: '', loading: false });
  });

  it('publishes success immediately while retaining start-based fixed cadence', async () => {
    let complete: ((value: number) => void) | undefined;
    const load = vi.fn(() => new Promise<number>(resolve => { complete = resolve; }));
    start({ earthquakes: load }); expect(session.getSnapshot().earthquakes.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000); complete!(42); await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().earthquakes).toEqual({ data: 42, checkedAt: '2026-10-29T12:00:10.000Z', error: '', loading: false });
    await vi.advanceTimersByTimeAsync(49_999); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(2);
  });

  it('aborts hidden, offline and disconnected sessions and ignores late results', async () => {
    const signals: AbortSignal[] = [], complete: ((value: number) => void)[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal); return new Promise<number>(resolve => complete.push(resolve));
    });
    start({ earthquakes: load });
    documentEvents.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(signals[0].aborted).toBe(true); complete[0](99);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.getSnapshot().earthquakes).toEqual({ data: null, checkedAt: '', error: '', loading: false });
    expect(load).toHaveBeenCalledTimes(1);
    network.onLine = false; documentEvents.visibilityState = 'visible'; documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(1);
    network.onLine = true; windowEvents.dispatchEvent(new Event('online')); expect(load).toHaveBeenCalledTimes(2);
    network.onLine = false; windowEvents.dispatchEvent(new Event('offline')); expect(signals[1].aborted).toBe(true);
    network.onLine = true; windowEvents.dispatchEvent(new Event('online')); expect(load).toHaveBeenCalledTimes(3);
    disconnect!(); disconnect = undefined;
    expect(signals[2].aborted).toBe(true); complete[2](100);
    windowEvents.dispatchEvent(new Event('online')); documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(3); expect(session.getSnapshot().earthquakes.data).toBeNull();
  });

  it('diffs enabled feeds without restarting unaffected observers or their cadence', async () => {
    const earthquake = vi.fn(async () => 1), cyclone = vi.fn(async () => 2);
    start({ earthquakes: earthquake, cyclones: cyclone }); await vi.advanceTimersByTimeAsync(10_000);
    session.configure(['earthquakes', 'cyclones']); session.configure(['cyclones', 'earthquakes']);
    expect(earthquake).toHaveBeenCalledTimes(1); expect(cyclone).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50_000); expect(earthquake).toHaveBeenCalledTimes(2);
    expect(cyclone).toHaveBeenCalledTimes(1);
    session.configure(['earthquakes']); await vi.advanceTimersByTimeAsync(300_000);
    expect(cyclone).toHaveBeenCalledTimes(1);
  });

  it('uses every fixed cadence independently', async () => {
    const loaders = {
      earthquakes: vi.fn(async () => 1), cyclones: vi.fn(async () => 2), wind: vi.fn(async () => 3),
      fires: vi.fn(async () => 4), perimeters: vi.fn(async () => 5), alerts: vi.fn(async () => 6),
    };
    start(loaders, feeds); await vi.advanceTimersByTimeAsync(1_800_000);
    expect(feeds.map(feed => loaders[feed].mock.calls.length)).toEqual([31, 7, 2, 4, 7, 31]);
  });

  it('shares one environment listener set, keeps an inactive display clock and cleans up on reconnect', async () => {
    const windowAdd = vi.spyOn(windowEvents, 'addEventListener'), documentAdd = vi.spyOn(documentEvents, 'addEventListener');
    const windowRemove = vi.spyOn(windowEvents, 'removeEventListener'), documentRemove = vi.spyOn(documentEvents, 'removeEventListener');
    start({}, feeds); await vi.advanceTimersByTimeAsync(0);
    expect(windowAdd.mock.calls.map(call => call[0])).toEqual(['online', 'offline']);
    expect(documentAdd.mock.calls.map(call => call[0])).toEqual(['visibilitychange']);
    session.configure([]); const now = session.getSnapshot().now;
    await vi.advanceTimersByTimeAsync(30_000); expect(session.getSnapshot().now).toBe(now + 30_000);
    network.onLine = false; windowEvents.dispatchEvent(new Event('offline'));
    expect(session.getSnapshot().online).toBe(false);
    disconnect!(); expect(windowRemove).toHaveBeenCalledTimes(2); expect(documentRemove).toHaveBeenCalledTimes(1);
    const disconnected = session.getSnapshot(); await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getSnapshot()).toBe(disconnected);
    disconnect = session.connect();
    expect(windowAdd).toHaveBeenCalledTimes(4); expect(documentAdd).toHaveBeenCalledTimes(2);
  });
});
