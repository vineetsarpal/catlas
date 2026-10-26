import { test, expect, type Page } from '@playwright/test';
import type { FireDetection, FirePerimeter, HazardSnapshot, WeatherAlert } from '../../shared/src/hazards';

const at='2026-10-20T12:00:00.000Z';
const boundary:NonNullable<FirePerimeter['geometry']>={type:'Polygon' as const,coordinates:[[[-117.73,35.60],[-117.64,35.60],[-117.64,35.66],[-117.73,35.66],[-117.73,35.60]]]};
const perimeter:FirePerimeter={id:'incident-1',name:'Ridgecrest test fire',geometry:boundary,updatedAt:at,containment:15,sourceUrl:'https://www.nifc.gov/'};
function alert(id:string,patch:Partial<WeatherAlert>={}):WeatherAlert{return {id,references:[],name:`Ridgecrest warning ${id}`,event:'Red Flag Warning',severity:'Severe',certainty:'Observed',urgency:'Immediate',issuedAt:at,updatedAt:at,expiresAt:'2026-10-20T12:05:00.000Z',active:true,geometry:boundary,description:'Official test alert evidence.',sourceUrl:'https://weather.gov/',...patch};}
function snapshot<T>(rows:T[],patch:Partial<HazardSnapshot<T>>={}):HazardSnapshot<T>{return {fetchedAt:at,stale:false,warning:'',rejected:0,rows,...patch};}
async function details(page:Page,tab='Attention'){
  const tool=page.getByRole('navigation',{name:'Monitor tools'}).getByRole('button',{name:tab,exact:true});
  if(await tool.getAttribute('aria-expanded')!=='true')await tool.click();
  return page.getByRole('region',{name:'Live monitoring controls'});
}
async function layers(page:Page){
  const close=page.getByRole('button',{name:'Close monitor details',exact:true});
  if(await close.isVisible())await close.click();
  await page.getByRole('navigation',{name:'Monitor tools'}).getByRole('button',{name:'Layers',exact:true}).click();
}
async function closeLayers(page:Page){await page.getByRole('navigation',{name:'Monitor tools'}).getByRole('button',{name:'Layers',exact:true}).click();}
async function feeds(page:Page,state:{fires:HazardSnapshot<FireDetection>;perimeters:HazardSnapshot<FirePerimeter>;alerts:HazardSnapshot<WeatherAlert>;fireError?:boolean}){
  await page.route('**/api/monitor/fires',route=>route.fulfill(state.fireError?{status:503,json:{error:'Configure FIRMS_MAP_KEY to enable fire detections.'}}:{json:state.fires}));
  await page.route('**/api/monitor/perimeters',route=>route.fulfill({json:state.perimeters}));
  await page.route('**/api/monitor/alerts',route=>route.fulfill({json:state.alerts}));
}
test.beforeEach(async({page})=>{
  test.skip(process.env.VITE_CATLAS_BACKEND!=='true','Run this suite with VITE_CATLAS_BACKEND=true.');
  await page.clock.install({time:new Date(at)});
  await page.addInitScript(()=>{if(!localStorage.getItem('catlas-monitor-1'))localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:false,cyclones:false,wind:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[],fireDistanceKm:0}));});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/?mode=portfolios');
  await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();
  await expect(page.getByLabel('Portfolio inventory summary')).toContainText('18');
});

test('published perimeter screens insured values and its toggle controls monitoring and map display',async({page})=>{
  await feeds(page,{fires:snapshot([]),perimeters:snapshot([perimeter]),alerts:snapshot([])});
  await page.goto('/?mode=monitor');
  let panel=await details(page);let row=panel.locator('article').filter({has:page.getByRole('button',{name:perimeter.name,exact:true})});
  await expect(row).toContainText('Inside published fire perimeter');
  await expect(row).toContainText('4 portfolio locations flagged for attention');
  await expect(row).toContainText('TIV: USD 62,000,000');
  await expect(row).toContainText('1 flagged locations have unknown insured value.');
  await layers(page);await expect(page.getByLabel('Show fire perimeters on map',{exact:true})).toHaveCount(0);await closeLayers(page);
  await layers(page);await page.getByRole('switch',{name:'Fire perimeters',exact:true}).uncheck();await closeLayers(page);
  panel=await details(page);await expect(panel.getByRole('button',{name:perimeter.name,exact:true})).toHaveCount(0);
});

