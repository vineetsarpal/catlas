import { test, expect, type Page } from '@playwright/test';
async function setup(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Demo · Ridgecrest locations');
  await expect(page.getByRole('region',{name:'Portfolio inventory map'}).getByTestId('exposure-map')).toHaveAttribute('data-ready','true');
  await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Add locations',exact:true}).click();
}
const rows=(page:Page)=>page.locator('#portfolio-location-table tbody tr');
const response={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[-79.384,43.6536]},properties:{name:'Toronto City Hall',city:'Toronto',country:'Canada'}},{type:'Feature',geometry:{type:'Point',coordinates:[999,999]},properties:{name:'Invalid position'}}]};
test('place search is submitted explicitly, previews a pin, and saves only after insurance details are confirmed',async({page})=>{
  const requests:string[]=[];
  await page.route('https://photon.komoot.io/api/**',route=>{requests.push(route.request().url());return route.fulfill({json:response});});
  await setup(page);
  await page.getByLabel('Search places or addresses').fill('Toronto City Hall');
  expect(requests).toHaveLength(0);
  await page.getByRole('button',{name:'Search places',exact:true}).click();
  await page.locator('.portfolio-place-results button').filter({hasText:'Toronto City Hall'}).click();
  await expect(page.getByRole('heading',{name:'Preview location',exact:true})).toBeVisible();
  await expect(rows(page)).toHaveCount(18);
  await page.getByRole('button',{name:'Add to portfolio',exact:true}).click();
  const form=page.getByRole('form',{name:'Add location',exact:true});
  await expect(form.getByLabel('Location name',{exact:true})).toHaveValue('Toronto City Hall');
  await expect(form.getByLabel('Latitude',{exact:true})).toHaveValue('43.6536');
  await form.getByLabel('Location ID',{exact:true}).fill('CITY-1');
  await expect(form.getByLabel('Currency',{exact:true})).toHaveValue('USD');
  await form.getByRole('button',{name:'Save location',exact:true}).click();
  await expect(rows(page)).toHaveCount(19);
  await page.getByLabel('Search locations',{exact:true}).fill('CITY-1');
  await expect(rows(page)).toContainText('43.6536, -79.384');
  await expect(rows(page)).toContainText('Unknown USD');
  expect(requests).toHaveLength(1);
  const url=new URL(requests[0]);expect([...url.searchParams.keys()].sort()).toEqual(['lang','limit','q']);
  await page.reload();await page.getByRole('button',{name:/Show locations/}).click();await page.getByLabel('Search locations',{exact:true}).fill('CITY-1');await expect(rows(page)).toHaveCount(1);
});

test('offline pin placement and coordinate adjustment create a location without geocoding',async({page,context})=>{
  let geocoding=0;await page.route('https://photon.komoot.io/**',route=>{geocoding++;return route.abort();});
  await setup(page);await context.setOffline(true);
  await expect(page.getByLabel('Search places or addresses')).toBeDisabled();
  await page.getByRole('button',{name:'Drop a pin',exact:true}).click();
  await page.getByRole('button',{name:'Use map center',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Preview location',exact:true})).toBeVisible();
  await expect(rows(page)).toHaveCount(18);
  await page.getByRole('button',{name:'Add to portfolio',exact:true}).click();
  const form=page.getByRole('form',{name:'Add location',exact:true});
  await form.getByLabel('Location ID',{exact:true}).fill('PIN-1');await form.getByLabel('Location name',{exact:true}).fill('Pinned site');
  await form.getByLabel('Latitude',{exact:true}).fill('40.75');await form.getByLabel('Longitude',{exact:true}).fill('-73.98');
  await form.getByLabel('Currency',{exact:true}).fill('USD');await form.getByRole('button',{name:'Save location',exact:true}).click();
  await expect(rows(page)).toHaveCount(19);await page.getByLabel('Search locations',{exact:true}).fill('PIN-1');await expect(rows(page)).toContainText('40.75, -73.98');expect(geocoding).toBe(0);
});

test('map clicks and draggable preview pins do not add locations until saved',async({page},info)=>{
  await setup(page);
  await expect(page.getByRole('region',{name:'Portfolio inventory map'}).getByTestId('exposure-map')).toHaveAttribute('data-settled','true');
  await page.screenshot({path:`test-results/portfolio-map-overview-${info.project.name}.png`});
  const hide=page.getByRole('button',{name:/Hide locations/});if(await hide.isVisible())await hide.click();
  await page.getByRole('button',{name:'Drop a pin',exact:true}).click();
  const map=page.getByRole('region',{name:'Portfolio inventory map'}).getByTestId('exposure-map');
  await map.click({position:{x:75,y:200}});
  await expect(page.getByRole('heading',{name:'Preview location',exact:true})).toBeVisible();
  await expect(map).toHaveAttribute('data-settled','true');
  const pin=page.getByLabel('Unsaved location preview pin',{exact:true});
  await expect(pin).toBeVisible();
  const before=await page.getByRole('complementary',{name:'Portfolio location details'}).textContent();
  const box=await pin.boundingBox();
  if(info.project.name==='desktop'){
    await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(box!.x+box!.width/2+30,box!.y+box!.height/2+25,{steps:10});await page.mouse.up();
    await expect(page.getByRole('complementary',{name:'Portfolio location details'})).not.toHaveText(before!);
  }
  await page.getByRole('button',{name:'Discard preview',exact:true}).click();
  await expect(pin).toHaveCount(0);
  await page.getByRole('button',{name:/Show locations/}).click();await expect(rows(page)).toHaveCount(18);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await page.screenshot({path:`test-results/portfolio-map-${info.project.name}.png`});
});

test('empty search and service failures leave the inventory usable',async({page})=>{
  await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({status:503,body:'Unavailable'}));
  await setup(page);await page.getByLabel('Search places or addresses').fill('Unknown place');await page.getByRole('button',{name:'Search places',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Place search unavailable');await expect(rows(page)).toHaveCount(18);
  await page.getByRole('button',{name:'Drop a pin',exact:true}).click();await expect(page.getByRole('button',{name:'Use map center',exact:true})).toBeVisible();
});

test('clearing a query cancels stale results without applying a location',async({page})=>{
  await page.route('https://photon.komoot.io/api/**',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({json:response}).catch(()=>{});});
  await setup(page);await page.getByLabel('Search places or addresses').fill('Toronto City Hall');await page.getByRole('button',{name:'Search places',exact:true}).click();await page.getByLabel('Search places or addresses').fill('');
  await expect(page.locator('.portfolio-place-results')).toHaveCount(0);await expect(rows(page)).toHaveCount(18);await expect(page.getByRole('button',{name:'Search places',exact:true})).toBeDisabled();
});


test('a search with no matches provides alternatives without changing the portfolio',async({page})=>{
  await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({json:{type:'FeatureCollection',features:[]}}));
  await setup(page);await page.getByLabel('Search places or addresses').fill('Nonexistent location');await page.getByRole('button',{name:'Search places',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'No places found'})).toBeVisible();await expect(rows(page)).toHaveCount(18);
});
