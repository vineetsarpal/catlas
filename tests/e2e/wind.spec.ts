import { test, expect } from '@playwright/test';
const configured=process.env.VITE_CATLAS_BACKEND==='true';
const runAt='2026-10-19T18:00:00.000Z';
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:false,cyclones:false,wind:true,windShading:false,windPaused:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[]})));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
});
test('standalone wind is disabled even with a retained enabled preference',async({page})=>{
  test.skip(configured,'Standalone build check');
  const requests:string[]=[];page.on('request',request=>{if(/wind|noaa-gfs/.test(request.url()))requests.push(request.url());});
  await page.goto('/?mode=monitor');
  await page.getByText('Layers',{exact:true}).click();
  const wind=page.getByRole('switch',{name:'Wind',exact:true});
  await expect(wind).toBeDisabled();await expect(wind).not.toBeChecked();
  await expect(page.getByRole('region',{name:'Wind display'})).toContainText('Wind requires the Catlas backend.');
  await expect(page.locator('.monitor-wind-flow')).toHaveCount(0);
  if(!await page.getByRole('button',{name:'Feeds',exact:true}).isVisible())await page.getByRole('button',{name:'Monitor options',exact:true}).click();
  await page.getByRole('button',{name:'Feeds',exact:true}).click();
  await expect(page.getByRole('region',{name:'Live monitoring controls'})).toContainText('Wind requires the Catlas backend.');
  expect(requests.filter(url=>/\/api\/monitor\/wind|wind-decoder|wind\.worker|noaa-gfs/.test(url))).toEqual([]);
});
test('backend metadata failure can retry, then grid failure is explicit',async({page})=>{
  test.skip(!configured,'Backend-enabled build check');
  let attempts=0,gridAttempts=0,failMetadata=true,failGrid=true;
  await page.route('**/api/monitor/wind',route=>{
    attempts++;
    return route.fulfill(failMetadata?{status:503,body:'Unavailable'}:{json:{runAt,defaultTime:runAt,times:[runAt]}});
  });
  await page.route('**/api/monitor/wind/grid?*',route=>{
    gridAttempts++;if(failGrid)return route.fulfill({status:503,body:'Unavailable'});
    const count=360*181,bytes=Buffer.alloc(count*8);
    for(let i=0;i<count;i++){bytes.writeFloatLE(5,i*4);bytes.writeFloatLE(2,(count+i)*4);}
    return route.fulfill({body:bytes,contentType:'application/octet-stream',headers:{'X-Wind-Metadata':JSON.stringify({nx:360,ny:181,lo1:0,la1:90,dx:1,dy:1,runAt,validAt:runAt,sourceURL:'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261019/18/atmos/gfs.t18z.pgrb2.1p00.f000',decodeMs:1})}});
  });
  await page.goto('/?mode=monitor');
  await page.getByText('Layers',{exact:true}).click();
  await expect(page.getByRole('switch',{name:'Wind',exact:true})).toBeEnabled();
  await expect(page.getByRole('region',{name:'Wind display'})).toContainText('Wind unavailable: Local backend unavailable (503)');
  failMetadata=false;
  await page.getByRole('button',{name:'Retry wind forecasts',exact:true}).click();
  await expect(page.getByLabel('Wind forecast valid time',{exact:true})).toBeVisible();
  await expect(page.locator('.monitor-map-status')).toContainText('Wind flow unavailable: Local wind backend unavailable (503)');
  await expect(page.locator('.monitor-wind-flow')).toHaveCount(0);
  failGrid=false;
  await page.getByRole('button',{name:'Retry wind forecasts',exact:true}).click();
  await expect(page.locator('.monitor-wind-flow')).toBeVisible();
  await expect(page.locator('.monitor-wind-flow')).toHaveAttribute('data-valid-at',runAt);
  await expect(page.locator('.monitor-map-status')).toContainText('NOAA GFS · forecast valid');
  await page.getByRole('switch',{name:'Wind',exact:true}).uncheck();
  await expect(page.locator('.monitor-wind-flow')).toHaveCount(0);
  expect(attempts).toBeGreaterThanOrEqual(3);expect(gridAttempts).toBeGreaterThanOrEqual(2);
});
