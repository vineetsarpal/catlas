import { test, expect, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import { openLocations } from '../helpers/exposure-workspace';

// Approved browser/HTTP seams: original public-source bytes are external fixtures.
// No saved-case repository, assessment implementation or internal collaborator is mocked.
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function keyboardActivate(page:Page,target:Locator){await expect(target).toBeEnabled();await target.focus();await expect(target).toBeFocused();await page.keyboard.press('Enter');}
async function downloadCase(page:Page){await openLocations(page);const pending=page.waitForEvent('download');await keyboardActivate(page,page.getByRole('button',{name:'Download self-contained case',exact:true}));const bytes=await fs.readFile((await(await pending).path())!);return{bytes,envelope:JSON.parse(gunzipSync(bytes).toString())};}

test('keyboard recent and historical inspection, explicit revision and offline transfer preserve the case and public-only idle request boundary',async({page,browser},info)=>{
 test.setTimeout(120_000);
 if(info.project.name==='desktop')await page.setViewportSize({width:1280,height:900});
 await page.clock.install();
 const originalDetail=await fs.readFile('frontend/public/evidence/ridgecrest-detail.geojson');
 const grid=gunzipSync(await fs.readFile('frontend/public/evidence/shaking/ridgecrest-grid.xml.gz'));
 const source=JSON.parse(originalDetail.toString());
 const event={id:source.id,aliases:source.properties.ids.split(',').filter(Boolean),name:source.properties.place,magnitude:source.properties.mag,longitude:source.geometry.coordinates[0],latitude:source.geometry.coordinates[1],occurredAt:new Date(source.properties.time).toISOString(),updatedAt:new Date(source.properties.updated).toISOString(),significance:source.properties.sig};
 const originalProduct=source.properties.products.shakemap.find((p:{id:string})=>p.id==='urn:usgs-product:atlas:shakemap:ci38457511:1594160054783');
 const revised=structuredClone(source);revised.properties.products.shakemap=[{...originalProduct,id:'cat57-explicit-revised-product',updateTime:Date.parse('2026-10-27T12:00:00.000Z')}];revised.properties.updated=Date.parse('2026-10-27T12:00:00.000Z');
 const revisedDetail=Buffer.from(JSON.stringify(revised));const objects=new Map<string,Buffer>();
 const artifact=(bytes:Buffer,kind:'detail'|'grid')=>{const sha256=digest(bytes);objects.set(sha256,bytes);return{sha256,bytes:bytes.length,path:`/api/artifacts/${sha256}`,sourceUrl:kind==='grid'?originalProduct.contents['download/grid.xml'].url:`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${event.id}.geojson`,contentType:kind==='grid'?'application/xml':'application/geo+json'};};
 const capture=(version:1|2)=>({schemaVersion:1,event:version===1?event:{...event,updatedAt:'2026-10-27T12:00:00.000Z'},product:{id:version===1?originalProduct.id:'cat57-explicit-revised-product',source:'atlas',code:originalProduct.code,updatedAt:version===1?new Date(originalProduct.updateTime).toISOString():'2026-10-27T12:00:00.000Z',retrospective:true},capturedAt:version===1?'2026-10-27T10:00:00.000Z':'2026-10-27T12:01:00.000Z',artifacts:{detail:artifact(version===1?originalDetail:revisedDetail,'detail'),grid:artifact(grid,'grid')}});
 const requests:{method:string;path:string;query:Record<string,string>;body:unknown;authorization:boolean}[]=[];
 await page.route('**/api/exposure/**',async route=>{
  const r=route.request(),url=new URL(r.url());requests.push({method:r.method(),path:url.pathname,query:Object.fromEntries(url.searchParams),body:r.postData()?r.postDataJSON():null,authorization:!!r.headers().authorization});
  if(url.pathname.endsWith('/catalog'))return route.fulfill({json:{events:[event],checkedAt:'2026-10-27T10:00:00.000Z',range:{start:'2019-07-01T00:00:00.000Z',end:'2019-07-07T23:59:59.999Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}});
  if(url.pathname.endsWith('/captures/check'))return route.fulfill({json:capture(2)});
  if(url.pathname.endsWith('/captures'))return route.fulfill({json:capture(1)});
  const bytes=objects.get(url.pathname.split('/').at(-1)!);return bytes?route.fulfill({body:bytes}):route.fulfill({status:404});
 });
 await page.goto('/exposure.html');
 await keyboardActivate(page,page.getByRole('button',{name:'Portfolios',exact:true}));await keyboardActivate(page,page.getByRole('button',{name:'Use demo portfolio',exact:true}));await keyboardActivate(page,page.getByRole('button',{name:'Exposure',exact:true}));
 const recent=page.getByRole('button',{name:'Recent events',exact:true});await recent.focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Historical search',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 const id=page.getByLabel('Source event ID',{exact:true});await id.focus();await page.keyboard.type(event.id);await keyboardActivate(page,page.getByRole('button',{name:'Search historical earthquakes',exact:true}));
 await expect(page.getByText(`Source ID ${event.id}`,{exact:false}).first()).toBeVisible();
 await keyboardActivate(page,page.getByRole('button',{name:/Ridgecrest Earthquake Sequence/}));
 const inspector=page.getByRole('complementary',{name:'Earthquake evidence inspector'});await expect(inspector).toContainText(digest(grid));await expect(page.getByTestId('exposure-count')).toHaveText('—');
 await keyboardActivate(page,page.getByRole('button',{name:'Assess portfolio',exact:true}));await expect(page.getByTestId('exposure-count')).toHaveText('11');await keyboardActivate(page,page.getByRole('button',{name:'Save investigation',exact:true}));
 const v1=await downloadCase(page);expect(v1.envelope.rawEventJson).toBe(originalDetail.toString());
 await keyboardActivate(page,page.getByRole('button',{name:'Check source for updates',exact:true}));await expect(page.getByRole('region',{name:'Captured update to apply'})).toContainText('cat57-explicit-revised-product');expect((await downloadCase(page)).envelope).toEqual(v1.envelope);
 await keyboardActivate(page,page.getByRole('button',{name:'Apply selected evidence as new version',exact:true}));await keyboardActivate(page,page.getByRole('button',{name:'Save investigation',exact:true}));const v2=await downloadCase(page);
 expect(v2.envelope.record).toMatchObject({caseId:v1.envelope.record.caseId,version:2,previousId:v1.envelope.record.id,portfolioHash:v1.envelope.record.portfolioHash,summary:{meetingThreshold:11,unknownIntensity:2,knownValueByCurrency:{USD:128000000}}});expect(v2.envelope.rawEventJson).toBe(revisedDetail.toString());
 // A ten-minute browser idle interval must not poll acquisition or maintenance.
 const beforeIdle=requests.length;await page.clock.fastForward(600_000);expect(requests).toHaveLength(beforeIdle);
 await fs.mkdir('docs.local/research',{recursive:true});await fs.writeFile(`docs.local/research/cat57-browser-network-${info.project.name}.json`,JSON.stringify({scope:'local browser with public HTTP fixtures; not a hosted Neon trace',idleMilliseconds:600000,idleRequests:requests.length-beforeIdle,requests},null,2));
 expect(requests.filter(r=>r.method==='POST').map(r=>({path:r.path,body:r.body}))).toEqual([{path:'/api/exposure/captures',body:{eventId:event.id}},{path:'/api/exposure/captures/check',body:{eventId:event.id}}]);expect(requests.every(r=>!r.authorization&&!r.path.includes('maintenance'))).toBe(true);
 expect(requests.filter(r=>r.path.endsWith('/catalog')).some(r=>r.query.eventId===event.id&&r.query.mode==='historical')).toBe(true);
 await page.screenshot({path:`docs.local/research/cat57-assessed-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const context=await browser.newContext({viewport:info.project.name==='desktop'?{width:1280,height:900}:{width:375,height:812}});const other=await context.newPage();const remote:string[]=[];await other.route('**/api/exposure/**',route=>{remote.push(route.request().method()+' '+new URL(route.request().url()).pathname);return route.abort();});await other.goto('/exposure.html');
 await keyboardActivate(other,other.getByRole('button',{name:'Saved',exact:true}));await other.getByLabel('Open a self-contained case').setInputFiles({name:'cat57-v2.json.gz',mimeType:'application/gzip',buffer:v2.bytes});await expect(other.getByTestId('exposure-count')).toHaveText('11');expect((await downloadCase(other)).envelope).toEqual(v2.envelope);await other.reload();await keyboardActivate(other,other.getByRole('button',{name:'Saved',exact:true}));await keyboardActivate(other,other.getByRole('button',{name:'Open saved version 2',exact:true}));expect((await downloadCase(other)).envelope).toEqual(v2.envelope);expect(remote.length).toBeGreaterThan(0);expect(remote.every(request=>request==='GET /api/exposure/catalog')).toBe(true);
 await context.close();
});