test('unresolved warning remains inspectable without invented coordinates or zero matches',async({page})=>{
  const warning=alert('missing-boundary',{geometry:null});
  await feeds(page,{fires:snapshot([]),perimeters:snapshot([]),alerts:snapshot([warning])});
  await page.goto('/?mode=monitor');const panel=await details(page);
  await expect(panel).toContainText('Location screening unavailable');
  await expect(panel).not.toContainText('0 portfolio locations flagged');
  await panel.getByRole('button',{name:warning.name,exact:true}).click();
  const inspector=page.getByRole('complementary',{name:'Selected monitoring item'});
  await expect(inspector).toBeVisible();await expect(inspector).toContainText('Official test alert evidence.');
  await expect(inspector.locator('.monitor-inspector-coordinates')).toHaveCount(0);
  await expect(inspector).toContainText('Location screening unavailable');
});

test('Canadian alert areas screen CAD locations and retain native evidence, watches and expiry',async({page},testInfo)=>{
  await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Add locations',exact:true}).click();
  await page.getByRole('button',{name:'Add location',exact:true}).click();
  const form=page.getByRole('form',{name:'Add location',exact:true});
  await form.getByLabel('Location ID',{exact:true}).fill('CA-TORONTO');
  await form.getByLabel('Location name',{exact:true}).fill('Toronto test location');
  await form.getByLabel('Latitude',{exact:true}).fill('43.65');
  await form.getByLabel('Longitude',{exact:true}).fill('-79.38');
  await form.getByLabel('Total insured value',{exact:true}).fill('2500000');
  await form.getByLabel('Currency',{exact:true}).fill('CAD');
  await form.getByRole('button',{name:'Save location',exact:true}).click();
  const canadian:WeatherAlert={...alert('eccc:toronto-test'),provider:'ECCC',name:'Toronto test frost advisory',event:'frost advisory',severity:'Not supplied',certainty:'Not supplied',urgency:'Not supplied',geometry:{type:'Polygon',coordinates:[[[-80,43],[-79,43],[-79,44],[-80,44],[-80,43]]]},description:'Frost expected in this synthetic Canadian alert.',sourceUrl:'https://api.weather.gc.ca/collections/weather-alerts/items/toronto-test?f=html',eccc:{area:'Toronto',province:'ON',alertType:'advisory',status:'continued',riskColour:'yellow',impact:'Moderate',confidence:'High',validAt:at,eventEndAt:null,nameFr:'Avis de gel',descriptionFr:'Gel prévu cette nuit.'}};
  const state={fires:snapshot<FireDetection>([]),perimeters:snapshot<FirePerimeter>([]),alerts:{...snapshot([canadian]),sources:[{provider:'NWS',fetchedAt:at,stale:true,warning:'US source unavailable',rejected:0},{provider:'ECCC',fetchedAt:at,stale:false,warning:'',rejected:0}],stale:true,warning:'NWS: US source unavailable'}};
  await feeds(page,state);await page.goto('/?mode=monitor');let panel=await details(page);
  const row=panel.locator('article').filter({has:page.getByRole('button',{name:canadian.name,exact:true})});
  await expect(row).toContainText('1 portfolio locations flagged for attention');
  await expect(row).toContainText('TIV: CAD 2,500,000');
  await row.getByRole('button',{name:canadian.name,exact:true}).click();
  const inspector=page.getByRole('complementary',{name:'Selected monitoring item'});
  await expect(inspector).toContainText('ECCC · Canada');
  await expect(inspector).toContainText('Risk colour: yellow · Impact: Moderate · Confidence: High');
  await expect(inspector).not.toContainText('Not supplied');
  await inspector.getByText('Français',{exact:true}).click();
  await expect(inspector).toContainText('Gel prévu cette nuit.');
  await page.screenshot({path:testInfo.outputPath('eccc-alert.png')});
  await inspector.getByRole('button',{name:'Add to watchlist',exact:true}).click();
  await inspector.getByRole('button',{name:'Close item details',exact:true}).click();
  panel=await details(page,'Feeds');await expect(panel).toContainText('ECCC · Canada');await expect(panel).toContainText('US source unavailable');
  await layers(page);await page.getByRole('switch',{name:'Weather warnings',exact:true}).uncheck();await closeLayers(page);
  panel=await details(page,'Watchlist');await expect(panel.getByRole('button',{name:canadian.name,exact:true})).toBeDisabled();
  await layers(page);await page.getByRole('switch',{name:'Weather warnings',exact:true}).check();await closeLayers(page);
  panel=await details(page,'Watchlist');await expect(panel.getByRole('button',{name:canadian.name,exact:true})).toBeEnabled();
  await page.clock.fastForward(6*60000);
  await expect(panel.getByRole('button',{name:canadian.name,exact:true})).toBeDisabled();
});

