import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitorQueryClient, startMonitorPolling, type Remote } from './query';

let client: ReturnType<typeof createMonitorQueryClient>;
let stop: (() => void) | undefined;
let documentEvents: EventTarget & { visibilityState: string };
let windowEvents: EventTarget;
let network: { onLine: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  windowEvents = new EventTarget();
  network = { onLine: true };
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('navigator', network);
  client = createMonitorQueryClient();
});
afterEach(() => {
  stop?.(); stop = undefined;
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Monitor feed lifecycle', () => {
  it('publishes fresh metadata even when values match so a failed wind grid can be retried', async () => {
    let state: Remote<{ times: string[] }> | undefined;
    const load = async () => ({ times: ['2026-10-29T12:00:00Z'] });
    stop = startMonitorPolling(client, 'wind', load, 1800000, next => { state = next; });
    await vi.advanceTimersByTimeAsync(0);
    const initial = state!.data;
    await vi.advanceTimersByTimeAsync(1800000);
    expect(state!.data).toEqual(initial);
    expect(state!.data).not.toBe(initial);
    expect(state!.checkedAt).toBe('2026-10-29T12:30:00.000Z');
  });

  it('retains successful observations and errors across stopped sessions and refreshes immediately on return', async () => {
    let state: Remote<number> | undefined;
    let complete: ((value: number) => void) | undefined;
    const load = vi.fn<(signal: AbortSignal) => Promise<number>>()
      .mockResolvedValueOnce(42)
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const publish = (next: Remote<number>) => { state = next; };
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, publish);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    const retained = { data: 42, checkedAt: '2026-10-29T12:00:00.000Z', error: 'Provider unavailable', loading: false };
    expect(state).toEqual(retained);
    stop(); stop = undefined;
    await vi.advanceTimersByTimeAsync(120000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(state).toEqual(retained);
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, publish);
    expect(load).toHaveBeenCalledTimes(3);
    expect(state).toEqual({ ...retained, loading: true });
    complete!(43);
    await vi.advanceTimersByTimeAsync(0);
    expect(state).toEqual({ data: 43, checkedAt: '2026-10-29T12:03:00.000Z', error: '', loading: false });
  });

  it('restarts an in-flight request and cadence on manual refresh without accepting its late completion', async () => {
    let state: Remote<number> | undefined;
    const signals: AbortSignal[] = [];
    const complete: ((value: number) => void)[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<number>(resolve => complete.push(resolve));
    });
    const publish = (next: Remote<number>) => { state = next; };
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, publish);
    await vi.advanceTimersByTimeAsync(10000);
    stop();
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, publish);
    expect(signals[0].aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    complete[0](99);
    complete[1](42);
    await vi.advanceTimersByTimeAsync(0);
    expect(state?.data).toBe(42);
    await vi.advanceTimersByTimeAsync(59999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps all six feed snapshots independent and ignores ordinary window focus', async () => {
    const feeds = ['earthquakes', 'cyclones', 'wind', 'fires', 'perimeters', 'alerts'] as const;
    const states = new Map<string, Remote<number>>();
    const loaders = feeds.map((_feed, index) => vi.fn(async () => index + 1));
    const stops = feeds.map((feed, index) => startMonitorPolling(client, feed, loaders[index], 60000, state => states.set(feed, state)));
    stop = () => stops.forEach(dispose => dispose());
    await vi.advanceTimersByTimeAsync(0);
    expect(feeds.map(feed => states.get(feed)?.data)).toEqual([1, 2, 3, 4, 5, 6]);
    windowEvents.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(loaders.map(load => load.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('limits each acquisition to 25 seconds without overlapping or automatically retrying', async () => {
    // Native AbortSignal.timeout uses real time, so replace only that clock boundary.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    let state: Remote<number> | undefined;
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<number>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    stop = startMonitorPolling(client, 'earthquakes', load, 10000, next => { state = next; });
    await vi.advanceTimersByTimeAsync(24999);
    expect(load).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);
    expect(state).toMatchObject({ loading: false, error: 'Deadline exceeded' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('retains the acquisition error during the next request and retries only on schedule', async () => {
    let state: Remote<number> | undefined;
    let complete: ((value: number) => void) | undefined;
    const load = vi.fn<(signal: AbortSignal) => Promise<number>>()
      .mockRejectedValueOnce(new Error('Source unavailable'))
      .mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, next => { state = next; });
    await vi.advanceTimersByTimeAsync(0);
    expect(state).toEqual({ data: null, checkedAt: '', error: 'Source unavailable', loading: false });
    await vi.advanceTimersByTimeAsync(59999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state).toEqual({ data: null, checkedAt: '', error: 'Source unavailable', loading: true });
    complete!(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(state).toEqual({ data: 7, checkedAt: '2026-10-29T12:01:00.000Z', error: '', loading: false });
  });

  it('publishes a successful feed immediately and refreshes on the fixed cadence', async () => {
    let state: Remote<number> | undefined;
    let complete: ((value: number) => void) | undefined;
    const load = vi.fn(() => new Promise<number>(resolve => { complete = resolve; }));
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, next => { state = next; });
    expect(state?.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    complete!(42);
    await vi.advanceTimersByTimeAsync(0);
    expect(state).toEqual({ data: 42, checkedAt: '2026-10-29T12:00:10.000Z', error: '', loading: false });
    await vi.advanceTimersByTimeAsync(49999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(state?.data).toBe(42);
  });

  it('aborts hidden, offline and stopped sessions and ignores late results', async () => {
    let state: Remote<number> | undefined;
    const signals: AbortSignal[] = [];
    const complete: ((value: number) => void)[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<number>(resolve => complete.push(resolve));
    });
    stop = startMonitorPolling(client, 'earthquakes', load, 60000, next => { state = next; });
    documentEvents.visibilityState = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(signals[0].aborted).toBe(true);
    complete[0](99);
    await vi.advanceTimersByTimeAsync(60000);
    expect(state).toEqual({ data: null, checkedAt: '', error: '', loading: false });
    expect(load).toHaveBeenCalledTimes(1);
    network.onLine = false;
    documentEvents.visibilityState = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(1);
    network.onLine = true;
    windowEvents.dispatchEvent(new Event('online'));
    expect(load).toHaveBeenCalledTimes(2);
    network.onLine = false;
    windowEvents.dispatchEvent(new Event('offline'));
    expect(signals[1].aborted).toBe(true);
    network.onLine = true;
    windowEvents.dispatchEvent(new Event('online'));
    expect(load).toHaveBeenCalledTimes(3);
    stop(); stop = undefined;
    expect(signals[2].aborted).toBe(true);
    complete[2](100);
    windowEvents.dispatchEvent(new Event('online'));
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(state?.data).toBeNull();
  });
});
