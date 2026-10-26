import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
const event={id:'us-availability',aliases:['us-availability'],name:'Availability earthquake',magnitude:6.2,latitude:35.7,longitude:-117.6,occurredAt:'2019-07-06T03:19:53.000Z',updatedAt:'2026-10-24T12:00:00.000Z',significance:1000};
const catalog={events:[event],checkedAt:'2026-10-26T12:00:00.000Z',range:{start:'2019-07-01T00:00:00.000Z',end:'2019-07-31T23:59:59.999Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0};
function originals(xml?:string){
 const grid=Buffer.from(xml??'<shakemap_grid event_id="us-availability" shakemap_version="1" process_timestamp="2026-10-24T12:00:00Z"><event event_id="us-availability"/><grid_specification nlon="2" nlat="2"/><grid_field name="MMI" index="1" units="intensity"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="LON" index="3" units="dd"/><grid_data>6 36 -118\n8 36 -117\n4 35 -118\n6 35 -117</grid_data></shakemap_grid>');
 const detail=Buffer.from(JSON.stringify({id:event.id,properties:{mag:event.magnitude,time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt)},geometry:{coordinates:[event.longitude,event.latitude,8]}}));
 const artifact=(bytes:Buffer,kind:string)=>{const sha256=createHash('sha256').update(bytes).digest('hex');return {sha256,bytes:bytes.length,path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const artifacts={grid:artifact(grid,'grid'),detail:artifact(detail,'detail')};
 return {grid,detail,artifacts,manifest:{schemaVersion:1,event,product:{id:'product:availability',source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:'2026-10-25T12:00:00.000Z',artifacts}};
}
async function mockOriginals(page:Page,files=originals()){
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:catalog}));
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:route.request().url().endsWith(files.artifacts.grid.sha256)?files.grid:files.detail}));return files;
}
const inspector=(page:Page)=>page.getByRole('complementary',{name:'Earthquake evidence inspector'});
for(const [code,label] of [['source_unavailable','Public earthquake source unavailable'],['database_unavailable','Archive database unavailable'],['object_store_unavailable','Archive object storage unavailable'],['archive_unavailable','Archive API unavailable']] as const){
 test(`${code} has an explicit timestamped retry and recovers compatible evidence without assessment`,async({page})=>{
  const files=await mockOriginals(page);let failure=true,captures=0;
  await page.route('**/api/exposure/captures',route=>{captures++;return failure?route.fulfill({status:503,json:{error:{code,message:'PRIVATE diagnostic must never appear'}}}):route.fulfill({status:201,json:files.manifest});});
  await page.goto('/exposure.html');await page.getByRole('button',{name:/Availability earthquake/}).click();
  await expect(inspector(page)).toContainText(label);await expect(inspector(page)).toContainText('Last failed check');await expect(inspector(page)).not.toContainText('PRIVATE');
  await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();await expect(page.getByTestId('exposure-count')).toHaveText('—');
  failure=false;await inspector(page).getByRole('button',{name:'Retry evidence retrieval',exact:true}).click();
  await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);await expect(inspector(page)).toContainText('Last successful check');expect(captures).toBe(2);
  await expect(page.getByTestId('exposure-count')).toHaveText('—');
 });
}
test('failed retry retains only the selected event verified capture and its successful check time',async({page})=>{
 const files=await mockOriginals(page);let fail=false;
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:{...catalog,events:[event,{...event,id:'different-earthquake',aliases:['different-earthquake'],name:'Different earthquake'}]}}));
 await page.route('**/api/exposure/captures',route=>fail?route.fulfill({status:503,json:{error:{code:'database_unavailable'}}}):route.fulfill({status:201,json:files.manifest}));
 await page.goto('/exposure.html');await page.getByRole('button',{name:/Availability earthquake/}).click();await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);
 const successful=await inspector(page).locator('time').last().getAttribute('datetime');
 fail=true;await inspector(page).getByRole('button',{name:'Retry evidence retrieval',exact:true}).click();
 await expect(inspector(page)).toContainText('Retained verified evidence');await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);await expect(inspector(page)).toContainText('Last failed check');
 await expect(inspector(page).locator(`time[datetime="${successful}"]`)).toBeVisible();
 await page.getByRole('button',{name:/Different earthquake/}).click();await expect(inspector(page)).not.toContainText(files.artifacts.grid.sha256);await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();
 await page.getByLabel('USGS event ID',{exact:true}).fill('manual-known-id');await page.getByRole('button',{name:'Capture earthquake evidence',exact:true}).click();await expect(inspector(page).getByRole('heading')).toHaveText('USGS event manual-known-id');
});
for(const [code,label] of [['capture_pending','Evidence capture is pending'],['evidence_unavailable','No supported shaking evidence'],['grid_unavailable','No usable numeric grid'],['unsupported_layout','Unsupported ShakeMap layout'],['unsupported_units','Unsupported ShakeMap units']] as const){
 test(`${code} explains an unassessable selected event without intensity`,async({page})=>{
  await mockOriginals(page);await page.route('**/api/exposure/captures',route=>route.fulfill({status:422,json:{error:{code,message:'PRIVATE'}}}));
  await page.goto('/exposure.html');await page.getByRole('button',{name:/Availability earthquake/}).click();await expect(inspector(page)).toContainText(label);await expect(inspector(page)).not.toContainText('PRIVATE');
  await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();await expect(page.getByTestId('exposure-count')).toHaveText('—');
 });
}
for(const kind of ['units','layout','hash'] as const){
 test(`client refuses verified-byte ${kind} incompatibility before assessment`,async({page})=>{
  const valid=originals();const xml=kind==='units'?valid.grid.toString().replace('units="intensity"','units="g"'):kind==='layout'?valid.grid.toString().replace('nlon="2"','nlon="1"'):undefined;
  const files=await mockOriginals(page,originals(xml));await page.route('**/api/exposure/captures',route=>route.fulfill({status:201,json:files.manifest}));
  if(kind==='hash')await page.route(`**/api/exposure/artifacts/${files.artifacts.grid.sha256}`,route=>route.fulfill({body:Buffer.from('corrupted bytes')}));
  await page.goto('/exposure.html');await page.getByRole('button',{name:/Availability earthquake/}).click();
  await expect(inspector(page)).toContainText(kind==='hash'?'SHA-256':kind==='units'?'Unsupported ShakeMap units':'Unsupported ShakeMap layout');await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();await expect(page.getByTestId('exposure-count')).toHaveText('—');
 });
}
test('failed source update keeps a saved investigation inspectable and reopenable while all public services are unavailable',async({page},testInfo)=>{
 const files=await mockOriginals(page);let outage=false;
 await page.route('**/api/exposure/captures',route=>outage?route.fulfill({status:503,json:{error:{code:'archive_unavailable'}}}):route.fulfill({status:201,json:files.manifest}));
 await page.route('https://earthquake.usgs.gov/fdsnws/event/1/query?**',route=>route.fulfill({status:503,body:'PRIVATE USGS diagnostics'}));
 await page.route('**/api/exposure/**',route=>outage?route.fulfill({status:503,json:{error:{code:'archive_unavailable'}}}):route.fallback());
 await page.goto('/exposure.html');await page.getByRole('button',{name:'Portfolios',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();
 await page.getByRole('button',{name:/Availability earthquake/}).click();await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 const before=await page.getByTestId('exposure-count').textContent();outage=true;
 await inspector(page).getByRole('button',{name:'Check source for updates',exact:true}).click();await expect(inspector(page)).toContainText('Public earthquake source unavailable');await expect(inspector(page)).toContainText('Last failed source check');await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);await expect(inspector(page)).not.toContainText('PRIVATE');await expect(page.getByTestId('exposure-count')).toHaveText(before!);
 await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.atlas-catalog-panel .exposure-history li')).toHaveCount(1);await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);await expect(page.getByTestId('exposure-count')).toHaveText(before!);
 await page.screenshot({path:`output/playwright/cat50-retained-outage-${testInfo.project.name}.png`,fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText(before!);await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);
 await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByLabel('USGS event ID',{exact:true}).fill(event.id);await page.getByRole('button',{name:'Capture earthquake evidence',exact:true}).click();await expect(inspector(page)).toContainText('Archive API unavailable');await expect(inspector(page)).toContainText(files.artifacts.grid.sha256);await expect(inspector(page)).toContainText('Retained verified evidence');
});
for(const [code,label] of [['artifact_unavailable','Captured artifact unavailable in archive object storage'],['artifact_integrity','Stored artifact failed SHA-256 integrity verification'],['constructor','Archive API unavailable']] as const){
 test(`artifact response ${code} retains a safe subsystem explanation`,async({page})=>{
  const files=await mockOriginals(page);await page.route('**/api/exposure/captures',route=>route.fulfill({status:201,json:files.manifest}));await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({status:503,json:{error:{code,message:'PRIVATE storage diagnostics'}}}));
  await page.goto('/exposure.html');await page.getByRole('button',{name:/Availability earthquake/}).click();await expect(inspector(page)).toContainText(label);await expect(inspector(page)).not.toContainText('PRIVATE');await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();
 });
}
test('a delayed capture cannot overwrite a different observation selected in Recovery',async({page})=>{
 const files=await mockOriginals(page);let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let finished!:()=>void;const completed=new Promise<void>(resolve=>{finished=resolve;});
 await page.route('**/api/exposure/captures',async route=>{await pending;await route.fulfill({status:201,json:files.manifest});finished();});
 await page.goto('/exposure.html?recovery=parametric');await page.getByRole('button',{name:/Availability earthquake/}).click();await page.getByRole('button',{name:'Recovery',exact:true}).click();if(!await page.getByRole('combobox',{name:'Demonstration scenario',exact:true}).isVisible())await page.getByRole('button',{name:'Assessment',exact:true}).first().click();await page.getByRole('combobox',{name:'Demonstration scenario',exact:true}).selectOption('outer');await expect(page.getByRole('heading',{level:1})).toContainText('Synthetic');
 release();await completed;await page.getByRole('button',{name:'Exposure',exact:true}).click();await expect(page.getByRole('button',{name:/Availability earthquake/})).toBeEnabled();await expect(page.getByRole('heading',{level:1})).toContainText('Synthetic');await expect(inspector(page)).not.toContainText(files.artifacts.grid.sha256);await expect(inspector(page).getByRole('button',{name:'Retry evidence retrieval',exact:true})).toHaveCount(0);await expect(inspector(page)).not.toContainText('Last evidence check');
});