test('watched warning follows an update then remains saved after expiry',async({page})=>{
  const first=alert('initial');const state={fires:snapshot<FireDetection>([]),perimeters:snapshot<FirePerimeter>([]),alerts:snapshot([first])};
  await feeds(page,state);await page.goto('/?mode=monitor');let panel=await details(page);
  await panel.getByRole('button',{name:first.name,exact:true}).click();
  await page.getByRole('button',{name:'Add to watchlist',exact:true}).click();
  await page.getByRole('button',{name:'Close item details',exact:true}).click();
  state.alerts=snapshot([alert('updated',{references:['initial'],updatedAt:'2026-10-20T12:01:00.000Z'})]);
  panel=await details(page,'Feeds');await panel.getByRole('button',{name:'Refresh enabled feeds',exact:true}).click();
  panel=await details(page,'Watchlist');await expect(panel.getByRole('button',{name:'Ridgecrest warning updated',exact:true})).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('catlas-monitor-1')!).watchlist[0].key)).toBe('alert:updated');
  await page.clock.fastForward(6*60000);
  await expect(panel.getByRole('button',{name:'Ridgecrest warning updated',exact:true})).toBeDisabled();
  await expect(panel).toContainText('Ended, outside current feed or monitoring disabled');
  panel=await details(page,'Attention');await expect(panel.getByRole('button',{name:'Ridgecrest warning updated',exact:true})).toHaveCount(0);
});

test('missing FIRMS credentials and partial perimeter evidence are explicit',async({page})=>{
  const state={fires:snapshot<FireDetection>([]),perimeters:snapshot([perimeter],{stale:true,warning:'One perimeter page unavailable; coverage is partial.',rejected:2}),alerts:snapshot<WeatherAlert>([]),fireError:true};
  await feeds(page,state);await page.goto('/?mode=monitor');let panel=await details(page);
  await expect(panel.getByRole('status')).toContainText('Some feeds are unavailable.');
  await expect(panel.getByRole('button',{name:perimeter.name,exact:true})).toBeVisible();
  panel=await details(page,'Feeds');
  await expect(panel).toContainText('Configure FIRMS_MAP_KEY');
  await expect(panel).toContainText('Fire incidents / perimeters: retained source data is stale.');
  await expect(panel).toContainText('Fire incidents / perimeters: One perimeter page unavailable; coverage is partial.');
  await expect(panel).toContainText('Fire incidents / perimeters: 2 unsupported records omitted.');
});

