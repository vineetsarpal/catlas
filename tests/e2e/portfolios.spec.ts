import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
async function openInventory(page:Page){const hide=page.getByRole('button',{name:/Hide locations/});if(!await hide.isVisible())await page.getByRole('button',{name:/Show locations/}).click();}

async function create(page: Page, name: string) {
  await page.getByRole('button',{name:'Create portfolio',exact:true}).click();
  const form = page.getByRole('form',{name:'Create portfolio',exact:true});
  await form.getByLabel('Portfolio name',{exact:true}).fill(name);
  await form.getByLabel('As-of date',{exact:true}).fill('2026-10-20');
  await form.getByRole('button',{name:'Save portfolio',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
}
async function add(page: Page, id: string, name: string) {
  if (!await page.getByRole('button',{name:'Add location',exact:true}).isVisible()) await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Add locations',exact:true}).click();
  await page.getByRole('button',{name:'Add location',exact:true}).click();
  const form=page.getByRole('form',{name:'Add location',exact:true});
  await form.getByLabel('Location ID',{exact:true}).fill(id);
  await form.getByLabel('Location name',{exact:true}).fill(name);
  await form.getByLabel('Latitude',{exact:true}).fill('35.62');
  await form.getByLabel('Longitude',{exact:true}).fill('-117.67');
  await form.getByLabel('Currency',{exact:true}).fill('USD');
  await form.getByRole('button',{name:'Save location',exact:true}).click();
  await expect(page.getByRole('table',{name:'Insured location inventory'}).getByText(name,{exact:true})).toBeVisible();
}
const csvHeader='location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n';
test('named portfolios, manual edits, active selection and CSV backups survive refresh',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'What do you insure?'})).toBeVisible();
  await create(page,'Canadian Commercial');
  await add(page,'LOC-1','Toronto office');
  await page.getByRole('button',{name:'Edit Toronto office',exact:true}).click();
  const edit=page.getByRole('form',{name:'Edit location'});
  await edit.getByLabel('Location name',{exact:true}).fill('Toronto HQ');
  await edit.getByLabel('Total insured value',{exact:true}).fill('2500000');
  await edit.getByRole('button',{name:'Save location'}).click();
  await expect(page.getByRole('table')).toContainText('Toronto HQ');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export portfolio CSV'}).click();
  const contents=await fs.readFile((await (await download).path())!,'utf8');
  expect(contents).toContain('Toronto HQ'); expect(contents).toContain('2500000');
  await create(page,'US Property'); await add(page,'US-1','US warehouse');
  await page.reload();await openInventory(page);
  await expect(page.getByRole('heading',{name:'US Property',exact:true})).toBeVisible();
  const id=await page.getByLabel('Active portfolio',{exact:true}).locator('option').filter({hasText:'Canadian Commercial'}).getAttribute('value');
  await page.getByLabel('Active portfolio',{exact:true}).selectOption(id!);await expect(page.getByRole('heading',{name:'Canadian Commercial',exact:true})).toBeVisible();await openInventory(page);
  await openInventory(page);await expect(page.getByRole('table')).toContainText('Toronto HQ');
  await page.getByRole('button',{name:'Monitor',exact:true}).click();
  await expect(page.getByRole('region',{name:'Monitoring summary'})).toContainText('1 portfolio locations');
  await page.getByRole('button',{name:'Portfolios',exact:true}).click();await openInventory(page);
  await page.getByLabel('Search locations',{exact:true}).fill('missing');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel('Search locations',{exact:true}).fill('');
  await page.locator('.portfolios-page').evaluate(element=>element.scrollTo(0,0));
  expect(await page.getByLabel('Active portfolio',{exact:true}).evaluate(element=>element.getBoundingClientRect().width)).toBeGreaterThan(120);
  expect(await page.getByLabel('Active portfolio',{exact:true}).evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(10);
  await page.screenshot({path:`test-results/portfolios-${test.info().project.name}.png`});
});

