import { expect, test } from '@playwright/test';
import { openLocations } from '../helpers/exposure-workspace';

test('Exposure locations are browsable before assessment and then retain assessed details', async ({ page }) => {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await openLocations(page);
  const table = page.locator('.exposure-table-scroll table');
  await expect(table.locator('tbody tr')).toHaveCount(18);
  await expect(page.getByLabel('Active map filters', { exact: true })).toHaveCount(0);
  const location = table.getByRole('button', { name: 'Ridgecrest medical centre', exact: true });
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('Ridgecrest medical centre');
  await expect(page.getByLabel('Active map filters', { exact: true })).toBeVisible();
  const map = page.getByRole('region', { name: 'Shaking and portfolio map', exact: true }).getByTestId('exposure-map');
  const desktop = test.info().project.name === 'desktop';
  if (desktop) {
    await expect(map).toHaveAttribute('data-ready', 'true');
    await expect(map).toHaveAttribute('data-settled', 'true');
  }
  const longitude = desktop ? await map.getAttribute('data-camera-longitude') : null;
  await location.click();
  if (desktop) await expect(map).toHaveAttribute('data-camera-longitude', longitude!);
  const inspector = page.getByRole('complementary', { name: 'Selected insured location', exact: true });
  await expect(inspector.getByRole('heading', { name: 'Ridgecrest medical centre', exact: true })).toBeVisible();
  await expect(inspector.getByRole('region', { name: 'Location details', exact: true })).toContainText('RC-01');
  await expect(inspector.getByRole('region', { name: 'Exposure assessment', exact: true })).toContainText('Not assessed');
  await expect(inspector.getByRole('button', { name: 'Zoom to location', exact: true })).toBeVisible();
  await openLocations(page);
  await page.getByRole('button', { name: 'Clear location search', exact: true }).click();
  await expect(page.getByLabel('Active map filters', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByRole('button', { name: 'Investigate Ridgecrest replay', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11', { timeout: 30_000 });
  await openLocations(page);
  await table.getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  await expect(inspector.getByRole('region', { name: 'Exposure assessment', exact: true })).toContainText('MMI');
  await expect(inspector.getByRole('region', { name: 'Exposure assessment', exact: true })).not.toContainText('Not assessed');
});

test('Exposure table puts common location columns before assessment columns', async ({ page }) => {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await openLocations(page);
  const headers = page.locator('.exposure-table-scroll th');
  await expect(headers).toHaveText([/^Location/, /^Insured value/, /^Region/, /^Business line/, /^MMI \/ band/, 'Investigation']);
});

test('Exposure with no active locations explains the empty inventory', async ({ page }) => {
  await page.goto('/exposure.html?mode=exposure');
  await openLocations(page);
  await expect(page.getByRole('heading', { name: 'No insured locations yet', exact: true })).toBeVisible();
  await expect(page.locator('.exposure-table-scroll tbody tr')).toHaveCount(0);
});

test('an unassessed map marker opens the corresponding location details', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop map and table are visible together; mobile navigation is covered separately.');
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await openLocations(page);
  const search = page.getByRole('searchbox', { name: 'Find a location', exact: true });
  const table = page.locator('.exposure-table-scroll');
  const inspector = page.getByRole('complementary', { name: 'Selected insured location', exact: true });
  await search.fill('Phoenix warehouse');
  await table.getByRole('button', { name: 'Phoenix warehouse', exact: true }).click();
  await inspector.getByRole('button', { name: 'Zoom to location', exact: true }).click();
  const map = page.getByRole('region', { name: 'Shaking and portfolio map', exact: true }).getByTestId('exposure-map');
  await expect(map).toHaveAttribute('data-settled', 'true');
  await expect.poll(async () => Number(await map.getAttribute('data-camera-longitude'))).toBeCloseTo(-112.07, 3);
  await page.getByRole('button', { name: 'Close location details', exact: true }).click();
  await expect(inspector).toHaveCount(0);
  await expect(map).toHaveAttribute('data-settled', 'true');
  const canvas = map.locator('canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
  await expect(inspector.getByRole('heading', { name: 'Phoenix warehouse', exact: true })).toBeVisible();
  await expect(inspector.getByRole('region', { name: 'Exposure assessment', exact: true })).toContainText('Not assessed');
});