test('nearby detections contribute while enabled and expire even when refresh fails',async({page})=>{
  const detection:FireDetection={id:'satellite-a',longitude:-117.67,latitude:35.62,detectedAt:at,source:'VIIRS',confidence:90};
  const state={fires:snapshot([detection,{...detection,id:'satellite-b'}]),perimeters:snapshot<FirePerimeter>([]),alerts:snapshot<WeatherAlert>([]),fireError:false};
  await feeds(page,state);await page.goto('/?mode=monitor');let panel=await details(page);
  const group='Nearby fire detections — Ridgecrest medical centre';
  await expect(panel.getByRole('button',{name:group,exact:true})).toBeVisible();
  await expect(panel.locator('article').filter({has:page.getByRole('button',{name:group,exact:true})})).toContainText('Near detected fire activity');
  await layers(page);await expect(page.getByRole('switch',{name:'Fire detections',exact:true})).toBeChecked();await expect(page.getByLabel('Show fire detections on map',{exact:true})).toHaveCount(0);await closeLayers(page);
  panel=await details(page);await expect(panel.getByRole('button',{name:group,exact:true})).toBeVisible();
  state.fireError=true;await page.clock.fastForward(25*3600000);
  await expect(panel.getByRole('button',{name:group,exact:true})).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('Some feeds are unavailable.');
});

test('fire map groups observations, preserves selection, fits a perimeter and keeps portfolio attention unchanged',async({page},testInfo)=>{
  const detections=Array.from({length:12},(_,i):FireDetection=>({id:`satellite-${i}`,longitude:-117.685+i*.00002,latitude:35.63,detectedAt:at,source:'VIIRS NOAA-20',confidence:null}));
  await feeds(page,{fires:snapshot(detections),perimeters:snapshot([perimeter]),alerts:snapshot([])});
  await page.goto('/?mode=monitor');
  let panel=await details(page);
  const row=panel.locator('article').filter({has:page.getByRole('button',{name:perimeter.name,exact:true})});
  await expect(row).toContainText('TIV: USD 62,000,000');
  await row.getByRole('button',{name:perimeter.name,exact:true}).click();
  await page.getByRole('button',{name:'Item details',exact:true}).click();
  const card=page.getByRole('region',{name:'Selected fire map card'});
  await expect(card).toContainText('15% contained');
  await expect(card).toContainText('USD 62,000,000 TIV');
  await expect(card).toContainText('1 with unknown insured value');
  const map=page.getByTestId('exposure-map');
  await expect.poll(async()=>Number(await map.getAttribute('data-camera-zoom'))).toBeGreaterThan(8);
  await card.getByRole('button',{name:'Watch fire activity',exact:true}).click();
  await expect(card.getByRole('button',{name:'Remove fire watch',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('fire-map.png')});
  await page.getByText('Appearance',{exact:true}).click();
  await page.getByRole('button',{name:'Dark map',exact:true}).click();
  await page.getByText('Appearance',{exact:true}).click();
  await page.clock.runFor(500);
  await expect(card).toContainText('USD 62,000,000 TIV');
  await page.screenshot({path:testInfo.outputPath('fire-map-dark.png')});
  await page.getByText('Appearance',{exact:true}).click();
  await page.getByRole('button',{name:'Light map',exact:true}).click();
  await page.getByText('Appearance',{exact:true}).click();
  await card.getByRole('button',{name:'Dismiss fire map selection'}).click();
  await layers(page);await page.getByRole('switch',{name:'Fire detections',exact:true}).check();
  // Insured locations sit in front and receive overlapping clicks. Hide them to exercise fire selection.
  await page.getByRole('switch',{name:'Insured locations',exact:true}).uncheck();await closeLayers(page);
  await expect.poll(async()=>Number(await map.getAttribute('data-fire-detections'))).toBeGreaterThan(0);
  // Broad-scale groups expand to the original detection positions when selected.
  for(let i=0;i<5;i++){
    await page.getByRole('button',{name:'Zoom out',exact:true}).click();
    await page.clock.runFor(500);
  }
  await expect.poll(async()=>Number(await map.getAttribute('data-fire-clusters'))).toBeGreaterThan(0);
  const box=await map.boundingBox();if(!box)throw Error('Map is not visible');
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await page.clock.runFor(500);
  await expect.poll(async()=>Number(await map.getAttribute('data-camera-zoom'))).toBeGreaterThan(7);
  await expect.poll(async()=>Number(await map.getAttribute('data-fire-detections'))).toBeGreaterThan(0);
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await page.clock.runFor(500);
  await page.getByRole('button',{name:'Item details',exact:true}).click();
  await expect(card).toContainText('SATELLITE DETECTION');
  await expect(card).toContainText('VIIRS NOAA-20');
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:'Zoom out',exact:true}).click();
    await page.clock.runFor(500);
  }
  await expect.poll(async()=>Number(await map.getAttribute('data-selected-fires'))).toBeGreaterThan(0);
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Dismiss fire map selection'}).click();
  panel=await details(page);
  await expect(panel.locator('article').filter({has:page.getByRole('button',{name:perimeter.name,exact:true})})).toContainText('TIV: USD 62,000,000');
  await layers(page);await page.getByRole('switch',{name:'Fire detections',exact:true}).uncheck();await closeLayers(page);
  await expect(map).toHaveAttribute('data-fire-clusters','0');
  await expect(map).toHaveAttribute('data-fire-detections','0');
  await expect(page.getByText(/^Map display:/)).toHaveCount(0);
});