test('CSV merge and replace show changes, exclude invalid rows and reject duplicate IDs',async({page})=>{
  await page.goto('/'); await create(page,'Imported book'); await add(page,'OLD','Original');
  await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Import CSV',exact:true}).click();
  const upload=page.getByLabel('Preview portfolio CSV',{exact:true});
  await upload.setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:Buffer.from(csvHeader+'A,One,0,0,1,USD,R,B\nA,Two,1,1,2,USD,R,B\n')});
  await expect(page.getByRole('alert')).toContainText('duplicate location ID');
  await upload.setInputFiles({name:'merge.csv',mimeType:'text/csv',buffer:Buffer.from(csvHeader+'OLD,Updated,0,0,,USD,R,B\nNEW,New location,1,1,100,CAD,R,B\nBAD,Bad,,1,10,USD,R,B\n')});
  const preview=page.getByRole('region',{name:'CSV import preview'});
  await expect(preview).toContainText('1 added · 1 changed · 0 removed');
  await expect(preview).toContainText('2 usable rows of 3; 1 excluded');
  await expect(preview.getByRole('button',{name:'Apply import'})).toBeDisabled();
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await preview.getByRole('button',{name:'Apply import'}).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2);
  await upload.setInputFiles({name:'replace.csv',mimeType:'text/csv',buffer:Buffer.from(csvHeader+'NEW,New location,1,1,100,CAD,R,B\n')});
  await page.getByLabel('Import behavior').selectOption('replace');
  await expect(preview).toContainText('0 added · 0 changed · 1 removed');
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await preview.getByRole('button',{name:'Apply import'}).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);await page.reload();await openInventory(page);await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('table')).not.toContainText('Updated');
  page.on('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete New location',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your portfolio is empty'})).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading',{name:'Your portfolio is empty'})).toBeVisible();
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
  await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Choose a portfolio with locations');
});

test('editing or deleting inventory never rewrites saved investigations or replaces active holdings on resume',async({page})=>{
  await page.goto('/exposure.html');
  await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
  await expect(page.getByText('Investigation snapshot:',{exact:false})).toContainText('Demo · Ridgecrest locations');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('button',{name:'Save this investigation locally',exact:true}).click();
  await expect(page.getByRole('button',{name:'Saved in this browser'})).toBeDisabled();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Portfolios',exact:true}).click();
  await create(page,'Current book'); await add(page,'CURRENT','Current location');
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
  await expect(page.getByText('Portfolio has changed or a different portfolio is active.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Investigate latest portfolio',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('1');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
  await expect(page.getByLabel('Active portfolio',{exact:true}).locator('option:checked')).toContainText('Current book');
  await page.getByRole('button',{name:'Portfolios',exact:true}).click();await openInventory(page);
  await expect(page.getByRole('table')).toContainText('Current location');
  page.on('dialog',dialog=>dialog.accept()); await page.getByRole('navigation',{name:'Portfolio tools'}).getByRole('button',{name:'Edit portfolio details',exact:true}).click(); await page.getByRole('button',{name:'Delete portfolio',exact:true}).click();
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
});

test('stale edits in a second tab cannot overwrite a newer inventory',async({page,context})=>{
  await page.goto('/');await create(page,'Shared browser book');await add(page,'SITE','Original site');
  const second=await context.newPage();await second.goto('/?mode=portfolios');await openInventory(second);
  await second.getByRole('button',{name:'Edit Original site',exact:true}).click();
  await second.getByRole('form',{name:'Edit location'}).getByLabel('Location name',{exact:true}).fill('Stale change');
  await page.getByRole('button',{name:'Edit Original site',exact:true}).click();
  await page.getByRole('form',{name:'Edit location'}).getByLabel('Location name',{exact:true}).fill('Latest change');
  await page.getByRole('button',{name:'Save location',exact:true}).click();
  await expect(page.getByRole('table')).toContainText('Latest change');
  await second.getByRole('button',{name:'Save location',exact:true}).click();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');
  await expect(second.getByRole('form',{name:'Edit location'}).getByLabel('Location name',{exact:true})).toHaveValue('Stale change');
  await second.reload();await openInventory(second);await expect(second.getByRole('table')).toContainText('Latest change');
  await second.close();
});

test('portfolio storage failure is visible and cannot claim a successful save',async({page})=>{
  await page.addInitScript(()=>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name:string,version?:number){if(name==='catlas-portfolios-1')throw new Error('Test storage unavailable');return open.call(this,name,version);};});
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Portfolio storage unavailable');
  await expect(page.getByRole('button',{name:'Create portfolio',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Use demo portfolio',exact:true})).toBeDisabled();
});
