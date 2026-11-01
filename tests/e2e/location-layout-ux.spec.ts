import { expect, test } from '@playwright/test';

test('desktop location tables share expand, restore, resize and independent remembered visibility', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop split layout');
  await page.route('https://**/*', route => route.abort());
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  const portfolioTable = page.locator('#portfolio-location-table');
  await expect(portfolioTable).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize map and locations table', exact: true });
  const before = Number(await divider.getAttribute('aria-valuenow'));
  await divider.press('ArrowUp');
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  const resized = Number(await divider.getAttribute('aria-valuenow'));
  await page.getByRole('button', { name: 'Expand locations', exact: true }).click();
  await expect(page.locator('.portfolio-map-surface')).toBeHidden();
  await page.getByRole('button', { name: 'Restore map', exact: true }).click();
  await expect(page.locator('.portfolio-map-surface')).toBeVisible();
  await expect(divider).toHaveAttribute('aria-valuenow', String(resized));
  await page.getByRole('button', { name: 'Hide locations', exact: true }).click();
  await expect(portfolioTable).toBeHidden();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(page.locator('#atlas-location-table')).toBeVisible();
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(portfolioTable).toBeHidden();
  await page.reload();
  await expect(portfolioTable).toBeHidden();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(page.locator('#atlas-location-table')).toBeVisible();
});

test('mobile location panels return to the selected Map or Locations view', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile view navigation');
  await page.route('https://**/*', route => route.abort());
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  for (const workspace of ['Portfolio', 'Exposure']) {
    await page.getByRole('button', { name: workspace, exact: true }).click();
    const views = page.getByRole('group', { name: 'Location view', exact: true });
    await views.getByRole('button', { name: 'Locations', exact: true }).click();
    const table = page.locator(workspace === 'Portfolio' ? '#portfolio-location-table' : '#atlas-location-table');
    await expect(table).toBeVisible();
    await page.getByRole('searchbox', { name: workspace === 'Portfolio' ? 'Search locations' : 'Find a location', exact: true }).fill('Ridgecrest distribution');
    await expect(table.getByRole('button', { name: 'Ridgecrest distribution', exact: true })).toBeInViewport();
    await table.getByRole('button', { name: 'Ridgecrest distribution', exact: true }).click();
    const details = page.getByRole('complementary', { name: workspace === 'Portfolio' ? 'Portfolio location details' : 'Location details', exact: true });
    await expect(details).toContainText('Ridgecrest distribution');
    const panel = await details.boundingBox();
    const area = await page.locator(workspace === 'Portfolio' ? '.portfolio-work-area' : '.atlas-work-area.has-event-catalog').boundingBox();
    expect(panel!.height).toBeCloseTo(area!.height, 0);
    await details.getByRole('button', { name: 'Back to Locations', exact: true }).click();
    await expect(table).toBeVisible();
    await expect(table.getByRole('button', { name: 'Ridgecrest distribution', exact: true })).toBeVisible();
    await page.getByRole('button', { name: workspace === 'Portfolio' ? 'Filters' : 'Filter locations', exact: true }).click();
    const filters = page.getByRole('complementary', { name: workspace === 'Portfolio' ? 'Portfolio options' : 'Filter locations', exact: true });
    await expect(filters).toBeVisible();
    expect((await filters.boundingBox())!.height).toBeCloseTo(area!.height, 0);
    await filters.getByRole('button', { name: 'Back to Locations', exact: true }).click();
    await expect(table).toBeVisible();
    await expect(page.getByRole('searchbox', { name: workspace === 'Portfolio' ? 'Search locations' : 'Find a location', exact: true })).toHaveValue('Ridgecrest distribution');
    await views.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(table).toBeHidden();
  }
});

test('mobile assessed Locations keeps rows in view and Map retains usable geographic space', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile assessed layout');
  await page.route('https://**/*', route => route.abort());
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: 'Investigate Ridgecrest replay', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11', { timeout: 30_000 });
  const views = page.getByRole('group', { name: 'Location view', exact: true });
  await views.getByRole('button', { name: 'Locations', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('Ridgecrest distribution');
  await expect(page.locator('#atlas-location-table').getByRole('button', { name: 'Ridgecrest distribution', exact: true })).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Portfolio exposure summary', exact: true })).toBeHidden();
  await views.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Portfolio exposure summary', exact: true })).toBeVisible();
  const map = page.locator('[data-testid="exposure-map"]:visible');
  await expect.poll(async () => (await map.boundingBox())?.height ?? 0).toBeGreaterThan(200);
});
