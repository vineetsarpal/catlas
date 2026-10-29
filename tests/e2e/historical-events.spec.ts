import { test, expect, type Page } from '@playwright/test';
const oldEvent={id:'historical-1906',aliases:['historical-1906'],name:'Historical same place',magnitude:7.8,latitude:35.7,longitude:-117.6,occurredAt:'1906-04-18T12:12:00.000Z',updatedAt:'2026-10-24T12:00:00.000Z',significance:1000};
const pageResult={events:[],checkedAt:'2026-10-25T12:00:00.000Z',range:{start:'1906-04-01T00:00:00.000Z',end:'1906-04-30T23:59:59.999Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0};
async function openHistorical(page:Page){await page.goto('/exposure.html');await page.getByRole('button',{name:'Historical search',exact:true}).click();}
test('date area and magnitude search retains its public query while inspecting unavailable historical evidence',async({page})=>{
 const searches:URL[]=[];
 await page.route('**/api/exposure/catalog?**',route=>{const url=new URL(route.request().url());searches.push(url);return route.fulfill({json:{...pageResult,events:url.searchParams.get('mode')==='historical'?[oldEvent]:[]}});});
 await page.route('**/api/exposure/captures',route=>{expect(route.request().postDataJSON()).toEqual({eventId:oldEvent.id});return route.fulfill({status:422,json:{error:{code:'evidence_unavailable'}}});});
 await openHistorical(page);
 await page.getByLabel('Start date (UTC)').fill('1906-04-01');await page.getByLabel('End date (UTC)').fill('1906-04-30');
 await page.getByLabel('Minimum magnitude').fill('6');await page.getByLabel('Maximum magnitude').fill('9');
 await page.getByLabel('South latitude').fill('30');await page.getByLabel('North latitude').fill('40');await page.getByLabel('West longitude').fill('-125');await page.getByLabel('East longitude').fill('-110');
 await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
 await expect(page.getByRole('button',{name:/Historical same place/})).toBeVisible();
 expect(Object.fromEntries(searches.at(-1)!.searchParams)).toEqual({mode:'historical',significant:'false',offset:'0',start:'1906-04-01T00:00:00.000Z',end:'1906-04-30T23:59:59.999Z',minMagnitude:'6',maxMagnitude:'9',minLatitude:'30',maxLatitude:'40',minLongitude:'-125',maxLongitude:'-110'});
 await page.getByRole('button',{name:/Historical same place/}).click();
 await expect(page.getByRole('complementary',{name:'Earthquake evidence inspector'})).toContainText('No supported shaking evidence');
 await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await expect(page.getByText(/Retrieved query:.*1906-04-01/)).toBeVisible();
 const count=searches.length;await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Events',exact:true}).click();
 await expect(page.getByLabel('Start date (UTC)')).toHaveValue('1906-04-01');expect(searches).toHaveLength(count);
 await expect(page.getByText(/Text filters only retrieved names/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('source ID finds supported historical evidence independently of structured filters and waits for assessment',async({page})=>{
 const {createHash}=await import('node:crypto');
 const grid=Buffer.from('<shakemap_grid event_id="historical-1906" shakemap_version="1" process_timestamp="2026-10-24T12:00:00Z"><event event_id="historical-1906"/><grid_specification nlon="2" nlat="2"/><grid_field name="MMI" index="1" units="intensity"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="LON" index="3" units="dd"/><grid_data>6 36 -118\n8 36 -117\n4 35 -118\n6 35 -117</grid_data></shakemap_grid>');
 const detail=Buffer.from(JSON.stringify({id:oldEvent.id,properties:{mag:oldEvent.magnitude,time:Date.parse(oldEvent.occurredAt),updated:Date.parse(oldEvent.updatedAt)},geometry:{coordinates:[oldEvent.longitude,oldEvent.latitude,8]}}));
 const artifact=(bytes:Buffer,kind:string)=>{const sha256=createHash('sha256').update(bytes).digest('hex');return {sha256,bytes:bytes.length,path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const artifacts={grid:artifact(grid,'grid'),detail:artifact(detail,'detail')};let query:Record<string,string>={};let captures=0;
 await page.route('**/api/exposure/catalog?**',route=>{const url=new URL(route.request().url());query=Object.fromEntries(url.searchParams);return route.fulfill({json:{...pageResult,events:url.searchParams.has('eventId')?[oldEvent]:[]}});});
 await page.route('**/api/exposure/captures',route=>{captures++;expect(route.request().postDataJSON()).toEqual({eventId:oldEvent.id});return route.fulfill({status:201,json:{schemaVersion:1,event:oldEvent,product:{id:'atlas:1906',source:'atlas',code:oldEvent.id,updatedAt:oldEvent.updatedAt,retrospective:true},capturedAt:pageResult.checkedAt,artifacts}});});
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:route.request().url().endsWith(artifacts.grid.sha256)?grid:detail}));
 await openHistorical(page);
 await page.getByLabel('Start date (UTC)').fill('2000-01-01');await page.getByLabel('End date (UTC)').fill('2000-01-02');await page.getByLabel('Minimum magnitude').fill('9');
 await page.getByLabel('Source event ID').fill('historical-1906');
 await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
 await expect(page.getByRole('button',{name:/Historical same place/})).toBeVisible();
 expect(query).toEqual({mode:'historical',offset:'0',eventId:'historical-1906'});expect(captures).toBe(0);
 await page.getByRole('button',{name:/Historical same place/}).click();
 const inspector=page.getByRole('complementary',{name:'Earthquake evidence inspector'});
 await expect(inspector).toContainText(artifacts.grid.sha256);await expect(inspector).toContainText('Retrospective');
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await page.getByRole('button',{name:'Portfolio',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();
 await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).not.toHaveText('—');
 await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.atlas-catalog-panel .exposure-history li')).toHaveCount(1);
});

test('switching the search form retains results with their historical scope until an explicit recent refresh',async({page})=>{
 let requests=0;
 await page.route('**/api/exposure/catalog?**',route=>{requests++;return route.fulfill({json:{...pageResult,events:new URL(route.request().url()).searchParams.has('eventId')?[oldEvent]:[]}});});
 await openHistorical(page);await page.getByLabel('Source event ID').fill(oldEvent.id);await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
 await expect(page.getByRole('button',{name:/Historical same place/})).toBeVisible();const count=requests;
 await page.getByRole('button',{name:'Recent events',exact:true}).click();
 await expect(page.getByText('Showing the previous historical query. Refresh events to retrieve the recent window.',{exact:true})).toBeVisible();expect(requests).toBe(count);
 await page.getByRole('button',{name:'Refresh events',exact:true}).click();await expect(page.getByText('No matching events in the retrieved results.',{exact:true})).toBeVisible();
});

test('historical paging preserves the retrieved bounds, merges only source aliases and retains timestamped stale results',async({page},testInfo)=>{
 let fail=false,empty=false;const received:Record<string,string>[]=[];
 const distinct={...oldEvent,id:'distinct',aliases:['distinct']},revised={...oldEvent,id:'new-source',aliases:[oldEvent.id,'new-source'],updatedAt:'2026-10-25T11:00:00.000Z',magnitude:8};
 await page.route('**/api/exposure/catalog?**',route=>{
  const params=Object.fromEntries(new URL(route.request().url()).searchParams);received.push(params);
  if(fail)return route.fulfill({status:503,json:{error:{code:'source_unavailable'}}});
  if(params.mode!=='historical'||empty)return route.fulfill({json:pageResult});
  return route.fulfill({json:params.offset==='0'?{...pageResult,events:[oldEvent,distinct],hasMore:true,completeness:'more-available'}:{...pageResult,events:[revised],offset:50,hasMore:false,completeness:'partial'}});
 });
 await openHistorical(page);await page.getByLabel('Start date (UTC)').fill('1906-04-01');await page.getByLabel('End date (UTC)').fill('1906-04-30');await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
 await expect(page.locator('.catalog-event-list li')).toHaveCount(2);
 await page.getByLabel('Start date (UTC)').fill('2000-01-01');
 await page.getByRole('button',{name:'Load more earthquakes',exact:true}).click();
 await expect(page.locator('.catalog-event-list li')).toHaveCount(2);
 expect(received.at(-1)).toMatchObject({start:'1906-04-01T00:00:00.000Z',end:'1906-04-30T23:59:59.999Z',offset:'50'});
 await expect(page.locator('.catalog-event-list')).toContainText('new-source');await expect(page.locator('.catalog-event-list')).toContainText('distinct');
 await expect(page.getByRole('region',{name:'Recent earthquake catalog'}).getByRole('status')).toContainText('Partial coverage');
 await page.getByLabel('Filter retrieved events').fill('new-source');await expect(page.locator('.catalog-event-list li')).toHaveCount(1);const requestCount=received.length;
 await page.getByLabel('Filter retrieved events').fill('');expect(received).toHaveLength(requestCount);
 await page.screenshot({path:`output/playwright/cat49-historical-${testInfo.project.name}.png`,fullPage:true});
 await page.getByRole('heading',{name:'Historical earthquakes',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`output/playwright/cat49-historical-form-${testInfo.project.name}.png`,fullPage:true});
 await page.getByLabel('End date (UTC)').fill('2000-01-02');fail=true;await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Previous successful results are retained');await expect(page.getByText(/Retrieved query:.*1906-04-01/)).toBeVisible();await expect(page.getByText(/Last successful retrieval:/)).toBeVisible();
 fail=false;empty=true;await page.getByRole('button',{name:'Search historical earthquakes',exact:true}).click();await expect(page.getByText('No matching events in the retrieved results.',{exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
});
