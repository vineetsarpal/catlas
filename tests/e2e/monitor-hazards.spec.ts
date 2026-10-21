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
  await page.getByText('Layers',{exact:true}).click();
}
async function closeLayers(page:Page){await page.getByText('Layers',{exact:true}).click();}
async function feeds(page:Page,state:{fires:HazardSnapshot<FireDetection>;perimeters:HazardSnapshot<FirePerimeter>;alerts:HazardSnapshot<WeatherAlert>;fireError?:boolean}){
  await page.route('**/api/monitor/fires',route=>route.fulfill(state.fireError?{status:503,json:{error:'Configure FIRMS_MAP_KEY to enable fire detections.'}}:{json:state.fires}));
  await page.route('**/api/monitor/perimeters',route=>route.fulfill({json:state.perimeters}));
  await page.route('**/api/monitor/alerts',route=>route.fulfill({json:state.alerts}));
}
test.beforeEach(async({page})=>{
  test.skip(process.env.VITE_CATLAS_BACKEND!=='true','Run this suite with VITE_CATLAS_BACKEND=true.');
  await page.clock.install({time:new Date(at)});
  await page.addInitScript(()=>localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:false,cyclones:false,wind:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[],fireDistanceKm:0})));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/?mode=portfolios');
  await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();
  await expect(page.getByLabel('Portfolio inventory summary')).toContainText('18');
});

test('published perimeter screens insured values and map visibility is independent from monitoring',async({page})=>{
  await feeds(page,{fires:snapshot([]),perimeters:snapshot([perimeter]),alerts:snapshot([])});
  await page.goto('/?mode=monitor');
  let panel=await details(page);let row=panel.locator('article').filter({has:page.getByRole('button',{name:perimeter.name,exact:true})});
  await expect(row).toContainText('Inside published fire perimeter');
  await expect(row).toContainText('4 portfolio locations flagged for attention');
  await expect(row).toContainText('TIV: USD 62,000,000');
  await expect(row).toContainText('1 flagged locations have unknown insured value.');
  await layers(page);await page.getByLabel('Show fire perimeters on map',{exact:true}).uncheck();await closeLayers(page);
  panel=await details(page);await expect(panel.getByRole('button',{name:perimeter.name,exact:true})).toBeVisible();
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
  await expect(panel).toContainText('NIFC: retained source data is stale.');
  await expect(panel).toContainText('NIFC: One perimeter page unavailable; coverage is partial.');
  await expect(panel).toContainText('NIFC: 2 unsupported records omitted.');
});

test('nearby detections contribute with dots hidden and expire even when refresh fails',async({page})=>{
  const detection:FireDetection={id:'satellite-a',longitude:-117.67,latitude:35.62,detectedAt:at,source:'VIIRS',confidence:90};
  const state={fires:snapshot([detection,{...detection,id:'satellite-b'}]),perimeters:snapshot<FirePerimeter>([]),alerts:snapshot<WeatherAlert>([]),fireError:false};
  await feeds(page,state);await page.goto('/?mode=monitor');let panel=await details(page);
  const group='Nearby fire detections — Ridgecrest medical centre';
  await expect(panel.getByRole('button',{name:group,exact:true})).toBeVisible();
  await expect(panel.locator('article').filter({has:page.getByRole('button',{name:group,exact:true})})).toContainText('Near detected fire activity');
  await layers(page);await expect(page.getByLabel('Show fire detections on map',{exact:true})).not.toBeChecked();await closeLayers(page);
  panel=await details(page);await expect(panel.getByRole('button',{name:group,exact:true})).toBeVisible();
  state.fireError=true;await page.clock.fastForward(25*3600000);
  await expect(panel.getByRole('button',{name:group,exact:true})).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('Some feeds are unavailable.');
});
