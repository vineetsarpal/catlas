import { test, expect } from '@playwright/test';
const event = { id:'us-test', name:'Recent public earthquake', magnitude:6.2, latitude:35.7, longitude:-117.6, occurredAt:'2026-10-24T10:00:00.000Z', updatedAt:'2026-10-24T11:00:00.000Z', aliases:['us-test'], significance:700 };
const catalog = { events:[event], checkedAt:'2026-10-25T12:00:00.000Z', range:{start:'2026-07-27T12:00:00.000Z',end:'2026-10-25T12:00:00.000Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0 };
test('browse recent events and inspect without automatically assessing or saving',async({page})=>{
 let captures=0, discovery=0;
 await page.route('**/api/exposure/catalog?**',async route=>{discovery++;await route.fulfill({json:catalog});});
 await page.route('**/api/exposure/captures',async route=>{captures++;await route.fulfill({status:422,json:{error:{code:'evidence_unavailable',message:'No supported shaking evidence is available.'}}});});
 await page.goto('/exposure.html');
 await expect(page.getByRole('navigation',{name:'Investigation tools'})).toBeVisible();
 await expect(page.getByLabel('Catlas significance >600')).toBeChecked();
 await page.getByRole('button',{name:/Recent public earthquake/}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('complementary',{name:'Earthquake evidence inspector'})).toContainText('No supported shaking evidence');
 await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Investigate selected earthquake',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 const discovered = discovery;
 await page.clock.install();await page.clock.fastForward(120000);
 expect(captures).toBe(1);expect(discovery).toBe(discovered);
 await page.getByRole('button',{name:'Saved',exact:true}).click();
 await expect(page.getByText('No exposure cases saved yet.')).toBeVisible();
});

test('load-more source aliases coalesce identities without merging similarly named events',async({page})=>{
 const first={...event,id:'source-a',aliases:['source-a']},second={...event,id:'source-b',aliases:['source-b']};
 const bridge={...event,id:'canonical',aliases:['source-a','source-b','canonical'],updatedAt:'2026-10-25T11:00:00.000Z'};
 await page.route('**/api/exposure/catalog?**',route=>{const params=new URL(route.request().url()).searchParams;if(params.get('offset')==='50')expect(params.get('end')).toBe(catalog.range.end);return route.fulfill({json:params.get('offset')==='0'?{...catalog,events:[first,second],hasMore:true,completeness:'more-available'}:{...catalog,events:[bridge],offset:50}});});
 await page.goto('/exposure.html');
 await expect(page.locator('.catalog-event-list li')).toHaveCount(2);
 await page.getByRole('button',{name:'Load more earthquakes',exact:true}).click();
 await expect(page.locator('.catalog-event-list li')).toHaveCount(1);
 await expect(page.locator('.catalog-event-list')).toContainText('canonical');
});

test('verified archive evidence waits for explicit assessment and save',async({page})=>{
 const { createHash } = await import('node:crypto');
 const grid=Buffer.from('<shakemap_grid event_id="us-test" shakemap_version="1" process_timestamp="2026-10-24T11:00:00Z"><event event_id="us-test"/><grid_specification nlon="2" nlat="2"/><grid_field name="MMI" index="1" units="intensity"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="LON" index="3" units="dd"/><grid_data>6 36 -118\n8 36 -117\n4 35 -118\n6 35 -117</grid_data></shakemap_grid>');
 const detail=Buffer.from(JSON.stringify({id:'us-test',properties:{mag:6.2,magType:'mw',time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt)},geometry:{coordinates:[-117.6,35.7,8]}}));
 const artifact=(bytes:Buffer,kind:string)=>{const sha256=createHash('sha256').update(bytes).digest('hex');return {sha256,bytes:bytes.length,path:`/api/artifacts/${sha256}`,sourceUrl:`https://earthquake.usgs.gov/${kind}`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const artifacts={detail:artifact(detail,'detail'),grid:artifact(grid,'grid')};
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:catalog}));
 await page.route('**/api/exposure/captures',route=>route.fulfill({status:201,json:{schemaVersion:1,event,product:{id:'product:us-test',source:'us',code:'us-test',updatedAt:event.updatedAt,retrospective:false},capturedAt:'2026-10-25T12:00:00.000Z',artifacts}}));
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:route.request().url().endsWith(artifacts.grid.sha256)?grid:detail}));
 await page.goto('/exposure.html');
 await page.getByRole('button',{name:'Portfolios',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();
 await page.getByRole('button',{name:/Recent public earthquake/}).click();
 await expect(page.getByRole('complementary',{name:'Earthquake evidence inspector'})).toContainText(artifacts.grid.sha256);
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await expect(page.getByRole('button',{name:'Save investigation',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).not.toHaveText('—');
 await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 await page.getByRole('button',{name:'Saved',exact:true}).click();
 await expect(page.locator('.atlas-catalog-panel .exposure-history li')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('failed refresh retains timestamped results and a changed filter cannot mix pages',async({page})=>{
 let failure=false,empty=false;
 await page.route('**/api/exposure/catalog?**',route=>failure?route.fulfill({status:503,json:{error:{code:'source_unavailable'}}}):route.fulfill({json:{...catalog,events:empty?[]:catalog.events,hasMore:!empty,completeness:empty?'complete':'more-available'}}));
 await page.goto('/exposure.html');
 await expect(page.getByRole('button',{name:/Recent public earthquake/})).toBeVisible();
 failure=true;await page.getByRole('button',{name:'Refresh events',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Previous successful results are retained');
 await expect(page.getByRole('button',{name:/Recent public earthquake/})).toBeVisible();
 await expect(page.getByText(/Last successful retrieval:/)).toBeVisible();
 await page.getByLabel('Catlas significance >600').uncheck();
 await expect(page.getByRole('button',{name:'Load more earthquakes',exact:true})).toBeDisabled();
 await expect(page.getByRole('alert')).toContainText('Event discovery failed');
 failure=false;empty=true;await page.getByRole('button',{name:'Refresh events',exact:true}).click();
 await expect(page.getByText('No matching events in the retrieved results.',{exact:true})).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('evidence inspector moves below the map at narrower desktop widths',async({page},testInfo)=>{
 await page.setViewportSize({width:1100,height:850});
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:catalog}));
 await page.goto('/exposure.html');
 const map=await page.locator('.atlas-map-stage').boundingBox(),inspector=await page.getByRole('complementary',{name:'Earthquake evidence inspector'}).boundingBox();
 expect(map).not.toBeNull();expect(inspector).not.toBeNull();
 expect(inspector!.y).toBeGreaterThanOrEqual(map!.y+map!.height-1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`output/playwright/cat48-narrow-layout-${testInfo.project.name}.png`,fullPage:true});
});


test('corrupted archive bytes cannot enable assessment or leak insured data',async({page})=>{
 const sha='0'.repeat(64),detail=Buffer.from(JSON.stringify({id:event.id}));let capturedBody:unknown;
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:catalog}));
 const artifact={sha256:sha,bytes:detail.length,path:`/api/artifacts/${sha}`,sourceUrl:'https://earthquake.usgs.gov/detail',contentType:'application/geo+json'};
 await page.route('**/api/exposure/captures',route=>{capturedBody=route.request().postDataJSON();return route.fulfill({status:201,json:{schemaVersion:1,event,product:{id:'product:test',source:'us',code:event.id,updatedAt:event.updatedAt,retrospective:false},capturedAt:catalog.checkedAt,artifacts:{detail:artifact,grid:artifact}}});});
 await page.route('**/api/exposure/artifacts/*',route=>route.fulfill({body:detail}));
 await page.goto('/exposure.html');
 await page.getByRole('button',{name:/Recent public earthquake/}).click();
 await expect(page.getByRole('complementary',{name:'Earthquake evidence inspector'})).toContainText('SHA-256');
 await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeDisabled();
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 expect(capturedBody).toEqual({eventId:event.id});
});


test('Monitor opens the same evidence inspection without a portfolio or automatic assessment',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:true,cyclones:false,fires:false,perimeters:false,alerts:false,wind:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[]})));
 await page.route('https://earthquake.usgs.gov/earthquakes/feed/**',route=>route.fulfill({json:{type:'FeatureCollection',features:[{type:'Feature',id:event.id,properties:{mag:event.magnitude,place:event.name,time:Date.parse(event.occurredAt),updated:Date.parse(event.updatedAt)},geometry:{type:'Point',coordinates:[event.longitude,event.latitude,8]}}]}}));
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:catalog}));
 let captures=0;
 await page.route('**/api/exposure/captures',route=>{captures++;expect(route.request().postDataJSON()).toEqual({eventId:event.id});return route.fulfill({status:422,json:{error:{code:'evidence_unavailable'}}});});
 await page.goto('/?mode=monitor');
 if(!await page.getByRole('complementary',{name:'Monitor details',exact:true}).isVisible())await page.getByRole('button',{name:'Attention',exact:true}).click();
 await page.getByRole('button',{name:/M6.2.*Recent public earthquake/}).click();
 const inspect=page.getByRole('button',{name:'Inspect earthquake in Exposure →',exact:true});
 await expect(inspect).toBeEnabled();await inspect.click();
 await expect(page.getByRole('button',{name:'Exposure',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('complementary',{name:'Earthquake evidence inspector'})).toContainText('No supported shaking evidence');
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 expect(captures).toBe(1);
});

