import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forecastURL } from '@catlas/shared/wind';
const runAt='2026-10-19T18:00:00.000Z';
const meta={runAt,defaultTime:runAt,times:[runAt]};
const count=360*181;
function grid(patch:Record<string,unknown>={},bytes=new ArrayBuffer(count*8)) {
  const header={nx:360,ny:181,lo1:0,la1:90,dx:1,dy:1,runAt,validAt:runAt,sourceURL:forecastURL(runAt,runAt),decodeMs:1,...patch};
  return new Response(bytes,{headers:{'X-Wind-Metadata':JSON.stringify(header)}});
}
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_CATLAS_BACKEND','true');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('backend-only wind',()=>{
  it('makes no requests without a configured backend, including saved wind preferences',async()=>{
    vi.stubEnv('VITE_CATLAS_BACKEND','false');
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const {loadWindField}=await import('./wind');
    const {discoverBackendWind}=await import('./backend');
    await expect(loadWindField(meta,runAt,new AbortController().signal,()=>{})).rejects.toThrow('Wind requires the Catlas backend.');
    await expect(discoverBackendWind(new AbortController().signal)).rejects.toThrow('Wind requires the Catlas backend.');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('loads little-endian vectors from the backend and caches the validated field',async()=>{
    const bytes=new ArrayBuffer(count*8),view=new DataView(bytes);
    view.setFloat32(0,12.5,true);view.setFloat32(count*4,-7.25,true);
    const fetcher=vi.fn().mockResolvedValue(grid({},bytes));vi.stubGlobal('fetch',fetcher);
    const {loadWindField}=await import('./wind');
    const field=await loadWindField(meta,runAt,new AbortController().signal,()=>{});
    expect(field.u[0]).toBe(12.5);expect(field.v[0]).toBe(-7.25);
    expect(await loadWindField(meta,runAt,new AbortController().signal,()=>{})).toBe(field);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatch(/^\/api\/monitor\/wind\/grid\?/);
  });
  it.each([
    ['geometry',{dx:2}],['forecast',{validAt:'2026-10-19T21:00:00.000Z'}],['source',{sourceURL:'https://example.com/other'}],
  ])('rejects mismatched %s without caching it',async(_label,patch)=>{
    const fetcher=vi.fn().mockResolvedValueOnce(grid(patch)).mockResolvedValueOnce(grid());vi.stubGlobal('fetch',fetcher);
    const {loadWindField}=await import('./wind');
    await expect(loadWindField(meta,runAt,new AbortController().signal,()=>{})).rejects.toThrow('metadata');
    await expect(loadWindField(meta,runAt,new AbortController().signal,()=>{})).resolves.toMatchObject({runAt});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['length','values'])('rejects invalid grid %s',async(kind)=>{
    const bytes=new ArrayBuffer(kind==='length'?4:count*8);
    if(kind==='values')new DataView(bytes).setFloat32(0,NaN,true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(grid({},bytes)));
    const {loadWindField}=await import('./wind');
    await expect(loadWindField(meta,runAt,new AbortController().signal,()=>{})).rejects.toThrow(kind==='length'?'length':'values');
  });
  it('reports backend failure without falling back to NOAA and permits retry',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(grid());vi.stubGlobal('fetch',fetcher);
    const {loadWindField}=await import('./wind');
    await expect(loadWindField(meta,runAt,new AbortController().signal,()=>{})).rejects.toThrow('503');
    await expect(loadWindField(meta,runAt,new AbortController().signal,()=>{})).resolves.toMatchObject({runAt});
    expect(fetcher.mock.calls.every(([url])=>String(url).startsWith('/api/monitor/wind/grid?'))).toBe(true);
  });
});
