import { openExport, openEvidence } from '../helpers/exposure-workspace';
import { mockArchiveUpdate } from '../helpers/archive-update';
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { openFilters, openHistory, openLocations, openPortfolio } from '../helpers/exposure-workspace';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
async function replay(page:Page){await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11',{timeout:30_000});await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-shaking-ready','true');await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-land-rendered','true');}
test.beforeEach(async({page})=>{await page.goto('/exposure.html');await page.getByRole('button',{name:'Portfolio',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();});

test('portfolio screening, unknowns, acknowledged imports, supported size and keyboard layout',async({page})=>{
 await replay(page);await expect(page.getByTestId('exposure-unknown')).toHaveText('2');
 const summary=page.getByRole('region',{name:'Portfolio exposure summary'});await expect(summary).toContainText('$128,000,000');await expect(summary).not.toContainText('CA$');
 await openFilters(page);await page.getByRole('combobox',{name:'Show',exact:true}).selectOption('unknown');await expect(page.locator('.exposure-table-scroll tbody tr')).toHaveCount(2);
 await page.getByRole('combobox',{name:'Show',exact:true}).selectOption('all');
 await openPortfolio(page);await page.getByText('Demo portfolios',{exact:true}).click();await page.getByRole('button',{name:'Use 1,000 synthetic locations',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.getByRole('button',{name:'Investigate latest portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('590');await expect(page.getByTestId('exposure-unknown')).toHaveText('110');
 await openLocations(page);await expect(page.locator('.exposure-pagination')).toContainText('1–100 of 1000');await page.getByRole('button',{name:'Next locations',exact:true}).click();await expect(page.locator('.exposure-pagination')).toContainText('101–200 of 1000');
 const header='location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n';
 await openPortfolio(page);await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:Buffer.from(header+'X,First,0,0,100,USD,R,B\nX,Second,0,0,100,USD,R,B\n')});
 await expect(page.getByRole('alert')).toContainText('duplicate location ID');
 await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'partial.csv',mimeType:'text/csv',buffer:Buffer.from(header+'ONE,One,-117.67,35.62,1000000,USD,Kern,Commercial\nTWO,Two,-117.67,35.62,,CAD,Kern,Commercial\nBAD,Bad,,35,100,USD,Kern,Commercial\n')});
 await expect(page.getByRole('region',{name:'CSV import preview'})).toContainText('2 usable rows of 3; 1 excluded');
 await expect(page.getByRole('button',{name:'Apply import',exact:true})).toBeDisabled();
 await page.getByLabel('Import behavior').selectOption('replace');
 await page.getByLabel('I have reviewed the changes and excluded rows.').check();await page.getByRole('button',{name:'Apply import',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.getByRole('button',{name:'Investigate latest portfolio',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('2');await expect(page.getByRole('region',{name:'Portfolio exposure summary'})).toContainText('1 screened locations have unknown value');
 await expect(page.getByLabel('Active portfolio',{exact:true}).locator('option:checked')).toContainText('Demo · 1,000 locations');
 await openLocations(page);await page.getByRole('button',{name:'One',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('complementary',{name:'Selected insured location'})).toContainText('One');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('saved versions survive refresh and portable cases reopen offline in fresh local history',async({page,browser,baseURL})=>{
 await replay(page);await openHistory(page);await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.getByRole('button',{name:'Saved in this browser',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Analysis settings',exact:true}).click();await page.getByLabel('Investigation threshold',{exact:true}).fill('6');await page.getByRole('button',{name:'Apply threshold as new version',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 await openHistory(page);await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(2);
 await openLocations(page);const downloading=page.waitForEvent('download');await openExport(page);await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();const bytes=await fs.readFile((await (await downloading).path())!);const bundle=JSON.parse(gunzipSync(bytes).toString());
 expect(bundle.record.version).toBe(2);expect(bundle.record.summary.meetingThreshold).toBe(7);expect(bundle.rawXml).toContain('<shakemap_grid');
 await page.reload();await openHistory(page);await expect(page.locator('.exposure-history li')).toHaveCount(2);await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11');
 const context=await browser.newContext({viewport:{width:375,height:812}});const fresh=await context.newPage();
 await fresh.route('https://**/*',route=>route.abort());await fresh.goto(baseURL+'/exposure.html');
 await openHistory(fresh);await fresh.getByLabel('Open a self-contained case').setInputFiles({name:'case.json.gz',mimeType:'application/gzip',buffer:bytes});await expect(fresh.getByTestId('exposure-count')).toHaveText('7',{timeout:30_000});await expect(fresh.locator('.exposure-history li')).toHaveCount(1);
 bundle.record.settings.threshold=5;await fresh.getByLabel('Open a self-contained case').setInputFiles({name:'tampered.json.gz',mimeType:'application/gzip',buffer:gzipSync(JSON.stringify(bundle))});await expect(fresh.getByRole('alert').filter({hasText:'integrity'})).toBeVisible();await expect(fresh.getByTestId('exposure-count')).toHaveText('7');
 await context.close();
});

test('request-driven discovery inspects unavailable evidence without creating a zero or an assessment',async({page})=>{
 const event={id:'ci-test',name:'Published test earthquake '+ 'with a long regional description '.repeat(10),magnitude:6.1,latitude:35.7,longitude:-117.6,occurredAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:01:00.000Z',aliases:['ci-test'],significance:700};
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:{events:[event],checkedAt:new Date().toISOString(),range:{start:'2026-07-27T00:00:00.000Z',end:'2026-10-25T00:00:00.000Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}}));
 await page.route('**/api/exposure/captures',route=>route.fulfill({status:422,json:{error:{code:'evidence_unavailable'}}}));
 await page.getByRole('button',{name:'Refresh events',exact:true}).click();
 await page.getByRole('button',{name:/Published test earthquake/}).click();
 await expect(page.getByRole('heading',{level:1})).toContainText('Published test earthquake');
 await expect(page.getByTestId('exposure-count')).toHaveText('—');await expect(page.getByTestId('exposure-unknown')).toHaveText('—');
 await openEvidence(page);await expect(page.getByRole('complementary',{name:'Earthquake evidence inspector'})).toContainText('No supported shaking evidence');
 await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('source update is explicit, creates a new version and preserves the earlier saved result',async({page})=>{
 let revision=1;const requests:{method:string;body:string|null}[]=[];
 page.on('request',request=>{if(request.url().startsWith('https://earthquake.usgs.gov/'))requests.push({method:request.method(),body:request.postData()});});

 const detail=Buffer.from(JSON.stringify({id:'ci-test',properties:{mag:6.1,magType:'mw',time:Date.parse('2026-01-01T00:00:00Z'),updated:Date.parse('2026-01-01T00:01:00Z'),ids:',ci-test,'},geometry:{coordinates:[-117.6,35.7,8]}}));
 const grid=Buffer.from('<shakemap_grid event_id="ci-test" shakemap_version="1" process_timestamp="2026-01-01T00:01:00"><event event_id="ci-test"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 6\n-117 36 8\n-118 35 4\n-117 35 6</grid_data></shakemap_grid>');
 const artifact=(bytes:Buffer,kind:string)=>{const sha256=createHash('sha256').update(bytes).digest('hex');return {sha256,bytes:bytes.length,path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const artifacts={detail:artifact(detail,'detail'),grid:artifact(grid,'grid')};
 await page.route('**/api/exposure/captures',route=>route.fulfill({status:201,json:{schemaVersion:1,event:{id:'ci-test',aliases:['ci-test'],name:'Versioned public earthquake',occurredAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:01:00.000Z'},product:{id:'map-1',source:'us',code:'ci-test',updatedAt:'2026-01-01T00:01:00.000Z',retrospective:false},capturedAt:'2026-10-25T00:00:00.000Z',artifacts}}));
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:route.request().url().endsWith(artifacts.grid.sha256)?grid:detail}));
 const sourceRequests=await mockArchiveUpdate(page,()=>({event:{id:'ci-test',aliases:['ci-test'],name:'Versioned public earthquake',magnitude:6.1,longitude:-117.6,latitude:35.7,occurredAt:'2026-01-01T00:00:00.000Z',updatedAt:`2026-01-01T00:0${revision}:00.000Z`},productId:`map-${revision}`,grid:`<shakemap_grid event_id="ci-test" shakemap_version="${revision}" process_timestamp="2026-01-01T00:0${revision}:00"><event event_id="ci-test"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 ${revision===1?6:3}\n-117 36 ${revision===1?8:3}\n-118 35 ${revision===1?4:3}\n-117 35 ${revision===1?6:3}</grid_data></shakemap_grid>`}));
 await page.getByRole('button',{name:'Change event',exact:true}).click();await page.getByLabel('USGS event ID',{exact:true}).fill('ci-test');await page.getByRole('button',{name:'Capture earthquake evidence',exact:true}).click();
 await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 await openHistory(page);await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);
 revision=2;await page.getByRole('button',{name:'Check for newer source evidence',exact:true}).click();await expect(page.getByRole('button',{name:'Apply captured update as new version',exact:true})).toBeEnabled();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 await page.getByRole('button',{name:'Apply captured update as new version',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('0');await expect(page.getByTestId('exposure-unknown')).toHaveText('11');
 await openHistory(page);await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(2);
 await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 expect(requests).toHaveLength(0);expect(sourceRequests.checks).toBe(1);expect(sourceRequests.externalRequests).toBe(0);
});


test('retired variant URLs do not replace the investigation workspace',async({page})=>{
 for(const variant of ['side','focus','original','workspace']){
  await page.goto(`/exposure.html?variant=${variant}`);
  await expect(page.getByRole('navigation',{name:'Investigation tools'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Compare map layouts'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Locations',exact:true})).toBeVisible();
 }
});
