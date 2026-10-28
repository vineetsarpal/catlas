import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

type Update = { event: { id:string; name:string; magnitude:number|null; latitude:number; longitude:number; occurredAt:string; updatedAt:string; aliases?:string[] }; productId:string; grid:string; detail?:string; capturedAt?:string };
/** Public HTTP fixture for an explicit source check; insured inputs cannot enter this request. */
export async function mockArchiveUpdate(page:Page, selected:()=>Update) {
  let checks=0, externalRequests=0;const originals=new Map<string,string>();
  await page.route('https://earthquake.usgs.gov/**',route=>{externalRequests++;return route.abort();});
  await page.route('**/api/exposure/captures/check',route=>{
    checks++;const update=selected(),event=update.event;
    expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({eventId:event.id});
    const detail=update.detail??JSON.stringify({id:event.id,properties:{mag:event.magnitude,place:event.name,time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt),ids:`,${[event.id,...event.aliases??[]].join(',')},`},geometry:{coordinates:[event.longitude,event.latitude,8]}});
    const artifact=(raw:string,kind:string)=>{const sha256=createHash('sha256').update(raw).digest('hex');originals.set(sha256,raw);return{sha256,bytes:Buffer.byteLength(raw),path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
    return route.fulfill({status:201,json:{schemaVersion:1,event:{...event,aliases:event.aliases??[event.id]},product:{id:update.productId,source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:update.capturedAt??event.updatedAt,artifacts:{detail:artifact(detail,'detail'),grid:artifact(update.grid,'grid')}}});
  });
  await page.route('**/api/exposure/artifacts/*',route=>{const text=originals.get(route.request().url().split('/').at(-1)!);return text===undefined?route.fallback():route.fulfill({body:text});});
  return {get checks(){return checks;},get externalRequests(){return externalRequests;}};
}
