import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

const csv = 'location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n' +
  'Z,Zulu,-117.6,35.7,100,USD,West,Property\n' +
  'A,Alpha,-117.5,35.6,200,CAD,East,Marine\n' +
  'M,Mike,-117.4,35.5,0,USD,East,Property\n' +
  'B,Bravo,-117.3,35.4,,CAD,East,Property\n' +
  'C,Charlie,-117.2,35.3,,USD,West,Marine\n' +
  'D,Delta,-117.1,35.2,0,CAD,West,Property\n';
const sourceOrder = ['Zulu', 'Alpha', 'Mike', 'Bravo', 'Charlie', 'Delta'];

async function inventory(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByLabel('Portfolio name', { exact: true }).fill('Sortable inventory');
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sortable inventory', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Import CSV', exact: true }).click();
  await page.getByLabel('Preview portfolio CSV', { exact: true }).setInputFiles({ name: 'inventory.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const preview = page.getByRole('region', { name: 'CSV import preview', exact: true });
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await preview.getByRole('button', { name: 'Apply import', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Close import locations', exact: true }).click();
  const show = page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Locations', exact: true });
  if (await show.isVisible() && await show.getAttribute('aria-expanded') === 'false') await show.click();
  const table = page.getByRole('table', { name: 'Insured location inventory', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(6);
  return table;
}

async function names(page: Page) {
  return page.getByRole('table', { name: 'Insured location inventory', exact: true }).locator('tbody tr td:first-child button').allTextContents();
}

async function openFilters(page: Page) {
  await page.getByRole('navigation', { name: 'Portfolio tools', exact: true }).getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByLabel('Filter currency', { exact: true })).toBeVisible();
}

async function closeFilters(page: Page) {
  await page.getByRole('button', { name: 'Close location filters', exact: true }).click();
}

test('location sorting is keyboard accessible, exposes direction and restores source order', async ({ page }) => {
  const table = await inventory(page);
  expect(await names(page)).toEqual(sourceOrder);
  const sort = page.getByRole('button', { name: 'Sort by location', exact: true });
  await expect(sort).toBeVisible({ timeout: 1000 });
  await sort.focus();
  await page.keyboard.press('Enter');
  await expect(table.getByRole('columnheader').filter({ has: sort })).toHaveAttribute('aria-sort', 'ascending');
  expect(await names(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Mike', 'Zulu']);
  await page.keyboard.press('Space');
  await expect(table.getByRole('columnheader').filter({ has: sort })).toHaveAttribute('aria-sort', 'descending');
  expect(await names(page)).toEqual(['Zulu', 'Mike', 'Delta', 'Charlie', 'Bravo', 'Alpha']);
  await sort.click();
  expect(await names(page)).toEqual(sourceOrder);
});

test('insured values sort numerically within currencies with unknown amounts last in both directions', async ({ page }) => {
  const table = await inventory(page);
  const sort = page.getByRole('button', { name: 'Sort by insured value', exact: true });
  await expect(sort).toBeVisible({ timeout: 1000 });
  await sort.click();
  await expect(table.getByRole('columnheader').filter({ has: sort })).toHaveAttribute('aria-sort', 'ascending');
  expect(await names(page)).toEqual(['Delta', 'Alpha', 'Bravo', 'Mike', 'Zulu', 'Charlie']);
  await sort.click();
  await expect(table.getByRole('columnheader').filter({ has: sort })).toHaveAttribute('aria-sort', 'descending');
  expect(await names(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Zulu', 'Mike', 'Charlie']);
  await sort.click();
  expect(await names(page)).toEqual(sourceOrder);
});

test('structured filters compose with search and map counts while CSV export retains the whole inventory', async ({ page }) => {
  const table = await inventory(page);
  await expect(page.locator('.portfolio-filter-status')).toBeHidden();
  await openFilters(page);
  await page.getByLabel('Filter currency', { exact: true }).selectOption({ label: 'CAD' });
  await page.getByLabel('Filter region', { exact: true }).selectOption({ label: 'East' });
  await page.getByLabel('Filter business line', { exact: true }).selectOption({ label: 'Property' });
  await page.getByLabel('Filter insured value', { exact: true }).selectOption({ label: 'Unknown values' });
  await closeFilters(page);
  expect(await names(page)).toEqual(['Bravo']);
  await expect(table).toContainText('Unknown');
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('1/6');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export portfolio CSV', exact: true }).click();
  const bytes = await fs.readFile((await (await downloading).path())!, 'utf8');
  expect(bytes.trimEnd().split(/\r?\n/)).toHaveLength(7);
  for (const name of sourceOrder) expect(bytes).toContain(name);
  await page.getByLabel('Search locations', { exact: true }).fill('missing');
  expect(await names(page)).toEqual([]);
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('0/6');
  await page.getByRole('button', { name: 'Clear location search', exact: true }).click();
  await expect(page.getByLabel('Search locations', { exact: true })).toHaveValue('');
  expect(await names(page)).toEqual(['Bravo']);
  await expect(page.getByLabel('Filter currency', { exact: true })).toHaveValue(JSON.stringify('CAD'));
  await page.getByLabel('Active location filters', { exact: true }).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('Search locations', { exact: true })).toHaveValue('');
  expect(await names(page)).toEqual(sourceOrder);
  await expect(page.getByLabel('Active location filters', { exact: true })).toHaveCount(0);
  await expect(page.locator('.portfolio-filter-status')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clear location search', exact: true })).toHaveCount(0);
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('6/6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('region and business-line sorting replace value grouping and retain stable source-order ties', async ({ page }) => {
  await inventory(page);
  await page.getByRole('button', { name: 'Sort by insured value', exact: true }).click();
  const region = page.getByRole('button', { name: 'Sort by region', exact: true });
  await region.click();
  expect(await names(page)).toEqual(['Alpha', 'Mike', 'Bravo', 'Zulu', 'Charlie', 'Delta']);
  await region.click();
  expect(await names(page)).toEqual(['Zulu', 'Charlie', 'Delta', 'Alpha', 'Mike', 'Bravo']);
  await region.click();
  expect(await names(page)).toEqual(sourceOrder);
  const business = page.getByRole('button', { name: 'Sort by business line', exact: true });
  await business.click();
  expect(await names(page)).toEqual(['Alpha', 'Charlie', 'Zulu', 'Mike', 'Bravo', 'Delta']);
  await business.click();
  expect(await names(page)).toEqual(['Zulu', 'Mike', 'Bravo', 'Delta', 'Alpha', 'Charlie']);
  await business.click();
  expect(await names(page)).toEqual(sourceOrder);
});

test('known-value filtering includes zero and filtered rows remain selectable and editable', async ({ page }) => {
  const table = await inventory(page);
  await openFilters(page);
  const valueFilter = page.getByLabel('Filter insured value', { exact: true });
  await valueFilter.selectOption({ label: 'Known values' });
  expect(await names(page)).toEqual(['Zulu', 'Alpha', 'Mike', 'Delta']);
  await valueFilter.selectOption({ label: 'Unknown values' });
  await closeFilters(page);
  expect(await names(page)).toEqual(['Bravo', 'Charlie']);
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('2/6');
  if (test.info().project.name === 'desktop') {
    const divider = page.getByRole('separator', { name: 'Resize map and locations table', exact: true });
    await divider.focus();
    await page.keyboard.press('End');
  }
  await page.screenshot({ path: `/private/tmp/catlas-table-qa/filters-${test.info().project.name}.png` });
  await table.getByRole('button', { name: 'Bravo', exact: true }).click();
  await expect(table.getByRole('button', { name: 'Bravo', exact: true })).toHaveAttribute('aria-current', 'true');
  const inspector = page.getByRole('complementary', { name: 'Portfolio location details', exact: true });
  await expect(inspector).toContainText('Bravo');
  await inspector.getByRole('button', { name: 'Edit location', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit location', exact: true });
  await form.getByLabel('Location name', { exact: true }).fill('Bravo updated');
  await form.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(table.getByRole('button', { name: 'Bravo updated', exact: true })).toBeVisible();
  expect(await names(page)).toEqual(['Bravo updated', 'Charlie']);
  await expect(table.getByRole('button', { name: 'Bravo updated', exact: true })).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a selected currency filter survives deletion of its last match and recovers when another tab adds a match', async ({ page, context }) => {
  const table = await inventory(page);
  await openFilters(page);
  const currency = page.getByLabel('Filter currency', { exact: true });
  await currency.selectOption({ label: 'CAD' });
  expect(await names(page)).toEqual(['Alpha', 'Bravo', 'Delta']);
  const second = await context.newPage();
  await second.goto('/?mode=portfolios');
  await expect(second.getByRole('heading', { name: 'Sortable inventory', exact: true })).toBeVisible();
  const show = second.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Locations', exact: true });
  if (await show.isVisible() && await show.getAttribute('aria-expanded') === 'false') await show.click();
  const mobileLocations = second.getByRole('button', { name: 'Locations', exact: true });
  if (test.info().project.name === 'mobile') await mobileLocations.click();
  const otherTable = second.getByRole('table', { name: 'Insured location inventory', exact: true });
  second.on('dialog', dialog => dialog.accept());
  for (const [name, remaining] of [['Alpha', 5], ['Bravo', 4], ['Delta', 3]] as const) {
    await otherTable.getByRole('button', { name, exact: true }).click();
    await second.getByRole('complementary', { name: 'Portfolio location details', exact: true }).getByRole('button', { name: 'Delete location', exact: true }).click();
    await expect(otherTable.locator('tbody tr')).toHaveCount(remaining);
  }
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('0/3');
  await expect(currency.locator('option:checked')).toHaveText('CAD (no current locations)');
  await second.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Import CSV', exact: true }).click();
  await second.getByLabel('Preview portfolio CSV', { exact: true }).setInputFiles({ name: 'new-cad.csv', mimeType: 'text/csv', buffer: Buffer.from('location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\nR,Returned CAD,-117,35,50,CAD,East,Marine\n') });
  const preview = second.getByRole('region', { name: 'CSV import preview', exact: true });
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await preview.getByRole('button', { name: 'Apply import', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  expect(await names(page)).toEqual(['Returned CAD']);
  await expect(currency.locator('option:checked')).toHaveText('CAD');
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('1/4');
  await closeFilters(page);
  await page.getByLabel('Active location filters', { exact: true }).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await second.close();
});
