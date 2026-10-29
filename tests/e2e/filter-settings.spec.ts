import { test, expect, type Page } from '@playwright/test';
import { openExport } from '../helpers/exposure-workspace';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';

async function demo(page:Page){
  await page.goto('/?mode=portfolios');
  await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
}
async function openAnalysis(page:Page){
  const button=page.getByRole('button',{name:'Analysis settings',exact:true});
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
}
async function openEvents(page:Page){
  const button=page.getByRole('button',{name:'Events',exact:true});
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
}
async function bundle(page:Page){
  await openExport(page);
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();
  const result=JSON.parse(gunzipSync(await fs.readFile((await(await downloading).path())!)).toString());
  return result;
}

test('screening and analysis thresholds remain independent of filters and saved-version reopening',async({page},info)=>{
  await page.route('https://**/*',route=>route.abort());
  await demo(page);
  await expect(page.getByLabel('Screening threshold MMI',{exact:true})).toHaveValue('4');
  await page.getByLabel('Screening threshold MMI',{exact:true}).fill('7');
  await openAnalysis(page);
  await expect(page.getByLabel('Investigation threshold',{exact:true})).toHaveValue('4');
  await openEvents(page);
  await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11',{timeout:30000});
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();
  const original=await bundle(page);
  await page.getByRole('button',{name:'Show locations meeting threshold',exact:true}).click();
  const filterButton=page.getByRole('button',{name:'Filter locations',exact:true});
  await expect(filterButton.locator('.workspace-rail-badge')).toHaveText('1');
  await filterButton.click();
  const filters=page.getByRole('region',{name:'Map and location filters',exact:true});
  await expect(filters.getByLabel('Investigation threshold',{exact:true})).toHaveCount(0);
  await filters.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(filterButton.locator('.workspace-rail-badge')).toHaveCount(0);
  await openAnalysis(page);
  await expect(page.getByLabel('Investigation threshold',{exact:true})).toHaveValue('4');
  await openEvents(page);
  await expect(page.getByLabel('Screening threshold MMI',{exact:true})).toHaveValue('7');
  expect(await bundle(page)).toEqual(original);
  await openAnalysis(page);
  await page.getByLabel('Investigation threshold',{exact:true}).fill('6');
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
  await page.getByRole('button',{name:'Apply threshold as new version',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('7');
  await page.getByRole('button',{name:'Save investigation',exact:true}).click();
  const revised=await bundle(page);
  expect(revised.record).toMatchObject({version:2,settings:{threshold:6},portfolio:original.record.portfolio,evidence:original.record.evidence});
  await openEvents(page);
  await expect(page.getByLabel('Screening threshold MMI',{exact:true})).toHaveValue('7');
  await page.getByLabel('Screening threshold MMI',{exact:true}).fill('9');
  await page.getByRole('button',{name:'Saved',exact:true}).click();
  await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();
  await openAnalysis(page);
  await expect(page.getByLabel('Investigation threshold',{exact:true})).toHaveValue('4');
  await fs.mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:`output/playwright/analysis-settings-${info.project.name}.png`,fullPage:true});
  await openEvents(page);
  await expect(page.getByLabel('Screening threshold MMI',{exact:true})).toHaveValue('9');
  expect(await bundle(page)).toEqual(original);
});

test('Monitor has one filter entry and resets only its two view filters',async({page},info)=>{
  await page.addInitScript(()=>{
    localStorage.setItem('catlas-monitor-1',JSON.stringify({earthquakes:false,cyclones:false,wind:false,vessels:false,locations:true,fires:false,perimeters:false,alerts:false,fireDistanceKm:17,nearPortfolio:false,watchedOnly:false,watchlist:[{key:'location:RC-01',name:'Ridgecrest medical centre'}]}));
  });
  await page.goto('/?mode=monitor');
  const tools=page.getByRole('navigation',{name:'Monitor tools',exact:true});
  const button=tools.getByRole('button',{name:'Map filters',exact:true});
  await expect(button).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Open map filters',exact:true})).toHaveCount(0);
  await expect(page.locator('.monitor-filter-menu')).toHaveCount(0);
  await button.click();
  const filters=page.getByRole('group',{name:'Map filters',exact:true});
  await expect(filters).toContainText('Filters map and Attention.');
  await expect(filters).toContainText('Filters map only.');
  await expect(filters.getByRole('button',{name:'Clear filters',exact:true})).toHaveCount(0);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('catlas-monitor-1')!));
  await filters.getByRole('switch',{name:'Relevant to portfolio',exact:true}).check();
  await filters.getByRole('switch',{name:'Watchlist items',exact:true}).check();
  await expect(button.locator('.workspace-rail-badge')).toHaveText('2');
  await fs.mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:`output/playwright/monitor-filter-sidebar-${info.project.name}.png`,fullPage:true});
  await filters.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(button.locator('.workspace-rail-badge')).toHaveCount(0);
  await expect(filters.getByRole('switch',{name:'Relevant to portfolio',exact:true})).not.toBeChecked();
  await expect(filters.getByRole('switch',{name:'Watchlist items',exact:true})).not.toBeChecked();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('catlas-monitor-1')!));
  expect(after).toEqual(before);
});
