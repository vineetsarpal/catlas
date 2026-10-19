import { type Page } from '@playwright/test';

export async function closeDialog(page: Page) {
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  if (await close.isVisible()) await close.click();
}
export async function openHistory(page: Page) {
  await closeDialog(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();
}
export async function openPortfolio(page: Page) {
  await closeDialog(page);
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
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