test('shared map filters persist, open from Attention and leave lists available',async({page},testInfo)=>{
  await feeds(page,{fires:snapshot([]),perimeters:snapshot([perimeter]),alerts:snapshot([])});
  await page.goto('/?mode=monitor');
  let panel=await details(page);
  await expect(panel.getByRole('checkbox',{name:'Events relevant to portfolio locations'})).toHaveCount(0);
  await expect(panel.getByText('Earthquakes and cyclones use 250 km point proximity.',{exact:false})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:perimeter.name,exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Open map filters',exact:true}).click();
  let filters=page.getByRole('group',{name:'Map filters',exact:true});
  await expect(filters).toBeVisible();
  await expect(page.getByText('Preview',{exact:true})).toHaveCount(0);
  const mapControls=page.getByLabel('Map controls',{exact:true});
  await expect(mapControls.locator('.exposure-layer-menu > summary')).toHaveText(['Filters','Appearance']);
  await filters.getByRole('switch',{name:'Relevant to portfolio',exact:true}).check();
  await filters.getByRole('switch',{name:'Watchlist items',exact:true}).check();
  await expect(page.getByRole('button',{name:/^Filters\s*2$/})).toBeVisible();
  await filters.getByText('How matching works',{exact:true}).click();
  await expect(filters).toContainText('within 0 km');
  await page.screenshot({path:testInfo.outputPath('monitor-map-filters.png')});
  await page.keyboard.press('Escape');
  await expect(filters).not.toBeVisible();
  panel=await details(page);
  await expect(panel).toContainText('Portfolio matches');
  await expect(panel).toContainText('Watchlist items on map');
  await expect(panel.getByRole('button',{name:perimeter.name,exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('catlas-monitor-1')!);return [prefs.nearPortfolio,prefs.watchedOnly];})).toEqual([true,true]);
  await page.reload();
  panel=await details(page);
  await panel.getByRole('button',{name:'Open map filters',exact:true}).click();
  filters=page.getByRole('group',{name:'Map filters',exact:true});
  await expect(filters.getByRole('switch',{name:'Relevant to portfolio',exact:true})).toBeChecked();
  await expect(filters.getByRole('switch',{name:'Watchlist items',exact:true})).toBeChecked();
  await page.getByText('Appearance',{exact:true}).click();
  await expect(filters).not.toBeVisible();
  await page.getByText('Appearance',{exact:true}).click();
  panel=await details(page,'Locations');
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(panel.getByRole('searchbox',{name:'Find a location'})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Ridgecrest medical centre',exact:true})).toBeVisible();
});
