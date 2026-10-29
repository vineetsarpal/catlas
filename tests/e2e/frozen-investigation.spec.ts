import { openExport } from '../helpers/exposure-workspace';
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';

const event = { id:'cat51-event', name:'Synthetic CAT51 earthquake', magnitude:6.2, longitude:-117.5, latitude:35.5,
  occurredAt:'2019-07-06T03:19:53.000Z', updatedAt:'2026-10-24T11:00:00.000Z', aliases:['cat51-event'], significance:700 };
const grid = '<shakemap_grid event_id="cat51-event" shakemap_version="3" process_timestamp="2026-10-24T11:00:00Z"><event event_id="cat51-event"/><grid_specification nlon="3" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 6\n-117 36 8\n-116 36 NaN\n-118 35 2\n-117 35 4\n-116 35 6</grid_data></shakemap_grid>';
const detail = JSON.stringify({ id:event.id, properties:{mag:6.2,magType:'mw',time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt)},geometry:{coordinates:[-117.5,35.5,8]} });
const digest = (value:string|Buffer) => createHash('sha256').update(value).digest('hex');
const artifact = (raw:string,kind:string) => ({sha256:digest(raw),bytes:Buffer.byteLength(raw),path:`/api/artifacts/${digest(raw)}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'});
const artifacts={detail:artifact(detail,'detail'),grid:artifact(grid,'grid')};
const csv='location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\nA,CAD at node,-118,36,100,CAD,North,Commercial\nB,USD interpolated,-117.5,35.5,250,USD,Center,Commercial\nC,Unknown insured value,-117,36,,CAD,North,Commercial\nD,Below threshold,-118,35,700,CAD,South,Commercial\nE,Missing samples,-116.5,35.5,900,USD,East,Commercial\nF,Outside footprint,-115,35.5,1200,CAD,East,Commercial\nBAD,Excluded missing coordinate,,35,111,CAD,East,Commercial\n';
const expectedLocations=[
  {id:'A',name:'CAD at node',longitude:-118,latitude:36,value:100,currency:'CAD',region:'North',businessLine:'Commercial'},
  {id:'B',name:'USD interpolated',longitude:-117.5,latitude:35.5,value:250,currency:'USD',region:'Center',businessLine:'Commercial'},
  {id:'C',name:'Unknown insured value',longitude:-117,latitude:36,value:null,currency:'CAD',region:'North',businessLine:'Commercial'},
  {id:'D',name:'Below threshold',longitude:-118,latitude:35,value:700,currency:'CAD',region:'South',businessLine:'Commercial'},
  {id:'E',name:'Missing samples',longitude:-116.5,latitude:35.5,value:900,currency:'USD',region:'East',businessLine:'Commercial'},
  {id:'F',name:'Outside footprint',longitude:-115,latitude:35.5,value:1200,currency:'CAD',region:'East',businessLine:'Commercial'},
];
async function source(page:Page){
  await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:{events:[event],checkedAt:'2026-10-26T09:00:00.000Z',range:{start:'2026-07-28T00:00:00.000Z',end:'2026-10-26T00:00:00.000Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}}));
  await page.route('**/api/exposure/captures',route=>{expect(route.request().postDataJSON()).toEqual({eventId:event.id});return route.fulfill({status:201,json:{schemaVersion:1,event,product:{id:'cat51-product',source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:true},capturedAt:'2026-10-25T18:00:00.000Z',artifacts}});});
  await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:route.request().url().endsWith(artifacts.grid.sha256)?grid:detail}));
}
async function importPortfolio(page:Page){
  await page.getByRole('button',{name:'Portfolio',exact:true}).click();
  await page.getByRole('button',{name:'Create portfolio',exact:true}).click();
  const form=page.getByRole('form',{name:'Create portfolio',exact:true});
  await form.getByLabel('Portfolio name',{exact:true}).fill('Synthetic consolidated CAT51');
  await form.getByLabel('Source',{exact:true}).fill('Synthetic CAT51 CSV');
  await form.getByLabel('As-of date',{exact:true}).fill('2026-10-20');
  await form.getByRole('button',{name:'Save portfolio',exact:true}).click();
  await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Import CSV',exact:true}).click();
  await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'synthetic-cat51.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByLabel('I have reviewed the changes and excluded rows.').check();
  await page.getByRole('button',{name:'Apply import',exact:true}).click();
  await expect(page.getByRole('table',{name:'Insured location inventory'}).locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
}
async function assessed(page:Page){
  await source(page); await page.goto('/exposure.html'); await importPortfolio(page);
  await page.getByRole('button',{name:/Synthetic CAT51 earthquake M6.2/}).click();
  await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await expect(page.getByTestId('exposure-count')).toHaveText('—');
  await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('3');
  await expect(page.getByTestId('exposure-unknown')).toHaveText('2');
}
async function downloadCase(page:Page){
  if(await page.getByRole('button',{name:'Locations',exact:true}).getAttribute('aria-expanded')!=='true')await page.getByRole('button',{name:'Locations',exact:true}).click();
  const downloading=page.waitForEvent('download');await openExport(page);await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();
  return fs.readFile((await (await downloading).path())!);
}

test('complete current-portfolio investigation freezes independently checked numeric results and reopens offline without replacing inventory',async({page},testInfo)=>{
  await assessed(page);
  const summary=page.getByRole('region',{name:'Portfolio exposure summary'});
  await expect(summary).toContainText('CA$100'); await expect(summary).toContainText('$250');
  await expect(summary).toContainText('1 screened locations have unknown value');
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  const bytes=await downloadCase(page); const envelope=JSON.parse(gunzipSync(bytes).toString());
  const {sha256,...payload}=envelope;expect(sha256).toBe(digest(JSON.stringify(payload)));
  const record=envelope.record;
  expect(record.portfolio).toMatchObject({source:'Synthetic CAT51 CSV',asOf:'2026-10-20',locations:expectedLocations,excludedRows:1});
  expect(record.portfolioHash).toBe(digest(JSON.stringify(record.portfolio)));
  expect(record.settings).toEqual({threshold:4,sampler:'bilinear-mmi-axes-1'});
  expect(record.summary).toEqual({total:6,meetingThreshold:3,belowThreshold:1,unknownIntensity:2,knownValueByCurrency:{CAD:100,USD:250},unknownValueCount:1});
  expect(record.rows.map((row:{id:string;mmi:number|null;reason:string})=>({id:row.id,mmi:row.mmi,reason:row.reason}))).toEqual([{id:'A',mmi:6,reason:'estimated'},{id:'B',mmi:5,reason:'estimated'},{id:'C',mmi:8,reason:'estimated'},{id:'D',mmi:2,reason:'estimated'},{id:'E',mmi:null,reason:'missing-samples'},{id:'F',mmi:null,reason:'outside-grid'}]);
  expect(envelope.rawXml).toBe(grid);expect(envelope.rawEventJson).toBe(detail);
  expect(record.evidence).toMatchObject({rawSha256:digest(grid),eventDetailSha256:digest(detail),productId:'cat51-product',productVersion:'3',capturedAt:'2026-10-25T18:00:00.000Z',retrospective:true});
  await fs.mkdir('docs.local/research',{recursive:true});await fs.writeFile(`docs.local/research/cat51-frozen-${testInfo.project.name}.json.gz`,bytes);
  await page.getByRole('button',{name:'Portfolio',exact:true}).click();
  if(!await page.getByRole('table',{name:'Insured location inventory'}).isVisible())await page.getByRole('button',{name:/Show locations/}).click();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete Below threshold',exact:true}).click();
  await expect(page.getByRole('table',{name:'Insured location inventory'}).locator('tbody tr')).toHaveCount(5);
  await page.reload();await page.route('**/api/exposure/**',route=>route.abort());await page.route('https://**/*',route=>route.abort());
  await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.getByRole('button',{name:'Saved',exact:true}).click();
  await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('3');
  const reopened=JSON.parse(gunzipSync(await downloadCase(page)).toString());expect(reopened).toEqual(envelope);
  await page.getByRole('button',{name:'Portfolio',exact:true}).click();
  if(!await page.getByRole('table',{name:'Insured location inventory'}).isVisible())await page.getByRole('button',{name:/Show locations/}).click();
  await expect(page.getByRole('table',{name:'Insured location inventory'}).locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('table',{name:'Insured location inventory'})).not.toContainText('Below threshold');
});

test('portable case refuses a rehashed event identity that disagrees with its frozen evidence',async({page})=>{
  await assessed(page);const bytes=await downloadCase(page);const bundle=JSON.parse(gunzipSync(bytes).toString());
  bundle.record.event.id='different-event';bundle.record.event.latitude=12;bundle.record.event.longitude=48;bundle.record.event.magnitude=8.9;
  const {sha256:_old,...payload}=bundle;const forged=Buffer.from(gzipSync(JSON.stringify({...payload,sha256:digest(JSON.stringify(payload))})));
  await page.getByRole('button',{name:'Saved',exact:true}).click();
  await page.getByLabel('Open a self-contained case').setInputFiles({name:'mismatched-event.json.gz',mimeType:'application/gzip',buffer:forged});
  await expect(page.getByRole('alert').filter({hasText:'event does not match'})).toBeVisible();
  await expect(page.locator('.exposure-history li')).toHaveCount(0);
  await expect(page.getByTestId('exposure-count')).toHaveText('3');
});

test('a browser storage write refusal never reports a saved investigation and an explicit retry can succeed',async({page})=>{
  await page.addInitScript(()=>{
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){
      if((window as unknown as {cat51StorageFull?:boolean}).cat51StorageFull&&this.name==='catlas-exposure-1'&&args[1]==='readwrite')throw new DOMException('Synthetic storage is full','QuotaExceededError');
      return transaction.apply(this,args);
    };
  });
  await assessed(page);
  await page.evaluate(()=>Object.assign(window,{cat51StorageFull:true}));
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/Synthetic storage is full/})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(0);
  await page.evaluate(()=>Object.assign(window,{cat51StorageFull:false}));
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();
  await expect(page.locator('.exposure-history li')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
});
