import { expect, test } from '@playwright/test';

test('Portfolio sorts every matching location before pagination and keeps map and totals across pages', async ({ page }, info) => {
  test.setTimeout(60_000);
  test.skip(info.project.name !== 'desktop', 'Desktop pagination journey; mobile navigation has separate coverage.');
  const header = 'location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\n';
  const records = Array.from({ length: 105 }, (_, index) => {
    const number = 104 - index;
    return `L-${number},Site ${String(number).padStart(3, '0')},-117.6,35.7,${number === 104 ? '' : 10},USD,West,Property`;
  });
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByLabel('Portfolio name', { exact: true }).fill('Paginated inventory');
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paginated inventory', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Import CSV', exact: true }).click();
  await page.getByLabel('Preview portfolio CSV', { exact: true }).setInputFiles({ name: 'locations.csv', mimeType: 'text/csv', buffer: Buffer.from(header + records.join('\n') + '\n') });
  const preview = page.getByRole('region', { name: 'CSV import preview', exact: true });
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await preview.getByRole('button', { name: 'Apply import', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Close import locations', exact: true }).click();
  const table = page.getByRole('table', { name: 'Insured location inventory', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(100);
  const summary = page.getByRole('status', { name: 'Filtered locations summary', exact: true });
  await expect(summary).toContainText('105 of 105 locations');
  await expect(summary).toContainText('$1,040 USD');
  await expect(summary).toContainText('Unknown insured value: 1 locations');
  const pages = page.getByRole('navigation', { name: 'Location pages', exact: true });
  await pages.getByRole('button', { name: 'Next locations', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(summary).toContainText('105 of 105 locations');
  // Sorting from page two must sort the full data set and return to its first page.
  await table.getByRole('button', { name: 'Sort by location', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(100);
  await expect(table.locator('tbody tr td:first-child button').first()).toHaveText('Site 000');
  await pages.getByRole('button', { name: 'Next locations', exact: true }).click();
  await expect(table.locator('tbody tr td:first-child button').first()).toHaveText('Site 100');
  await page.getByLabel('Search locations', { exact: true }).fill('Site 10');
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(summary).toContainText('5 of 105 locations');
  await expect(summary).toContainText('$40 USD');
  await expect(summary).toContainText('Unknown insured value: 1 locations');
  await expect(pages.getByRole('button', { name: 'Previous locations', exact: true })).toBeDisabled();
  await expect(page.locator('.portfolios-page').getByLabel('Visible locations', { exact: true })).toHaveText('5/105');

  // Exposure before assessment uses the same inventory; a live deletion must
  // return an out-of-range page to the last available page without emptying it.
  await page.getByLabel('Search locations', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  const exposure = page.locator('.exposure-table-scroll table');
  await expect(exposure.locator('tbody tr')).toHaveCount(100);
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('Site 104');
  await exposure.getByRole('button', { name: 'Site 104', exact: true }).click();
  await page.getByRole('complementary', { name: 'Selected insured location', exact: true }).getByRole('button', { name: 'Open in Portfolio', exact: true }).click();
  // The destination belongs to page two of Portfolio's retained alphabetical sort.
  await expect(table.getByRole('button', { name: 'Site 104', exact: true })).toBeInViewport();
  await expect(table.getByRole('button', { name: 'Site 104', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('');
  const exposurePages = page.getByRole('navigation', { name: 'Location pages', exact: true });
  await exposurePages.getByRole('button', { name: 'Next locations', exact: true }).click();
  await expect(exposure.locator('tbody tr')).toHaveCount(5);
  const second = await page.context().newPage();
  await second.goto('/?mode=portfolios');
  await expect(second.getByRole('heading', { name: 'Paginated inventory', exact: true })).toBeVisible();
  await second.getByLabel('Search locations', { exact: true }).fill('Site 10');
  const otherTable = second.getByRole('table', { name: 'Insured location inventory', exact: true });
  second.on('dialog', dialog => dialog.accept());
  for (let number = 100; number <= 104; number++) {
    await otherTable.getByRole('button', { name: `Site ${number}`, exact: true }).click();
    await second.getByRole('complementary', { name: 'Portfolio location details', exact: true }).getByRole('button', { name: 'Delete location', exact: true }).click();
    await expect(otherTable.locator('tbody tr')).toHaveCount(104 - number);
  }
  await expect(exposure.locator('tbody tr')).toHaveCount(100);
  await expect(exposurePages).toContainText('1–100 of 100 locations');
  await expect(exposurePages.getByRole('button', { name: 'Previous locations', exact: true })).toBeDisabled();
  await expect(exposurePages.getByRole('button', { name: 'Next locations', exact: true })).toBeDisabled();
  await second.close();
});
