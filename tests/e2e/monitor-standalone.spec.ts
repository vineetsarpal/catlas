import { test, expect } from '@playwright/test';

test('standalone hazard controls explain backend requirement and never request configured feeds',async({page},testInfo)=>{
  test.skip(process.env.VITE_CATLAS_BACKEND==='true','Standalone build check; run with VITE_CATLAS_BACKEND=false.');
  const hazardRequests:string[]=[];
  page.on('request',request=>{if(/\/api\/monitor\/(fires|perimeters|alerts)(?:\?|$)/.test(request.url()))hazardRequests.push(request.url());});
  await page.addInitScript(()=>localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:false,cyclones:false,wind:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[],fires:true,perimeters:true,alerts:true,showFires:true,showPerimeters:true,showAlerts:true})));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  if(testInfo.project.name==='desktop')await page.setViewportSize({width:1440,height:1200});
  await page.goto('/?mode=monitor');
  await page.getByText('Layers',{exact:true}).click();
  for(const label of ['Weather warnings','Reported fires & perimeters','Fire detections']){
    const toggle=page.getByRole('switch',{name:label,exact:true});
    await expect(toggle).toBeDisabled();await expect(toggle).not.toBeChecked();
  }
  await expect(page.locator('.monitor-map-layer-controls').getByRole('heading',{level:3})).toHaveText(['PORTFOLIO','HAZARDS','WEATHER']);
  await expect(page.getByRole('region',{name:'Fires',exact:true})).toContainText('Fire feeds require the Catlas backend.');
  await expect(page.getByRole('region',{name:'Weather warnings display',exact:true})).toContainText('Weather warning feeds require the Catlas backend.');
  if(testInfo.project.name==='desktop')await page.getByRole('region',{name:'Fires',exact:true}).scrollIntoViewIfNeeded();
  if(testInfo.project.name==='desktop')await page.screenshot({path:'docs.local/verification/monitor-standalone-desktop.png',fullPage:true});
  await page.getByText('Layers',{exact:true}).click();
  if(!await page.getByRole('button',{name:'Feeds',exact:true}).isVisible())await page.getByRole('button',{name:'Monitor options',exact:true}).click();
  await page.getByRole('button',{name:'Feeds',exact:true}).click();
  const panel=page.getByRole('region',{name:'Live monitoring controls'});
  await expect(panel).toContainText('Fire and weather warning feeds require the Catlas backend.');
  await panel.getByRole('button',{name:'Refresh enabled feeds',exact:true}).click();
  expect(hazardRequests).toEqual([]);
});
