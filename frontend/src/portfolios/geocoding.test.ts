import { describe, expect, it, vi } from 'vitest';
import { parsePlaces } from './geocoding';
const point=(coordinates:unknown,properties:unknown={name:'City Hall',city:'Toronto',country:'Canada'})=>({geometry:{type:'Point',coordinates},properties});
describe('place search boundary',()=>{
  it('validates coordinates, ignores malformed results and deduplicates usable places',()=>{
    const valid=point([-79.38,43.65]);
    const results=parsePlaces({type:'FeatureCollection',features:[valid,valid,point([999,0]),point([0,91]),point([null,0]),{geometry:{type:'LineString',coordinates:[]}},point([1,2],{})]});
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({name:'City Hall',label:'City Hall, Toronto, Canada',longitude:-79.38,latitude:43.65});
  });
  it('uses a street address when the place has no name and accepts no matches',()=>{
    expect(parsePlaces({type:'FeatureCollection',features:[point([1,2],{street:'Main Street',housenumber:'10',city:'Town'})]})[0].name).toBe('10 Main Street');
    expect(parsePlaces({type:'FeatureCollection',features:[]})).toEqual([]);
    expect(()=>parsePlaces({type:'FeatureCollection',features:Array(21).fill(point([0,0]))})).toThrow();
    expect(()=>parsePlaces({features:[]})).toThrow();
  });
});


describe('suggestion request pacing',()=>{
 it('waits for the next provider slot and cancels queued requests without sending them',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('location',{origin:'http://127.0.0.1'});
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({type:'FeatureCollection',features:[]})));vi.stubGlobal('fetch',fetcher);
  try{
   vi.resetModules();const {searchPlaces}=await import('./geocoding');
   await searchPlaces('First query',new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(1);
   const queued=searchPlaces('Second query',new AbortController().signal);await vi.advanceTimersByTimeAsync(999);expect(fetcher).toHaveBeenCalledTimes(1);
   await vi.advanceTimersByTimeAsync(1);await queued;expect(fetcher).toHaveBeenCalledTimes(2);
   const controller=new AbortController();const cancelled=searchPlaces('Cancelled query',controller.signal);controller.abort();await expect(cancelled).rejects.toThrow();
   await vi.advanceTimersByTimeAsync(1000);expect(fetcher).toHaveBeenCalledTimes(2);
   await searchPlaces('First query',new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{vi.useRealTimers();vi.unstubAllGlobals();}
 });
});
