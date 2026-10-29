import { type Page } from '@playwright/test';

export async function closeDialog(page: Page) {
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  if (await close.isVisible()) await close.click();
  if(await page.getByRole('button',{name:'Portfolio',exact:true}).getAttribute('aria-pressed')==='true')await page.getByRole('button',{name:'Exposure',exact:true}).click();
}
export async function openHistory(page: Page) {
  await closeDialog(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();
}
export async function openPortfolio(page: Page) {
  await closeDialog(page);
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  const options=page.getByRole('button',{name:'Portfolio options',exact:true});
  if(await options.isVisible())await options.click();
  const details=page.getByRole('button',{name:'Portfolio details',exact:true});
  if(await details.count()&&await details.getAttribute('aria-expanded')==='false')await details.click();
}
export async function openFilters(page: Page) {
  await closeDialog(page);
  const filters = page.getByRole('button', { name: 'Filter locations', exact: true });
  if (await filters.getAttribute('aria-expanded') !== 'true') await filters.click();
}
export async function openLocations(page: Page) {
  await closeDialog(page);
  for (const name of ['Close side panel','Close location details','Close evidence']) {
    const close=page.getByRole('button',{name,exact:true});
    if(await close.isVisible())await close.click();
  }
  const table = page.getByRole('button', { name: 'Locations', exact: true });
  if (await table.getAttribute('aria-expanded') !== 'true') await table.click();
}

export async function openExport(page: Page) {
  await openLocations(page);
  const menu=page.locator('.exposure-exports');
  if(await menu.getAttribute('open')===null)await menu.locator('summary').click();
}

export async function openEvidence(page: Page) {
  const button=page.getByRole('button',{name:/^Evidence [＋+−]$/,exact:true});
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
}
