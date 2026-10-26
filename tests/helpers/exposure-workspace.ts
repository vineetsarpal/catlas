import { type Page } from '@playwright/test';

export async function closeDialog(page: Page) {
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  if (await close.isVisible()) await close.click();
  if(await page.getByRole('button',{name:'Portfolios',exact:true}).getAttribute('aria-pressed')==='true')await page.getByRole('button',{name:'Exposure',exact:true}).click();
}
export async function openHistory(page: Page) {
  await closeDialog(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();
}
export async function openPortfolio(page: Page) {
  await closeDialog(page);
  await page.getByRole('button', { name: 'Portfolios', exact: true }).click();
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
  const table = page.getByRole('button', { name: 'Toggle location table', exact: true });
  if (await table.getAttribute('aria-expanded') !== 'true') await table.click();
}
