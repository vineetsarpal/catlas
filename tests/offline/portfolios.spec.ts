import { test, expect } from '@playwright/test';
test('packaged portfolio inventory persists and is reusable without external resources',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4178'?route.continue():route.abort());
  await page.goto('/');
  await page.getByRole('button',{name:'Create portfolio',exact:true}).click();
  const form=page.getByRole('form',{name:'Create portfolio'});
  await form.getByLabel('Portfolio name',{exact:true}).fill('Offline locations');
  await form.getByRole('button',{name:'Save portfolio',exact:true}).click();
  await page.getByLabel('Preview portfolio CSV',{exact:true}).setInputFiles({name:'locations.csv',mimeType:'text/csv',buffer:Buffer.from('location_id,name,longitude,latitude,total_insured_value,currency\nOFF-1,Offline site,-117.67,35.62,,USD\n')});
  await page.getByLabel('I have reviewed the changes and excluded rows.').check();
  await page.getByRole('button',{name:'Apply import'}).click();
  await expect(page.getByRole('table')).toContainText('Offline site');
  await page.reload();await page.getByRole('button',{name:/Show locations/}).click();await expect(page.getByRole('table')).toContainText('Offline site');
  await expect(page.getByLabel('Active portfolio',{exact:true}).locator('option:checked')).toContainText('Offline locations');
  await page.getByRole('button',{name:'Exposure',exact:true}).click();
  await page.getByRole('button',{name:'Investigate Ridgecrest replay',exact:true}).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('1');
});

test('packaged map placement saves a location while offline without a geocoder',async({page,context})=>{
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4178'?route.continue():route.abort());
  await page.goto('/');await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();
  await expect(page.getByRole('region',{name:'Portfolio inventory map'}).getByTestId('exposure-map')).toHaveAttribute('data-ready','true');
  await context.setOffline(true);
  await page.getByRole('button',{name:'Drop a pin',exact:true}).click();await page.getByRole('button',{name:'Use map center',exact:true}).click();
  await page.getByRole('button',{name:'Add to portfolio',exact:true}).click();
  const form=page.getByRole('form',{name:'Add location',exact:true});await form.getByLabel('Location ID',{exact:true}).fill('OFF-PIN');await form.getByLabel('Currency',{exact:true}).fill('USD');await form.getByRole('button',{name:'Save location',exact:true}).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(19);
});
