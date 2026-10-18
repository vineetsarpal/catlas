import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
async function replay(page:Page){await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11',{timeout:30_000});await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-shaking-ready','true');await expect(page.getByTestId('exposure-map')).toHaveAttribute('data-land-rendered','true');}
test.beforeEach(async({page})=>{await page.goto('/exposure.html');});

test('portfolio screening, unknowns, acknowledged imports, supported size and keyboard layout',async({page})=>{
 await replay(page);await expect(page.getByTestId('exposure-unknown')).toHaveText('2');
 const summary=page.getByRole('region',{name:'Portfolio exposure summary'});await expect(summary).toContainText('$116,000,000');await expect(summary).toContainText('CA$12,000,000');
 await page.getByRole('combobox',{name:'Show',exact:true}).selectOption('unknown');await expect(page.locator('.exposure-table-scroll tbody tr')).toHaveCount(2);
 await page.getByRole('combobox',{name:'Show',exact:true}).selectOption('all');
 await page.getByRole('button',{name:'Use 1,000 synthetic locations',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('590');await expect(page.getByTestId('exposure-unknown')).toHaveText('110');
 await expect(page.locator('.exposure-pagination')).toContainText('1–100 of 1000');await page.getByRole('button',{name:'Next locations',exact:true}).click();await expect(page.locator('.exposure-pagination')).toContainText('101–200 of 1000');
 const header='location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n';
 await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:Buffer.from(header+'X,First,0,0,100,USD,R,B\nX,Second,0,0,100,USD,R,B\n')});
 await expect(page.getByRole('alert')).toContainText('duplicate location ID');
 await page.getByLabel('Preview portfolio CSV').setInputFiles({name:'partial.csv',mimeType:'text/csv',buffer:Buffer.from(header+'ONE,One,-117.67,35.62,1000000,USD,Kern,Commercial\nTWO,Two,-117.67,35.62,,CAD,Kern,Commercial\nBAD,Bad,,35,100,USD,Kern,Commercial\n')});
 await expect(page.locator('.exposure-import-preview')).toContainText('2 usable rows of 3; 1 excluded');
 await expect(page.getByRole('button',{name:'Import acknowledged portfolio',exact:true})).toBeDisabled();
 await page.getByLabel('Portfolio source',{exact:true}).fill('Test PAS export');await page.getByLabel('Portfolio as of',{exact:true}).fill('2019-07-05');
 await page.getByLabel('I have reviewed the imported locations and exclusions.').check();await page.getByRole('button',{name:'Import acknowledged portfolio',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('2');await expect(page.getByRole('region',{name:'Portfolio exposure summary'})).toContainText('1 screened locations have unknown value');
 await expect(page.locator('.exposure-source-bar')).toContainText('Test PAS export');
 await page.getByRole('button',{name:'One',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('complementary',{name:'Selected insured location'})).toContainText('One');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('saved versions survive refresh and portable cases reopen offline in fresh local history',async({page,browser,baseURL})=>{
 await replay(page);await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.getByRole('button',{name:'Saved in this browser',exact:true})).toBeDisabled();
 await page.getByLabel('Investigation threshold',{exact:true}).fill('6');await page.getByRole('button',{name:'Apply threshold as new version',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(2);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();const bytes=await fs.readFile((await (await downloading).path())!);const bundle=JSON.parse(gunzipSync(bytes).toString());
 expect(bundle.record.version).toBe(2);expect(bundle.record.summary.meetingThreshold).toBe(7);expect(bundle.rawXml).toContain('<shakemap_grid');
 await page.reload();await expect(page.locator('.exposure-history li')).toHaveCount(2);await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11');
 const context=await browser.newContext({viewport:{width:375,height:812}});const fresh=await context.newPage();
 await fresh.route('https://**/*',route=>route.abort());await fresh.goto(baseURL+'/exposure.html');
 await fresh.getByLabel('Open a self-contained case').setInputFiles({name:'case.json.gz',mimeType:'application/gzip',buffer:bytes});await expect(fresh.getByTestId('exposure-count')).toHaveText('7',{timeout:30_000});await expect(fresh.locator('.exposure-history li')).toHaveCount(1);
 bundle.record.settings.threshold=5;await fresh.getByLabel('Open a self-contained case').setInputFiles({name:'tampered.json.gz',mimeType:'application/gzip',buffer:gzipSync(JSON.stringify(bundle))});await expect(fresh.getByRole('alert')).toContainText('integrity');await expect(fresh.getByTestId('exposure-count')).toHaveText('7');
 await context.close();
});

test('live discovery captures public evidence and reports unavailable ShakeMap without zero',async({page})=>{
 const event={type:'Feature',id:'ci-test',properties:{mag:6.1,place:'Published test earthquake '+ 'with a long regional description '.repeat(10),time:Date.parse('2026-10-17T00:00:00Z'),updated:Date.parse('2026-10-17T00:01:00Z'),ids:',ci-test,'},geometry:{type:'Point',coordinates:[-117.6,35.7,8]}};
 await page.route('https://earthquake.usgs.gov/earthquakes/feed/**',route=>route.fulfill({json:{type:'FeatureCollection',features:[event]}}));
 await page.route('https://earthquake.usgs.gov/fdsnws/**',route=>route.fulfill({json:event}));
 await page.getByLabel('Enable near-real-time USGS discovery').check();await expect(page.getByLabel('Recent published events')).toContainText('Published test earthquake');await page.getByLabel('Recent published events').selectOption('ci-test');await page.getByRole('button',{name:'Capture earthquake evidence',exact:true}).click();
 await expect(page.locator('.exposure-source-bar')).toContainText('Published test earthquake');await expect(page.getByTestId('exposure-count')).toHaveText('—');await expect(page.getByTestId('exposure-unknown')).toHaveText('18');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();const bundle=JSON.parse(gunzipSync(await fs.readFile((await (await download).path())!)).toString());expect(bundle.record.summary.meetingThreshold).toBeNull();
});

test('source update is explicit, creates a new version and preserves the earlier saved result',async({page})=>{
 let revision=1;const requests:{method:string;body:string|null}[]=[];
 page.on('request',request=>{if(request.url().startsWith('https://earthquake.usgs.gov/'))requests.push({method:request.method(),body:request.postData()});});
 await page.route('https://earthquake.usgs.gov/fdsnws/**',route=>route.fulfill({json:{id:'ci-test',properties:{mag:6.1,place:'Versioned public earthquake',time:Date.parse('2026-01-01T00:00:00Z'),updated:Date.parse(`2026-01-01T00:0${revision}:00Z`),ids:',ci-test,',products:{shakemap:[{id:`map-${revision}`,source:'us',code:'ci-test',status:'UPDATE',updateTime:Date.parse(`2026-01-01T00:0${revision}:00Z`),preferredWeight:20,contents:{'download/grid.xml':{url:`https://earthquake.usgs.gov/product/revision-${revision}.xml`}}}]}},geometry:{coordinates:[-117.6,35.7,8]}}}));
 await page.route('https://earthquake.usgs.gov/product/revision-*.xml',route=>route.fulfill({contentType:'application/xml',body:`<shakemap_grid event_id="ci-test" shakemap_version="${revision}" process_timestamp="2026-01-01T00:0${revision}:00"><event event_id="ci-test"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-118 36 ${revision===1?6:3}\n-117 36 ${revision===1?8:3}\n-118 35 ${revision===1?4:3}\n-117 35 ${revision===1?6:3}</grid_data></shakemap_grid>`}));
 await page.getByLabel('USGS event ID',{exact:true}).fill('ci-test');await page.getByRole('button',{name:'Capture earthquake evidence',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(1);
 revision=2;await page.getByRole('button',{name:'Check for newer source evidence',exact:true}).click();await expect(page.getByRole('button',{name:'Apply captured update as new version',exact:true})).toBeEnabled();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 await page.getByRole('button',{name:'Apply captured update as new version',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('0');await expect(page.getByTestId('exposure-unknown')).toHaveText('11');
 await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();await expect(page.locator('.exposure-history li')).toHaveCount(2);
 await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('7');
 expect(requests.length).toBeGreaterThan(0);expect(requests.every(request=>request.method==='GET'&&request.body===null)).toBe(true);
});
