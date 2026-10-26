import { describe, expect, it } from 'vitest';
import { monitorBridge } from '../../../functions/_monitor';
const env={MONITOR_API_ORIGIN:'https://monitor.example.com',MONITOR_API_TOKEN:'a'.repeat(64)};
describe('hosted Monitor bridge',()=>{
  it('forwards only server credentials and the edge client identity; preserves binary wind metadata',async()=>{
    const request=new Request('https://catlas.test/api/monitor/wind/grid?runAt=run&validAt=valid',{headers:{authorization:'Bearer browser-secret',cookie:'private-cookie',origin:'https://catlas.test','cf-connecting-ip':'192.0.2.1','x-catlas-client-ip':'198.51.100.1'}});
    const response=await monitorBridge(request,env,async(input,init)=>{
      expect(String(input)).toBe('https://monitor.example.com/api/monitor/wind/grid?runAt=run&validAt=valid');
      const headers=new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${env.MONITOR_API_TOKEN}`);
      expect(headers.get('x-catlas-client-ip')).toBe('192.0.2.1');
      expect(headers.has('cookie')).toBe(false);expect(headers.has('origin')).toBe(false);
      expect(init?.redirect).toBe('manual');
      return new Response(new Uint8Array([0,1,2,255]),{headers:{'content-type':'application/octet-stream','x-wind-metadata':'{"runAt":"fixture"}','set-cookie':'secret=private'}});
    });
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0,1,2,255]);
    expect(response.headers.get('x-wind-metadata')).toBe('{"runAt":"fixture"}');
    expect(response.headers.has('set-cookie')).toBe(false);
  });
  it.each([
    ['POST','/api/monitor/wind'],['GET','/api/monitor/admin'],['GET','/api/monitor/constructor'],
    ['GET','/api/monitor/health?url=https://evil.test'],['GET','/api/monitor/wind/grid?runAt=a&runAt=b'],
    ['DELETE','/api/monitor/vessels/viewer?url=evil'],
  ])('refuses unsupported %s %s without contacting the VPS',async(method,path)=>{
    const response=await monitorBridge(new Request(`https://catlas.test${path}`,{method}),env,async()=>{throw Error('must not fetch');});
    expect([400,404]).toContain(response.status);
  });
  it('forwards explicit vessel release without a request body',async()=>{
    const response=await monitorBridge(new Request('https://catlas.test/api/monitor/vessels/viewer-1',{method:'DELETE'}),env,async(_,init)=>{expect(init?.method).toBe('DELETE');return Response.json({status:'released'});});
    expect(await response.json()).toEqual({status:'released'});
  });
  it.each(['http://monitor.example.com','https://monitor.example.com/path','https://user:password@monitor.example.com','https://monitor.example.com?token=secret'])('refuses misconfigured upstream %s',async(origin)=>{
    const response=await monitorBridge(new Request('https://catlas.test/api/monitor/health'),{...env,MONITOR_API_ORIGIN:origin});
    expect(response.status).toBe(503);
  });
  it.each([301,401,403,429,500,502])('sanitizes upstream %s and never returns credentials or diagnostics',async(status)=>{
    const response=await monitorBridge(new Request('https://catlas.test/api/monitor/health'),env,async()=>new Response(`${env.MONITOR_API_TOKEN} private diagnostics`,{status,headers:{location:'https://evil.test'}}));
    expect(response.ok).toBe(false);const text=await response.text();
    expect(text).not.toContain(env.MONITOR_API_TOKEN);expect(text).not.toContain('private');
    expect(response.headers.has('location')).toBe(false);
  });
  it('reports transport failure and missing configuration safely',async()=>{
    const request=new Request('https://catlas.test/api/monitor/health');
    expect((await monitorBridge(request,{})).status).toBe(503);
    const response=await monitorBridge(request,env,async()=>{throw Error('private network details');});
    expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');
  });
});
