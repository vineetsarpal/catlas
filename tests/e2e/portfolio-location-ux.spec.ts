import { test, expect, type Page } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'Desktop location browsing contract');
async function demo(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use demo portfolio', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo · Ridgecrest locations', exact: true })).toBeVisible();
  const close = page.getByRole('button', { name: 'Close portfolio details', exact: true });
  if (await close.isVisible()) await close.click();
}

test('Portfolio uses common columns and inspector actions', async ({ page }) => {
  await demo(page);
  const table = page.getByRole('table', { name: 'Insured location inventory' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText([/Location/, /Insured value/, /Region/, /Business line/]);
  await table.getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Portfolio location details' });
  await expect(details.getByRole('heading', { name: 'Location details', exact: true })).toBeVisible();
  await expect(details.getByText('35.62, -117.67', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Edit location', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Delete location', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Zoom to location', exact: true })).toBeVisible();
});

test('Portfolio filters both map and list while retaining hidden selection and scoped totals', async ({ page }) => {
  await demo(page);
  const table = page.getByRole('table', { name: 'Insured location inventory' });
  await table.getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Filter region', { exact: true }).selectOption({ label: 'Clark' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('1/18');
  const details = page.getByRole('complementary', { name: 'Portfolio location details' });
  await expect(details).toContainText('Ridgecrest medical centre');
  await expect(details).toContainText('This location is outside your current filters');
  await expect(page.getByLabel('Portfolio inventory summary')).toContainText('$289,000,000');
  await expect(page.getByRole('status', { name: 'Filtered locations summary' })).toContainText('$11,000,000');
  await details.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(18);
  await expect(details.getByText('This location is outside your current filters')).toHaveCount(0);
});

test('ordinary workspace switches retain independent location browsing state', async ({ page }) => {
  await demo(page);
  await page.getByLabel('Search locations', { exact: true }).fill('Las Vegas');
  await page.getByRole('table').getByRole('button', { name: 'Las Vegas shops', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close side panel', exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByLabel('Find a location', { exact: true }).fill('Ridgecrest');
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByLabel('Search locations', { exact: true })).toHaveValue('Las Vegas');
  await expect(page.getByRole('table', { name: 'Insured location inventory' }).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Portfolio location details' })).toContainText('Las Vegas shops');
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(page.getByLabel('Find a location', { exact: true })).toHaveValue('Ridgecrest');
});