test('unavailable live evidence still permits an explicit packaged replay',async({page})=>{
 await page.route('**/api/exposure/catalog?**',route=>route.fulfill({json:catalog}));
 await page.route('**/api/exposure/captures',route=>route.fulfill({status:422,json:{error:{code:'evidence_unavailable'}}}));
 await page.goto('/exposure.html');
 await page.getByRole('button',{name:/Recent public earthquake/}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await page.getByRole('button',{name:'Assess packaged Ridgecrest replay',exact:true}).click();
 await expect(page.getByTestId('exposure-count')).toHaveText('11');
 await expect(page.getByRole('heading',{level:1})).toContainText('Ridgecrest');
});

test('Events and Saved share the map sidebar with Layers and retain the catalog between tools',async({page})=>{
 let discoveries=0;
 await page.route('**/api/exposure/catalog?**',route=>{discoveries++;return route.fulfill({json:catalog});});
 await page.goto('/exposure.html');
 const tools=page.getByRole('navigation',{name:'Investigation tools'});
 await expect(tools.getByRole('button',{name:'Events',exact:true})).toBeVisible();
 await expect(tools.getByRole('button',{name:'Saved',exact:true})).toBeVisible();
 await expect(tools.getByRole('button',{name:'Events',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('button',{name:/Recent public earthquake/})).toBeVisible();
 const received=discoveries;
 await tools.getByRole('button',{name:'Layers',exact:true}).click();
 await expect(page.locator('#atlas-side-panel')).toContainText('Map layers');
 await expect(page.getByRole('button',{name:/Recent public earthquake/})).toBeHidden();
 await tools.getByRole('button',{name:'Saved',exact:true}).click();
 await expect(page.locator('#atlas-side-panel')).toContainText('No exposure cases saved yet.');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await tools.getByRole('button',{name:'Events',exact:true}).click();
 await expect(page.getByRole('button',{name:/Recent public earthquake/})).toBeVisible();
 expect(discoveries).toBe(received);
 await tools.getByRole('button',{name:'Events',exact:true}).click();
 await expect(page.locator('#atlas-side-panel')).toBeHidden();
});
