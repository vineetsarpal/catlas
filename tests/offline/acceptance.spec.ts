import { test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function download(page:Page,button:Locator){const pending=page.waitForEvent('download');await button.click();return fs.readFile((await (await pending).path())!,'utf8');}
const button=(page:Page,name:string|RegExp)=>page.getByRole('button',{name,exact:typeof name==='string'});
const delivery=(page:Page)=>page.getByRole('region',{name:'Simulated RAS delivery',exact:true});
async function choose(page:Page,id:string){await page.getByRole('combobox',{name:'Demonstration scenario',exact:true}).selectOption(id);await expect(page.getByRole('region',{name:'Local history storage'})).toContainText('Saved locally');}
async function review(page:Page,version:number){await button(page,`Review evaluation v${version}`).click();return download(page,button(page,'Download reviewed JSON'));}
async function archive(page:Page){return JSON.parse(await download(page,button(page,'Export raw local history')));}
async function send(page:Page,outcome='accept'){await delivery(page).getByRole('combobox').selectOption(outcome);await delivery(page).getByRole('button',{name:'Send reviewed packet',exact:true}).click();}

test.beforeEach(async({page})=>{
 // Production-only browser journeys: no source modules, Vite server or external resources.
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='http://127.0.0.1:4178'||url.pathname.startsWith('/src/'))return route.abort();
  return route.continue();
 });
 await page.goto('/');
 await expect(page.getByRole('combobox',{name:'Demonstration scenario',exact:true})).toBeEnabled();
});

