import { openExport, openEvidence } from '../helpers/exposure-workspace';
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';

const event={id:'cat53-event',name:'Synthetic CAT53 earthquake',magnitude:6.2,longitude:-117.5,latitude:35.5,occurredAt:'2019-07-06T03:19:53.000Z',updatedAt:'2026-10-24T11:00:00.000Z',aliases:['cat53-event'],significance:700};
const gridUrl='https://earthquake.usgs.gov/product/cat53/grid.xml';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const grid=(version:number)=>`<shakemap_grid event_id="${event.id}" shakemap_version="${version}" process_timestamp="2026-10-24T11:00:00Z"><event event_id="${event.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 ${version===1?3:6}\n-117 36 ${version===1?3:6}\n-118 35 ${version===1?3:6}\n-117 35 ${version===1?3:6}</grid_data></shakemap_grid>`;
const detail=(version:number)=>JSON.stringify({id:event.id,properties:{mag:event.magnitude,place:event.name,time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt),ids:`,${event.id},`,products:{shakemap:[{id:`cat53-product-${version}`,source:'us',code:event.id,status:'UPDATE',updateTime:Date.parse(event.updatedAt),contents:{'download/grid.xml':{url:gridUrl}}}]}},geometry:{coordinates:[event.longitude,event.latitude,8]}});
async function setup(page:Page){
 let version=1,fail=false,productOnly=false,timestampOnly=false,canonicalAlias=false; const raw=new Map<string,string>();
 const artifact=(text:string,kind:string)=>{const sha256=hash(text);raw.set(sha256,text);return{sha256,bytes:Buffer.byteLength(text),path:`/api/artifacts/${sha256}`,sourceUrl:kind==='grid'?gridUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const originals={grid:artifact(grid(1),'grid'),detail:artifact(detail(1),'detail')};
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:{events:[event],checkedAt:event.updatedAt,range:{start:'2026-07-28T00:00:00.000Z',end:'2026-10-26T00:00:00.000Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}}));
 await page.route('**/api/exposure/captures',route=>{expect(route.request().postDataJSON()).toEqual({eventId:event.id});return route.fulfill({status:201,json:{schemaVersion:1,event,product:{id:'cat53-product-1',source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:'2026-10-25T18:00:00.000Z',artifacts:originals}});});
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:raw.get(route.request().url().split('/').at(-1)!)!}));
 await page.route('**/api/exposure/captures/check',route=>{
  expect(route.request().postDataJSON()).toEqual({eventId:event.id});
  if(fail)return route.fulfill({status:503,json:{error:{code:'source_unavailable'}}});
  const updatedEvent=canonicalAlias?{...event,id:'cat53-canonical',aliases:[event.id,'cat53-canonical']}:timestampOnly?{...event,updatedAt:'2026-10-24T11:00:01.000Z'}:event;
  const sourceDetail=canonicalAlias?detail(version).replaceAll(event.id,'cat53-canonical').replace(',cat53-canonical,',`,${event.id},cat53-canonical,`):timestampOnly?detail(version).replace(String(Date.parse(event.updatedAt)),String(Date.parse(updatedEvent.updatedAt))):detail(version);
  return route.fulfill({json:{schemaVersion:1,event:updatedEvent,product:{id:`cat53-product-${version}`,source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:'2026-10-27T11:00:00.000Z',artifacts:{grid:artifact(grid(productOnly?1:version),'grid'),detail:artifact(sourceDetail,'detail')}}});
 });
 await page.goto('/exposure.html');await page.getByRole('button',{name:'Portfolio',exact:true}).click();await page.getByRole('button',{name:'Create portfolio',exact:true}).click();const form=page.getByRole('form',{name:'Create portfolio',exact:true});await form.getByLabel('Portfolio name',{exact:true}).fill('CAT53 holdings');await form.getByLabel('Source',{exact:true}).fill('CAT53 supplied holdings');await form.getByLabel('As-of date',{exact:true}).fill('2026-10-20');await form.getByRole('button',{name:'Save portfolio',exact:true}).click();await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Import CSV',exact:true}).click();await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'cat53.csv',mimeType:'text/csv',buffer:Buffer.from('location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\nONE,Original location,-117.5,35.5,100,CAD,West,Commercial\nTWO,Second location,-117.6,35.6,200,CAD,West,Commercial\n')});await page.getByLabel('I have reviewed the changes and excluded rows.').check();await page.getByRole('button',{name:'Apply import',exact:true}).click();await expect(page.getByRole('button',{name:'Apply import',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.locator('.catalog-event-list li').filter({hasText:event.id}).getByRole('button').click();await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 return {setVersion:(value:number)=>version=value,setFailed:(value:boolean)=>fail=value,setProductOnly:()=>productOnly=true,setTimestampOnly:()=>timestampOnly=true,setCanonicalAlias:()=>canonicalAlias=true};
}
async function bundle(page:Page){
 if(await page.getByRole('button',{name:'Locations',exact:true}).getAttribute('aria-expanded')!=='true')await page.getByRole('button',{name:'Locations',exact:true}).click();
 const downloading=page.waitForEvent('download');await openExport(page);await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();return JSON.parse(gunzipSync(await fs.readFile((await (await downloading).path())!)).toString());
}
async function check(page:Page){await openEvidence(page);await page.getByRole('button',{name:'Check source for updates',exact:true}).click();await expect(page.getByRole('button',{name:'Check source for updates',exact:true})).toBeEnabled();}
async function apply(page:Page){await openEvidence(page);await page.getByRole('button',{name:'Apply selected evidence as new version',exact:true}).click();}

test('source checks expose selected revised capture before Apply and retain frozen original holdings',async({page},testInfo)=>{
 if(testInfo.project.name==='desktop')await page.setViewportSize({width:1440,height:1000});
 const source=await setup(page);const v1=await bundle(page);source.setVersion(2);await check(page);
 const pending=page.getByRole('region',{name:'Captured update to apply'});
 await expect(pending).toContainText('cat53-product-2');await expect(pending).toContainText(hash(grid(2)));
 await expect(page.locator('body')).toHaveJSProperty('scrollWidth',await page.locator('body').evaluate(el=>el.clientWidth));await fs.mkdir('output/playwright',{recursive:true});await page.screenshot({path:`output/playwright/cat53-pending-${testInfo.project.name}.png`,fullPage:true});await pending.scrollIntoViewIfNeeded();await pending.screenshot({path:`output/playwright/cat53-pending-detail-${testInfo.project.name}.png`});
 expect(await bundle(page)).toEqual(v1);
 await page.getByRole('button',{name:'Portfolio',exact:true}).click();
 if(!await page.getByRole('table',{name:'Insured location inventory'}).isVisible())await page.getByRole('button',{name:/Show locations/}).click();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete Second location',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();
 await apply(page);const v2=await bundle(page);expect(v2.record).toMatchObject({caseId:v1.record.caseId,version:2,previousId:v1.record.id,portfolio:v1.record.portfolio,portfolioReference:v1.record.portfolioReference,portfolioHash:v1.record.portfolioHash,settings:v1.record.settings});expect(v2.record.summary.meetingThreshold).toBe(2);expect(v2.rawXml).toBe(grid(2));
 await page.getByRole('button',{name:'Save investigation',exact:true}).click();await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();expect(await bundle(page)).toEqual(v1);
 await page.getByRole('button',{name:'Investigate latest portfolio',exact:true}).click();const latest=await bundle(page);expect(latest.record.portfolio.locations).toHaveLength(1);expect(latest.record.version).toBe(3);expect(latest.record.previousId).toBe(v2.record.id);
 await page.getByRole('button',{name:'Save investigation',exact:true}).click();await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByLabel('Open a self-contained case').setInputFiles({name:'older-v1.json.gz',mimeType:'application/gzip',buffer:gzipSync(JSON.stringify(v1))});await expect(page.getByRole('button',{name:'Open saved version 3',exact:true})).toBeVisible();
 await check(page);await apply(page);const resumed=await bundle(page);expect(resumed.record).toMatchObject({version:4,caseId:v1.record.caseId,previousId:latest.record.id,portfolio:v1.record.portfolio,portfolioHash:v1.record.portfolioHash,portfolioReference:v1.record.portfolioReference});await page.getByRole('button',{name:'Save investigation',exact:true}).click();await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(4);

});


test('a changed product identity is selectable even when grid bytes and event update time are unchanged',async({page})=>{
 const source=await setup(page);const v1=await bundle(page);source.setVersion(2);source.setProductOnly();await check(page);
 await expect(page.getByRole('region',{name:'Captured update to apply'})).toContainText('cat53-product-2');
 await apply(page);const v2=await bundle(page);expect(v2.record.evidence.productId).toBe('cat53-product-2');expect(v2.record.evidence.rawSha256).toBe(v1.record.evidence.rawSha256);expect(v2.record.previousId).toBe(v1.record.id);
});

test('unchanged products and failed source checks preserve the exact saved investigation',async({page})=>{
 const source=await setup(page);const v1=await bundle(page);source.setTimestampOnly();await check(page);
 await expect(page.getByRole('region',{name:'Source update check'})).toContainText('No newer evidence found');await expect(page.getByRole('region',{name:'Captured update to apply'})).toHaveCount(0);expect(await bundle(page)).toEqual(v1);
 source.setFailed(true);await check(page);await expect(page.getByRole('region',{name:'Source update check'})).toContainText('saved investigation unchanged');expect(await bundle(page)).toEqual(v1);
});


test('source-confirmed canonical aliases preserve the saved case lineage when applying evidence',async({page})=>{
 const source=await setup(page);const v1=await bundle(page);source.setVersion(2);source.setCanonicalAlias();await check(page);await apply(page);const v2=await bundle(page);
 expect(v2.record).toMatchObject({caseId:v1.record.caseId,version:2,previousId:v1.record.id,event:{id:'cat53-canonical'},portfolio:v1.record.portfolio});
 await page.getByRole('button',{name:'Save investigation',exact:true}).click();await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await page.getByRole('button',{name:'Analysis settings',exact:true}).click();await page.getByLabel('Investigation threshold',{exact:true}).fill('5');await page.getByRole('button',{name:'Apply threshold as new version',exact:true}).click();const resumed=await bundle(page);expect(resumed.record).toMatchObject({caseId:v1.record.caseId,version:3,previousId:v2.record.id,event:{id:event.id}});

});
