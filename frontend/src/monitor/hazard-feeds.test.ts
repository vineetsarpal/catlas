import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeatherAlert } from '@catlas/shared/hazards';

const at='2026-10-20T12:00:00.000Z';
function alert(id:string,references:string[]=[],updatedAt=at):WeatherAlert{return {id,references,name:`Warning ${id}`,event:'Tornado Warning',severity:'Severe',certainty:'Observed',urgency:'Immediate',issuedAt:at,updatedAt,expiresAt:'2026-10-21T12:00:00.000Z',active:true,geometry:null,description:'',sourceUrl:'https://weather.gov/'};}
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_CATLAS_BACKEND','true');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('hazard acquisition',()=>{
  it('reports standalone availability without making an upstream request',async()=>{
    vi.stubEnv('VITE_CATLAS_BACKEND','false');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const {discoverFires,discoverAlerts,discoverPerimeters}=await import('./hazard-feeds');
    for(const load of [discoverFires,discoverAlerts,discoverPerimeters])await expect(load(new AbortController().signal)).rejects.toThrow('require the Catlas backend');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves partial and stale evidence metadata rather than disguising it as complete',async()=>{
    const data={fetchedAt:at,stale:true,warning:'One source unavailable',rejected:2,rows:[{id:'a',longitude:-120,latitude:40,detectedAt:at,source:'VIIRS',confidence:80}]};
    const fetcher=vi.fn().mockResolvedValue(Response.json(data));vi.stubGlobal('fetch',fetcher);
    const {discoverFires}=await import('./hazard-feeds');const signal=new AbortController().signal;
    await expect(discoverFires(signal)).resolves.toEqual(data);
    expect(fetcher).toHaveBeenCalledWith('/api/monitor/fires',{signal,cache:'no-store'});
  });
  it('rejects invalid coordinates and permits a subsequent successful retry',async()=>{
    const data={fetchedAt:at,stale:false,warning:'',rejected:0,rows:[]};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({...data,rows:[{id:'bad',longitude:500,latitude:40,detectedAt:at,source:'VIIRS',confidence:null}]})).mockResolvedValueOnce(Response.json(data)));
    const {discoverFires}=await import('./hazard-feeds');
    await expect(discoverFires(new AbortController().signal)).rejects.toThrow('Invalid hazard snapshot');
    await expect(discoverFires(new AbortController().signal)).resolves.toEqual(data);
  });
  it('retains useful missing-credential details from backend failures',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'Configure FIRMS_MAP_KEY'},{status:503})));
    const {discoverFires}=await import('./hazard-feeds');
    await expect(discoverFires(new AbortController().signal)).rejects.toThrow('Configure FIRMS_MAP_KEY');
  });
  it('rejects oversized responses while reading the stream',async()=>{
    const cancel=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(17*1024*1024));},cancel}))));
    const {discoverFires}=await import('./hazard-feeds');
    await expect(discoverFires(new AbortController().signal)).rejects.toThrow('supported limit');expect(cancel).toHaveBeenCalled();
  });
});
describe('alert continuity and preference migration',()=>{
  it('preserves analyst settings and old watches when introducing new feeds',async()=>{
    const {monitorPreferencesSchema}=await import('./useMonitor');
    const old={earthquakes:false,cyclones:true,wind:true,locations:false,nearPortfolio:true,watchedOnly:true,watchlist:[{key:'earthquake:existing',name:'Existing'}]};
    expect(monitorPreferencesSchema.parse(old)).toMatchObject({...old,fires:true,perimeters:true,alerts:true,fireDistanceKm:10});
    expect(monitorPreferencesSchema.parse({...old,fires:true,showFires:false})).not.toHaveProperty('showFires');
    expect(monitorPreferencesSchema.parse({...old,perimeters:true,showPerimeters:false})).not.toHaveProperty('showPerimeters');
    expect(monitorPreferencesSchema.parse({...old,alerts:true,showAlerts:false})).not.toHaveProperty('showAlerts');
    expect(monitorPreferencesSchema.safeParse({...old,fireDistanceKm:101}).success).toBe(false);
  });
  it('follows transitive updates across snapshots and retains ended references',async()=>{
    const {reconcileAlertWatches}=await import('./hazard-feeds');
    let watches=reconcileAlertWatches([{key:'alert:a',name:'Original'}],[alert('b',['a'])]);
    watches=reconcileAlertWatches(watches,[alert('c',['b'],'2026-10-20T13:00:00.000Z')]);
    expect(watches[0].key).toBe('alert:c');expect(watches[0].references).toEqual(expect.arrayContaining(['a','b']));
    expect(reconcileAlertWatches(watches,[])).toBe(watches);
    expect(reconcileAlertWatches(watches,[alert('b',['a'])])).toBe(watches);
    expect(reconcileAlertWatches(watches,[alert('d',['unrelated'])])).toBe(watches);
  });
  it('deduplicates watches that converge on the same alert and remaps selection',async()=>{
    const {reconcileAlertWatches,latestAlertKey}=await import('./hazard-feeds');const rows=[alert('c',['a','b'])];
    expect(reconcileAlertWatches([{key:'alert:a',name:'a'},{key:'alert:b',name:'b'}],rows)).toHaveLength(1);
    expect(latestAlertKey('alert:a',rows)).toBe('alert:c');expect(latestAlertKey('earthquake:a',rows)).toBe('earthquake:a');
  });
});
describe('Monitor polling lifecycle',()=>{
  it('aborts when hidden or disabled, resumes online, and ignores stale completion',async()=>{
    vi.useFakeTimers();const windowEvents=new EventTarget(),documentEvents=new EventTarget();
    const doc=Object.assign(documentEvents,{visibilityState:'visible'}),nav={onLine:true};
    vi.stubGlobal('window',windowEvents);vi.stubGlobal('document',doc);vi.stubGlobal('navigator',nav);
    const signals:AbortSignal[]=[],resolvers:((n:number)=>void)[]=[];
    const load=vi.fn((signal:AbortSignal)=>{signals.push(signal);return new Promise<number>(resolve=>resolvers.push(resolve));});
    const callbacks={loading:vi.fn(),data:vi.fn(),error:vi.fn()};
    const {startMonitorPolling}=await import('./hazard-feeds');const stop=startMonitorPolling(load,1000,callbacks);
    expect(load).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(2000);expect(load).toHaveBeenCalledTimes(1);
    doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));expect(signals[0].aborted).toBe(true);
    resolvers[0](1);await Promise.resolve();expect(callbacks.data).not.toHaveBeenCalled();
    nav.onLine=false;doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(2000);expect(load).toHaveBeenCalledTimes(1);
    nav.onLine=true;windowEvents.dispatchEvent(new Event('online'));expect(load).toHaveBeenCalledTimes(2);
    nav.onLine=false;windowEvents.dispatchEvent(new Event('offline'));expect(signals[1].aborted).toBe(true);
    nav.onLine=true;windowEvents.dispatchEvent(new Event('online'));expect(load).toHaveBeenCalledTimes(3);
    stop();expect(signals[2].aborted).toBe(true);await vi.advanceTimersByTimeAsync(5000);expect(load).toHaveBeenCalledTimes(3);
  });
});