test('extracted static assets, genuine evidence, all five walkthroughs and map controls work offline',async({page},info)=>{
 await expect(page.getByTestId('treaty-total')).toHaveCount(0);
 await expect(page.getByTestId('analytical-map')).toHaveAttribute('data-ready','true');
 await page.screenshot({path:`offline-test-results/opening-${info.project.name}.png`});
 await choose(page,'ridgecrest');await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
 await expect(page.getByTestId('analytical-map')).toHaveAttribute('data-ready','true');
 await expect(page.locator('[data-zone-features]')).toHaveAttribute('data-zone-features','4');
 await expect(page.locator('[data-land-rendered]')).toHaveAttribute('data-land-rendered','true');
 await expect(page.getByText('Map unavailable',{exact:false})).toHaveCount(0);
 await expect.poll(async()=>Number(await page.locator('[data-camera-zoom]').getAttribute('data-camera-zoom'))).toBeGreaterThan(0);
 await page.getByTestId('analytical-map').screenshot({path:`offline-test-results/map-${info.project.name}.png`});
 const manifest=await (await page.request.get('/evidence/capture-manifest.json')).json();
 for(const file of manifest.files){const bytes=await (await page.request.get(`/evidence/${file.file}`)).body();expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);}
 const notices=await (await page.request.get('/THIRD_PARTY_NOTICES.md')).text();
 for(const name of ['maplibre-gl','react-dom','dexie','d3-geo','zod','scheduler','murmurhash-js'])expect(notices).toContain(`## ${name} `);
 const original=await review(page,1);const parsed=JSON.parse(original);expect(parsed.aggregation.totalRecovery).toBe(6000000);
 await button(page,'Western $1,500,000').click();await page.getByText('Appearance',{exact:true}).click();await page.getByRole('switch',{name:'Globe view',exact:true}).check();await page.getByText('Appearance',{exact:true}).click();
 expect(await download(page,button(page,'Download reviewed JSON'))).toBe(original);
 await page.getByText('Appearance',{exact:true}).click();await page.getByRole('switch',{name:'Globe view',exact:true}).uncheck();await page.getByText('Appearance',{exact:true}).click();
 await choose(page,'outer');await expect(page.getByTestId('treaty-total')).toHaveText('$3,750,000');
 const outer=JSON.parse(await review(page,1));expect(outer.evaluation.event.id).toBe('SIM-OUTER-01');expect(outer.evaluation.assessment.areas.map((a:any)=>a.contribution)).toEqual([2250000,1500000]);
 await choose(page,'high-threshold');await expect(page.getByTestId('treaty-total')).toHaveText('$0');
 expect(JSON.parse(await review(page,1)).aggregation.totalRecovery).toBe(0);await expect(button(page,'Send reviewed packet')).toBeDisabled();
 await choose(page,'incomplete');await expect(page.getByTestId('treaty-total')).toHaveText('Indeterminate');
 await button(page,'Prepare exception packet').click();const exception=JSON.parse(await download(page,button(page,'Download exception JSON')));
 expect(exception.aggregation.totalRecovery).toBeNull();expect(exception.review).toBeNull();await expect(button(page,'Send reviewed packet')).toBeDisabled();
 await choose(page,'sensitivity');await expect(page.getByTestId('treaty-total')).toHaveText('$4,000,000');
 const simulated=JSON.parse(await review(page,2));expect(simulated.evaluation.event.provenance.kind).toBe('simulation');
 await button(page,/Apply captured M7.1 reference/).click();await expect(page.getByTestId('treaty-total')).toHaveText('$6,000,000');
 await expect(button(page,'Download reviewed JSON')).toBeDisabled();
 const captured=JSON.parse(await review(page,3));expect(captured.evaluation.previousEvaluationId).toBe(simulated.evaluation.id);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('unconfirmed delivery reconciles before full replacements, zero correction, reload and reset',async({page},info)=>{
 const originalManifest=await (await page.request.get('/evidence/capture-manifest.json')).text();
 await choose(page,'sensitivity');const firstBytes=await review(page,1),first=JSON.parse(firstBytes);
 await send(page,'unconfirmed');await expect(delivery(page)).toContainText('Delivery unconfirmed');
 await expect(page.getByTestId('receiver-count')).toHaveText('1 simulated receiving record');
 await page.reload();await expect(page.getByTestId('delivery-attempt')).toHaveCount(1);
 await page.getByTestId('retained-evaluation').getByRole('button').click();
 expect(await download(page,button(page,'Download reviewed JSON'))).toBe(firstBytes);
 await button(page,/Apply captured M7.1 reference/).click();await expect(button(page,'Review evaluation v2')).toBeDisabled();
 await button(page,'Reconcile prior delivery status').click();
 const secondBytes=await review(page,2),second=JSON.parse(secondBytes);expect(second.replacement.previousPacketId).toBe(first.packetId);
 await send(page);await expect(delivery(page)).toContainText('Received by simulated RAS');
 await button(page,/Import fictional RAS terms v3/).click();await expect(page.getByTestId('treaty-total')).toHaveText('$0');
 const zeroBytes=await review(page,3),zero=JSON.parse(zeroBytes);expect(zero.replacement.previousPacketId).toBe(second.packetId);
 await send(page);await expect(delivery(page)).toContainText('Received by simulated RAS');
 await button(page,'Retry same reviewed packet').click();
 let raw=await archive(page);expect(raw.receiverRecords).toHaveLength(1);expect(raw.receiverRecords[0].currentAmount).toBe(0);
 expect(raw.submissions.find((s:any)=>s.packetId===second.packetId).payload).toBe(secondBytes);
 expect(raw.submissions.find((s:any)=>s.packetId===zero.packetId).payload).toBe(zeroBytes);
 expect(raw.deliveryAttempts.map((a:any)=>a.action)).toContain('check');
 await page.reload();await expect(page.getByTestId('retained-evaluation')).toHaveCount(3);
 expect(await download(page,button(page,`Download archived reviewed packet ${first.packetId.slice(0,8)}`))).toBe(firstBytes);
 await page.getByTestId('retained-evaluation').filter({hasText:'evaluation v3'}).getByRole('button').click();
 expect(await download(page,button(page,'Download reviewed JSON'))).toBe(zeroBytes);
 await delivery(page).screenshot({path:`offline-test-results/workflow-${info.project.name}.png`});
 await button(page,/Import incomplete fictional RAS terms v4/).click();await button(page,'Prepare exception packet').click();await expect(button(page,'Send reviewed packet')).toBeDisabled();
 await button(page,'Clear event selection').click();await expect(page.getByTestId('retained-evaluation')).toHaveCount(4);
 await button(page,'Reset demo data').click();await expect(page.getByTestId('receiver-count')).toHaveText('0 simulated receiving records');
 raw=await archive(page);for(const key of ['evaluations','packets','submissions','receiverRecords','deliveryAttempts'])expect(raw[key]).toEqual([]);
 expect(await (await page.request.get('/evidence/capture-manifest.json')).text()).toBe(originalManifest);
});

test('rejection and lost acknowledgement retry keep one receiving record and identical bytes',async({page})=>{
 await choose(page,'ridgecrest');const bytes=await review(page,1);await send(page,'reject');
 await expect(delivery(page)).toContainText('Rejected by simulated RAS');await expect(page.getByTestId('receiver-count')).toHaveText('0 simulated receiving records');
 await delivery(page).getByRole('combobox').selectOption('unconfirmed');await button(page,'Retry same reviewed packet').click();await expect(delivery(page)).toContainText('Delivery unconfirmed');
 await delivery(page).getByRole('combobox').selectOption('accept');await button(page,'Retry same reviewed packet').click();await expect(delivery(page)).toContainText('Received by simulated RAS');
 const raw=await archive(page);expect(raw.receiverRecords).toHaveLength(1);expect(raw.submissions).toHaveLength(1);expect(raw.deliveryAttempts).toHaveLength(3);expect(raw.submissions[0].payload).toBe(bytes);
 expect(new Set(raw.deliveryAttempts.map((a:any)=>a.submissionId)).size).toBe(1);
});
