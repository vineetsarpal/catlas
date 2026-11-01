import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { openExport, openFilters, openLocations } from '../helpers/exposure-workspace';

const csvHeader = 'location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n';
const mixedRows = [
  'Z,Zulu,-117.6,35.7,100,USD,West,Property',
  'A,Alpha,-117.5,35.6,200,CAD,East,Marine',
  'M,Mike,-117.4,35.5,0,USD,East,Property',
  'B,Bravo,-117.3,35.4,,CAD,East,Property',
  'C,Charlie,-79.4,43.7,,USD,West,Marine',
  'D,Delta,-117.1,35.2,0,CAD,West,Property',
];

async function assessImported(page: Page, csv: string, count: number) {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByLabel('Portfolio name', { exact: true }).fill('Exposure table checks');
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Exposure table checks', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Import CSV', exact: true }).click();
  await page.getByLabel('Preview portfolio CSV', { exact: true }).setInputFiles({ name: 'exposure.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const preview = page.getByRole('region', { name: 'CSV import preview', exact: true });
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await preview.getByRole('button', { name: 'Apply import', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Close import locations', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: 'Investigate Ridgecrest replay', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).not.toHaveText('—', { timeout: 30_000 });
  await openLocations(page);
  await expect(page.locator('.exposure-list-section').getByLabel('Visible locations', { exact: true })).toHaveText(`${count}/${count}`);
  return page.locator('.exposure-table-scroll table');
}

async function download(page: Page, name: string) {
  await openExport(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return fs.readFile((await (await pending).path())!);
}

async function assessedDemo(page: Page) {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: 'Investigate Ridgecrest replay', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11', { timeout: 30_000 });
  await openLocations(page);
  return page.locator('.exposure-table-scroll table');
}

async function names(page: Page) {
  return page.locator('.exposure-table-scroll tbody tr td:first-child button').allTextContents();
}

test('insured location sorting supports keyboard direction changes and restores investigation priority', async ({ page }, info) => {
  const table = await assessedDemo(page);
  await expect(table.locator('tbody tr')).toHaveCount(18);
  const priorityOrder = await names(page);
  const alphabetical = [...priorityOrder].sort((a, b) => a.localeCompare(b));
  expect(priorityOrder).not.toEqual(alphabetical);
  const sort = page.getByRole('button', { name: 'Sort by location', exact: true });
  await expect(sort).toBeVisible({ timeout: 1000 });
  const header = table.getByRole('columnheader').filter({ has: sort });
  await sort.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  expect(await names(page)).toEqual(alphabetical);
  await page.keyboard.press('Space');
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  expect(await names(page)).toEqual([...alphabetical].reverse());
  await sort.click();
  await expect(header).not.toHaveAttribute('aria-sort', /ascending|descending/);
  expect(await names(page)).toEqual(priorityOrder);
  await fs.mkdir('/private/tmp/catlas-exposure-table-qa', { recursive: true });
  await page.screenshot({ path: `/private/tmp/catlas-exposure-table-qa/default-${info.project.name}.png`, fullPage: true });
});

test('values stay currency grouped and unknown last; structured map filters compose and keep zero known', async ({ page }) => {
  const table = await assessImported(page, csvHeader + mixedRows.join('\n') + '\n', 6);
  const priorityOrder = await names(page);
  const value = page.getByRole('button', { name: 'Sort by insured value', exact: true });
  await value.click();
  expect(await names(page)).toEqual(['Delta', 'Alpha', 'Bravo', 'Mike', 'Zulu', 'Charlie']);
  await value.click();
  expect(await names(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Zulu', 'Mike', 'Charlie']);
  await expect(page.getByText('Currencies are grouped A–Z; insured values are ordered within each currency. Unknown values stay last.', { exact: true })).toBeVisible();
  await table.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Selected insured location', exact: true })).toContainText('Alpha');
  await openLocations(page);
  const intensity = page.getByRole('button', { name: 'Sort by mmi / band', exact: true });
  for (let direction = 0; direction < 2; direction++) {
    await intensity.click();
    expect((await names(page)).at(-1)).toBe('Charlie');
    const mmi = await table.locator('tbody tr td:nth-child(5)').allTextContents();
    const known = mmi.slice(0, -1).map(text => Number.parseFloat(text));
    expect(known).toEqual([...known].sort((a, b) => direction === 0 ? a - b : b - a));
  }
  const region = page.getByRole('button', { name: 'Sort by region', exact: true });
  await region.click();
  const east = new Set(['Alpha', 'Mike', 'Bravo']);
  expect(await names(page)).toEqual([...priorityOrder.filter(name => east.has(name)), ...priorityOrder.filter(name => !east.has(name))]);
  await region.click();
  expect(await names(page)).toEqual([...priorityOrder.filter(name => !east.has(name)), ...priorityOrder.filter(name => east.has(name))]);
  const business = page.getByRole('button', { name: 'Sort by business line', exact: true });
  await business.click();
  const marine = new Set(['Alpha', 'Charlie']);
  const businessOrder = [...priorityOrder.filter(name => marine.has(name)), ...priorityOrder.filter(name => !marine.has(name))];
  expect(await names(page)).toEqual(businessOrder);
  await openFilters(page);
  const filters = page.getByRole('region', { name: 'Map and location filters', exact: true });
  await filters.getByRole('combobox', { name: 'Insured value', exact: true }).selectOption('known');
  await expect(filters.getByRole('status')).toContainText('4 of 6 assessed locations visible');
  await openLocations(page);
  expect((await names(page)).sort()).toEqual(['Alpha', 'Delta', 'Mike', 'Zulu']);
  await openFilters(page);
  await filters.getByRole('combobox', { name: 'Insured value', exact: true }).selectOption('unknown');
  await filters.getByRole('combobox', { name: 'Show', exact: true }).selectOption('unknown');
  await expect(filters.getByRole('status')).toContainText('1 of 6 assessed locations visible');
  await openLocations(page);
  expect(await names(page)).toEqual(['Charlie']);
  await openFilters(page);
  await filters.getByRole('combobox', { name: 'Show', exact: true }).selectOption('missing-value');
  await openLocations(page);
  expect(await names(page)).toEqual(['Bravo']);
  await openFilters(page);
  await filters.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all');
  await filters.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('CAD');
  await filters.getByRole('combobox', { name: 'Region', exact: true }).selectOption({ label: 'East' });
  await filters.getByRole('combobox', { name: 'Business line', exact: true }).selectOption({ label: 'Property' });
  await expect(filters.getByRole('status')).toContainText('1 of 6 assessed locations visible');
  await openLocations(page);
  expect(await names(page)).toEqual(['Bravo']);
  await table.getByRole('button', { name: 'Bravo', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Selected insured location', exact: true })).toContainText('Bravo');
  await openLocations(page);
  await expect(table.locator('tr.exposure-selected')).toContainText('Bravo');
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('missing');
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Location details', exact: true }).click();
  const retained = page.getByRole('complementary', { name: 'Selected insured location', exact: true });
  await expect(retained.getByRole('heading', { name: 'Bravo', exact: true })).toBeVisible();
  await expect(retained).toContainText('This location is outside your current filters');
  await openLocations(page);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit visible locations', exact: true })).toBeDisabled();
  await openLocations(page);
  await page.getByRole('region', { name: 'Assessed insured locations', exact: true }).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table.getByRole('columnheader').filter({ has: business })).toHaveAttribute('aria-sort', 'ascending');
  expect(await names(page)).toEqual(businessOrder);
  await expect(table.locator('tr.exposure-selected')).toContainText('Bravo');
});

test('sorting spans all pages and view changes retain full frozen exports and saved priority', async ({ page }, info) => {
  const source = Array.from({ length: 108 }, (_, i) => {
    const n = 107 - i;
    return `S${n},Site ${String(n).padStart(3, '0')},-117.6,35.7,${n},USD,${n % 2 ? 'West' : 'East'},Property`;
  });
  const table = await assessImported(page, csvHeader + source.join('\n') + '\n', 108);
  const priorityFirstPage = await names(page);
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  const originalBundle = await download(page, 'Download self-contained case');
  const originalCSV = await download(page, 'Export all locations CSV');
  await page.getByRole('button', { name: 'Next locations', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Location pages', exact: true })).toContainText('101–108 of 108');
  const sort = page.getByRole('button', { name: 'Sort by location', exact: true });
  await sort.click();
  await expect(page.getByRole('navigation', { name: 'Location pages', exact: true })).toContainText('1–100 of 108');
  expect(await names(page)).toEqual(Array.from({ length: 100 }, (_, n) => `Site ${String(n).padStart(3, '0')}`));
  await page.getByRole('button', { name: 'Next locations', exact: true }).click();
  expect(await names(page)).toEqual(Array.from({ length: 8 }, (_, n) => `Site ${n + 100}`));
  await sort.click();
  await expect(page.getByRole('navigation', { name: 'Location pages', exact: true })).toContainText('1–100 of 108');
  expect((await names(page))[0]).toBe('Site 107');
  await table.getByRole('button', { name: 'Site 107', exact: true }).click();
  await openLocations(page);
  await page.getByRole('button', { name: 'Next locations', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('Site 10');
  await expect(page.getByRole('navigation', { name: 'Location pages', exact: true })).toContainText('1–8 of 8');
  expect(await names(page)).toEqual(Array.from({ length: 8 }, (_, n) => `Site ${107 - n}`));
  await expect(table.locator('tr.exposure-selected')).toContainText('Site 107');
  expect(await download(page, 'Export all locations CSV')).toEqual(originalCSV);
  expect(originalCSV.toString().trimEnd().split(/\r?\n/)).toHaveLength(109);
  expect(await download(page, 'Download self-contained case')).toEqual(originalBundle);
  await fs.mkdir('/private/tmp/catlas-exposure-table-qa', { recursive: true });
  await page.screenshot({ path: `/private/tmp/catlas-exposure-table-qa/filtered-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('button', { name: 'Open saved version 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await openLocations(page);
  await expect(page.locator('.exposure-list-section').getByLabel('Visible locations', { exact: true })).toHaveText('108/108');
  expect(await names(page)).toEqual(priorityFirstPage);
  await expect(table.getByRole('columnheader').filter({ has: sort })).toHaveAttribute('aria-sort', 'none');
});
