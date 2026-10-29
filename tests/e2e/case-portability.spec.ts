import { openExport } from '../helpers/exposure-workspace';
import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';

const event={id:'cat54-event',name:'Synthetic CAT54 earthquake',magnitude:6.2,longitude:-117.5,latitude:35.5,occurredAt:'2019-07-06T03:19:53.000Z',updatedAt:'2026-10-24T11:00:00.000Z',aliases:['cat54-event'],significance:700};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const grid='<shakemap_grid event_id="cat54-event" shakemap_version="1" process_timestamp="2026-10-24T11:00:00Z"><event event_id="cat54-event"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 6\n-117 36 6\n-118 35 6\n-117 35 6</grid_data></shakemap_grid>';
const detail=JSON.stringify({id:event.id,properties:{mag:event.magnitude,time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt),ids:`,${event.id},`,products:{shakemap:[{id:'cat54-product',source:'us',code:event.id,status:'UPDATE',updateTime:Date.parse(event.updatedAt),contents:{'download/grid.xml':{url:'https://earthquake.usgs.gov/grid'}}}]}},geometry:{coordinates:[event.longitude,event.latitude,8]}});
async function assessed(page:Page){
 const raw=new Map<string,string>();
 const artifact=(text:string,kind:string)=>{const sha256=hash(text);raw.set(sha256,text);return{sha256,bytes:Buffer.byteLength(text),path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const artifacts={grid:artifact(grid,'grid'),detail:artifact(detail,'detail')};
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:{events:[event],checkedAt:event.updatedAt,range:{start:'2026-07-28T00:00:00.000Z',end:'2026-10-26T00:00:00.000Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}}));
 await page.route('**/api/exposure/captures',route=>{expect(route.request().postDataJSON()).toEqual({eventId:event.id});return route.fulfill({status:201,json:{schemaVersion:1,event,product:{id:'cat54-product',source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:'2026-10-25T18:00:00.000Z',artifacts}});});
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:raw.get(route.request().url().split('/').at(-1)!)!}));
 await page.goto('/exposure.html');await page.getByRole('button',{name:'Portfolio',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.locator('.catalog-event-list li').filter({hasText:event.id}).getByRole('button').click();await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 return await downloaded(page);
}
async function downloaded(page:Page){
 if(await page.getByRole('button',{name:'Locations',exact:true}).getAttribute('aria-expanded')!=='true')await page.getByRole('button',{name:'Locations',exact:true}).click();
 const downloading=page.waitForEvent('download');await openExport(page);await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();return JSON.parse(gunzipSync(await fs.readFile((await (await downloading).path())!)).toString());
}
function alteredCase(original:any){const altered=structuredClone(original);altered.record.id=randomUUID();altered.record.caseId=randomUUID();return altered;}
function rehash(envelope:any){const{sha256:_old,...payload}=envelope;return gzipSync(JSON.stringify({...payload,sha256:hash(JSON.stringify(payload))}));}
async function importCase(page:Page,bytes:Buffer){
 if(await page.getByRole('button',{name:'Saved',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'Saved',exact:true}).click();
 await page.getByLabel('Open a self-contained case').setInputFiles({name:'case.json.gz',mimeType:'application/gzip',buffer:bytes});
}

test('portable import rejects an event observation that contradicts its original source detail',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.event.magnitude=9.9;altered.record.evidence.magnitude=9.9;
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original event detail'})).toBeVisible();
 await expect(page.locator('.exposure-history li')).toHaveCount(1);
 expect(await downloaded(page)).toEqual(original);
});

test('portable import rejects a frozen epicentre that differs from the bundled source coordinates',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.event.longitude=12;altered.record.evidence.longitude=12;
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original event detail'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});

test('portable manifest aliases cannot substitute an unrelated event identity for the original detail',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.event.id='unrelated-event';altered.record.evidence.eventId='unrelated-event';
 altered.record.evidence.aliases.push('unrelated-event');
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original event detail'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});

test('portable occurrence time must agree with original detail rather than a rehashed manifest',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.event.occurredAt='2020-01-01T00:00:00.000Z';altered.record.evidence.occurredAt=altered.record.event.occurredAt;
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original event detail'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});

test('an unavailable-evidence portable case cannot carry unassociated original event bytes',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.evidence=null;altered.record.unavailableReason='No compatible shaking evidence.';altered.rawXml=null;
 altered.record.rows=altered.record.rows.map((row:any)=>({...row,mmi:null,reason:'evidence-unavailable'}));
 altered.record.summary={total:altered.record.rows.length,meetingThreshold:null,belowThreshold:null,unknownIntensity:altered.record.rows.length,knownValueByCurrency:null,unknownValueCount:0};
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'evidence is incomplete'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});

test('portable record identities cannot be invented through an extra manifest alias',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.event.id='unrelated-record-event';altered.record.evidence.aliases.push('unrelated-record-event');
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original event detail'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});

 test('portable product provenance must match a product in its captured original detail',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);altered.record.evidence.productId='invented-product';
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original product detail'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});

test('older supported cases without portfolio references or retained event detail remain portable',async({page})=>{
 const original=await assessed(page),legacy=alteredCase(original);
 delete legacy.record.portfolioReference;
 legacy.rawEventJson=null;legacy.record.evidence.eventDetailUrl=null;legacy.record.evidence.eventDetailSha256=null;
 await page.route('**/api/exposure/**',route=>route.abort());
 await importCase(page,rehash(legacy));
 await expect(page.locator('.exposure-history li')).toHaveCount(2);
 const restored=await downloaded(page);
 expect(restored.record).toEqual(legacy.record);expect(restored.rawEventJson).toBeNull();expect(restored.rawXml).toBe(grid);
});

test('minimal legacy event detail with a UTF-8 BOM keeps its exact bytes through import and export',async({page})=>{
 const original=await assessed(page),legacy=alteredCase(original);
 const minimal=JSON.parse(legacy.rawEventJson);delete minimal.properties.products;delete minimal.properties.ids;
 legacy.rawEventJson='\uFEFF'+JSON.stringify(minimal);legacy.record.evidence.eventDetailSha256=hash(legacy.rawEventJson);
 await page.route('**/api/exposure/**',route=>route.abort());
 await importCase(page,rehash(legacy));
 await expect(page.locator('.exposure-history li')).toHaveCount(2);
 const restored=await downloaded(page);
 expect(restored.record).toEqual(legacy.record);expect(restored.rawEventJson).toBe(legacy.rawEventJson);
});

for(const corruption of ['bundle schema','record schema','grid bytes','detail bytes','grid version','results'] as const){
 test(`portable import rejects altered ${corruption} while preserving the open and saved case`,async({page})=>{
  const original=await assessed(page),altered=alteredCase(original);
  if(corruption==='bundle schema')altered.schemaVersion=99;
  if(corruption==='record schema')altered.record.schemaVersion=99;
  if(corruption==='grid bytes')altered.rawXml=altered.rawXml.replace('36 6','36 8');
  if(corruption==='detail bytes')altered.rawEventJson+=' ';
  if(corruption==='grid version')altered.record.evidence.productVersion='99';
  if(corruption==='results')altered.record.rows[0].mmi=9;
  await importCase(page,rehash(altered));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.exposure-history li')).toHaveCount(1);
  expect(await downloaded(page)).toEqual(original);
 });
}

test('portable retrospective labels agree with the retained source product',async({page})=>{
 const original=await assessed(page),altered=alteredCase(original);
 altered.record.evidence.retrospective=true;
 await importCase(page,rehash(altered));
 await expect(page.getByRole('alert').filter({hasText:'original product detail'})).toBeVisible();
 expect(await downloaded(page)).toEqual(original);
});
