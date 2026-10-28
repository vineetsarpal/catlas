import { mockArchiveUpdate } from '../helpers/archive-update';
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

const timestamp='2026-10-25T12:00:00.000Z';
const makeEvent=(id:string)=>({id,name:'Same place earthquake',magnitude:6.2,longitude:-117.5,latitude:35.5,occurredAt:'2019-07-06T03:19:53.000Z',updatedAt:timestamp,aliases:[id],significance:700});
const equal=makeEvent('cat52-equal'),below=makeEvent('cat52-below'),unknown=makeEvent('cat52-unknown');
const header='location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n';
const oneUnknownValue=header+'NODE,Unknown value consolidated site,-117.5,35.5,,CAD,West,Commercial\n';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const catalogRow=(page:Page,id:string)=>page.locator('.catalog-event-list li').filter({hasText:id});
async function inventory(page:Page,csv=oneUnknownValue){
  await page.getByRole('button',{name:'Portfolios',exact:true}).click();
  await page.getByRole('button',{name:'Create portfolio',exact:true}).click();
  const form=page.getByRole('form',{name:'Create portfolio',exact:true});
  await form.getByLabel('Portfolio name',{exact:true}).fill('Synthetic relevance portfolio');
  await form.getByLabel('Source',{exact:true}).fill('Synthetic CAT52 CSV');
  await form.getByLabel('As-of date',{exact:true}).fill('2026-10-20');
  await form.getByRole('button',{name:'Save portfolio',exact:true}).click();
  await replaceInventory(page,csv);
}
async function replaceInventory(page:Page,csv:string){
  await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Import CSV',exact:true}).click();
  await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'synthetic-cat52.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('combobox',{name:'Import behavior',exact:true}).selectOption('replace');
  await page.getByLabel('I have reviewed the changes and excluded rows.').check();
  await page.getByRole('button',{name:'Apply import',exact:true}).click();
  await expect(page.getByRole('button',{name:'Apply import',exact:true})).toHaveCount(0);
  await expect(page.getByText('CSV import saved. Existing investigations retain their original snapshots.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
}
async function fixtures(page:Page,events=[equal,below,unknown],missingIds:string[]=[]){
  let captures=0;const queries:URL[]=[];
  await page.route('**/api/exposure/catalog?**',route=>{queries.push(new URL(route.request().url()));return route.fulfill({json:{events,checkedAt:timestamp,range:{start:'2019-01-01T00:00:00.000Z',end:'2020-01-01T00:00:00.000Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}});});
  const originals=new Map<string,string>();
  await page.route('**/api/exposure/captures',route=>{
    const body=route.request().postDataJSON();expect(Object.keys(body)).toEqual(['eventId']);captures++;
    const event=events.find(item=>item.id===body.eventId)!;expect(event).toBeDefined();
    const intensity=event.id===equal.id?4:3.999;
    const grid=`<shakemap_grid event_id="${event.id}" shakemap_version="1" process_timestamp="${timestamp}"><event event_id="${event.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 ${missingIds.includes(event.id)?'NaN':intensity}\n-117 36 ${intensity}\n-118 35 ${intensity}\n-117 35 ${intensity}</grid_data></shakemap_grid>`;
    const detail=JSON.stringify({id:event.id,properties:{mag:6.2,time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt)},geometry:{coordinates:[event.longitude,event.latitude,8]}});
    const artifact=(raw:string,kind:string)=>{const sha256=hash(raw);originals.set(sha256,raw);return {sha256,bytes:Buffer.byteLength(raw),path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
    return route.fulfill({status:201,json:{schemaVersion:1,event,product:{id:`product-${event.id}`,source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:timestamp,artifacts:{grid:artifact(grid,'grid'),detail:artifact(detail,'detail')}}});
  });
  await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:originals.get(route.request().url().split('/').at(-1)!)!}));
  return {get captures(){return captures;},queries};
}

test('relevance uses the exact inclusive threshold and unknown insured value does not block known intensity',async({page})=>{
  const requests=await fixtures(page);await page.goto('/exposure.html');await inventory(page);
  await catalogRow(page,equal.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await catalogRow(page,below.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await expect(page.getByTestId('exposure-count')).toHaveText('—');
  await page.getByLabel('Relevant to portfolio',{exact:true}).check();
  await expect(catalogRow(page,equal.id)).toContainText('Potential match');
  await expect(catalogRow(page,below.id)).toHaveCount(0);
  await expect(catalogRow(page,unknown.id)).toContainText('Unknown relevance');
  await page.getByLabel('Screening threshold MMI',{exact:true}).fill('4.0001');
  await expect(catalogRow(page,equal.id)).toHaveCount(0);await expect(catalogRow(page,unknown.id)).toBeVisible();
  await page.getByLabel('Screening threshold MMI',{exact:true}).fill('');
  await expect(page.locator('.catalog-event-list li')).toHaveCount(3);
  await expect(catalogRow(page,below.id)).toContainText('Unknown relevance');
  expect(requests.captures).toBe(2);
  await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
});


test('outside-grid locations, missing samples and excluded import rows keep no-hit events unknown across current portfolio edits',async({page})=>{
  const missing=makeEvent('cat52-missing');
  const requests=await fixtures(page,[below,missing],[missing.id]);await page.goto('/exposure.html');
  await inventory(page,oneUnknownValue+'OUT,Outside supplied site,-115,35.5,100,CAD,East,Commercial\n');
  await catalogRow(page,below.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await page.getByLabel('Relevant to portfolio',{exact:true}).check();
  await expect(catalogRow(page,below.id)).toContainText('Unknown relevance');
  await page.getByRole('button',{name:'Portfolios',exact:true}).click();await replaceInventory(page,oneUnknownValue);
  await page.getByLabel('Relevant to portfolio',{exact:true}).check();await expect(catalogRow(page,below.id)).toHaveCount(0);
  await catalogRow(page,missing.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await expect(catalogRow(page,missing.id)).toContainText('Unknown relevance');
  await page.getByRole('button',{name:'Portfolios',exact:true}).click();await replaceInventory(page,oneUnknownValue+'BAD,Excluded supplied site,,35.5,100,CAD,East,Commercial\n');
  await page.getByLabel('Relevant to portfolio',{exact:true}).check();
  await expect(catalogRow(page,below.id)).toContainText('Unknown relevance');
  await expect(catalogRow(page,below.id)).toContainText('excluded');
  await expect(catalogRow(page,missing.id)).toContainText('Unknown relevance');
  expect(requests.captures).toBe(2);await expect(page.getByTestId('exposure-count')).toHaveText('—');
});


test('historical aliases reuse matching observations while distinct same-place and changed observations retain unknown relevance',async({page})=>{
  const far={...unknown,longitude:0,latitude:0};const events=[{...below},far];
  const requests=await fixtures(page,events);await page.goto('/exposure.html');await inventory(page);
  await catalogRow(page,below.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  const alias={...below,id:'cat52-source-alias',aliases:['cat52-source-alias',below.id]};events.splice(0,1,alias);
  await page.getByRole('button',{name:'Historical search',exact:true}).click();
  await page.getByLabel('Start date (UTC)',{exact:true}).fill('2019-01-01');await page.getByLabel('End date (UTC)',{exact:true}).fill('2020-01-01');
  await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
  await expect(catalogRow(page,alias.id)).toContainText('Below screening threshold');
  await expect(page.locator('.catalog-event-list li')).toHaveCount(2);
  await page.getByLabel('Relevant to portfolio',{exact:true}).check();await expect(catalogRow(page,alias.id)).toHaveCount(0);
  await expect(catalogRow(page,far.id)).toContainText('Unknown relevance');await expect(catalogRow(page,far.id)).toContainText('distance alone');
  events.splice(0,1,{...alias,longitude:10});
  await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
  await expect(catalogRow(page,alias.id)).toContainText('Unknown relevance');await expect(page.locator('.catalog-event-list li')).toHaveCount(2);
  const submitted=requests.queries.at(-1)!;expect(submitted.searchParams.get('mode')).toBe('historical');expect(submitted.searchParams.get('start')).toBe('2019-01-01T00:00:00.000Z');
  expect([...submitted.searchParams.keys()].sort()).toEqual(['end','mode','offset','significant','start']);
  expect(requests.captures).toBe(1);await expect(page.getByTestId('exposure-count')).toHaveText('—');
});

test('an explicitly checked matching update participates in relevance before Apply while saved below-threshold assessment stays frozen',async({page})=>{
  const requests=await fixtures(page,[below]);const sourceRevision=2;
  const updatedAt='2026-10-26T12:00:00.000Z';
  const sourceRequests=await mockArchiveUpdate(page,()=>({event:{...below,magnitude:6.2,longitude:below.longitude,updatedAt},productId:`cat52-checked-match-product-v${sourceRevision}`,grid:`<shakemap_grid event_id="${below.id}" shakemap_version="${sourceRevision}" process_timestamp="${updatedAt}"><event event_id="${below.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 6\n-117 36 6\n-118 35 6\n-117 35 6</grid_data></shakemap_grid>`}));
  await page.goto('/exposure.html');await inventory(page);
  await catalogRow(page,below.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('0');
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByLabel('Relevant to portfolio',{exact:true}).check();await expect(catalogRow(page,below.id)).toHaveCount(0);
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);
  await page.getByRole('button',{name:'Check for newer source evidence',exact:true}).click();await expect(page.getByRole('button',{name:'Apply captured update as new version',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await expect(catalogRow(page,below.id)).toContainText('Potential match');
  await expect(catalogRow(page,below.id)).toContainText('cat52-checked-match-product');
  await expect(page.getByTestId('exposure-count')).toHaveText('0');await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);await expect(page.locator('.exposure-history')).toContainText('0 meeting threshold');
  expect(requests.captures).toBe(1);expect(sourceRequests.checks).toBe(1);expect(sourceRequests.externalRequests).toBe(0);
  await page.getByRole('button',{name:'Apply captured update as new version',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('1');
  await page.route('**/api/exposure/captures',route=>route.fulfill({status:503,json:{error:{code:'archive_unavailable'}}}));
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await page.getByLabel('USGS event ID',{exact:true}).fill(below.id);
  await page.getByRole('button',{name:'Capture earthquake evidence',exact:true}).click();
  const inspector=page.getByRole('complementary',{name:'Earthquake evidence inspector'});
  await expect(inspector).toContainText('Retained verified evidence remains available');
  await expect(inspector.locator('code')).toHaveText(hash(`<shakemap_grid event_id="${below.id}" shakemap_version="${sourceRevision}" process_timestamp="${updatedAt}"><event event_id="${below.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 6\n-117 36 6\n-118 35 6\n-117 35 6</grid_data></shakemap_grid>`));
});

test('a fresh incompatible checked observation keeps a stale catalog unknown without borrowing its grid',async({page})=>{
  const requests=await fixtures(page,[below]);const sourceRevision=3;
  const updatedAt='2026-10-26T12:00:00.000Z';
  const sourceRequests=await mockArchiveUpdate(page,()=>({event:{...below,magnitude:7,longitude:10,updatedAt},productId:`cat52-checked-match-product-v${sourceRevision}`,grid:`<shakemap_grid event_id="${below.id}" shakemap_version="${sourceRevision}" process_timestamp="${updatedAt}"><event event_id="${below.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 6\n-117 36 6\n-118 35 6\n-117 35 6</grid_data></shakemap_grid>`}));
  await page.goto('/exposure.html');await inventory(page);
  await catalogRow(page,below.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('0');
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByLabel('Relevant to portfolio',{exact:true}).check();await expect(catalogRow(page,below.id)).toHaveCount(0);
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);
  await page.getByRole('button',{name:'Check for newer source evidence',exact:true}).click();await expect(page.getByRole('button',{name:'Apply captured update as new version',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await expect(catalogRow(page,below.id)).toContainText('Unknown relevance');
  await expect(catalogRow(page,below.id)).toContainText('cat52-checked-match-product');
  await expect(page.getByTestId('exposure-count')).toHaveText('0');await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);await expect(page.locator('.exposure-history')).toContainText('0 meeting threshold');
  expect(requests.captures).toBe(1);expect(sourceRequests.checks).toBe(1);expect(sourceRequests.externalRequests).toBe(0);
});

test('the same shaking product with changed source detail preserves observation uncertainty',async({page})=>{
  const requests=await fixtures(page,[below]);const sourceRevision=1;
  const updatedAt=timestamp;
  const sourceRequests=await mockArchiveUpdate(page,()=>({event:{...below,magnitude:7,longitude:10,updatedAt},productId:`product-${below.id}`,grid:`<shakemap_grid event_id="${below.id}" shakemap_version="${sourceRevision}" process_timestamp="${updatedAt}"><event event_id="${below.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 3.999\n-117 36 3.999\n-118 35 3.999\n-117 35 3.999</grid_data></shakemap_grid>`}));
  await page.goto('/exposure.html');await inventory(page);
  await catalogRow(page,below.id).getByRole('button').click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('0');
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByLabel('Relevant to portfolio',{exact:true}).check();await expect(catalogRow(page,below.id)).toHaveCount(0);
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);
  await page.getByRole('button',{name:'Check for newer source evidence',exact:true}).click();await expect(page.getByRole('button',{name:'Apply captured update as new version',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await expect(catalogRow(page,below.id)).toContainText('Unknown relevance');
  await expect(catalogRow(page,below.id)).toContainText('product-cat52-below');
  await expect(page.getByTestId('exposure-count')).toHaveText('0');await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);await expect(page.locator('.exposure-history')).toContainText('0 meeting threshold');
  expect(requests.captures).toBe(1);expect(sourceRequests.checks).toBe(1);expect(sourceRequests.externalRequests).toBe(0);
});
