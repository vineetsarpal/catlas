import { expect, test, type Page } from '@playwright/test';
import { openLocations } from '../helpers/exposure-workspace';

async function assessedMedicalCentre(page: Page) {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await expect(page.getByLabel('Active portfolio', { exact: true })).not.toHaveValue('');
  const sourceId = await page.getByLabel('Active portfolio', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: 'Investigate Ridgecrest replay', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  await openLocations(page);
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('Ridgecrest medical centre');
  await page.locator('.exposure-table-scroll').getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  return { sourceId, inspector: page.getByRole('complementary', { name: 'Selected insured location', exact: true }) };
}

test('explicit Portfolio navigation reveals a hidden location and returning preserves the assessment', async ({ page }) => {
  const { inspector } = await assessedMedicalCentre(page);
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  if (!await page.getByRole('searchbox', { name: 'Search locations', exact: true }).isVisible()) await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search locations', exact: true }).fill('Phoenix');
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'Ridgecrest medical centre', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Open in Portfolio', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search locations', exact: true })).toHaveValue('');
  const details = page.getByRole('complementary', { name: 'Portfolio location details', exact: true });
  await expect(details.getByRole('heading', { name: 'Ridgecrest medical centre', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /filters/i })).toBeVisible();
  await details.getByRole('button', { name: 'Edit location', exact: true }).click();
  const edit = page.getByRole('form', { name: 'Edit location', exact: true });
  await edit.getByLabel('Location name', { exact: true }).fill('Updated medical centre');
  await edit.getByRole('button', { name: 'Save location', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'Ridgecrest medical centre', exact: true })).toBeVisible();
  await expect(page.locator('.portfolio-snapshot-notice')).toContainText('Portfolio has changed since this assessment');
  await expect(page.locator('.atlas-case-version')).toContainText('Exposure v1');
  await page.getByRole('button', { name: 'Investigate latest portfolio', exact: true }).click();
  await expect(page.locator('.atlas-case-version')).toContainText('Exposure v2');
  await openLocations(page);
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('Updated medical centre');
  await expect(page.locator('.exposure-table-scroll tbody')).toContainText('Updated medical centre');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Open saved version 1', exact: true }).click();
  await expect(page.locator('.atlas-case-version')).toContainText('Exposure v1');
  await openLocations(page);
  await page.getByRole('searchbox', { name: 'Find a location', exact: true }).fill('medical centre');
  await expect(page.locator('.exposure-table-scroll tbody')).toContainText('Ridgecrest medical centre');
  await expect(page.locator('.exposure-table-scroll tbody')).not.toContainText('Updated medical centre');
});

test('a deleted working location retains its Exposure snapshot and is not recreated by navigation', async ({ page }) => {
  const { inspector } = await assessedMedicalCentre(page);
  await inspector.getByRole('button', { name: 'Open in Portfolio', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Portfolio location details', exact: true });
  page.once('dialog', dialog => dialog.accept());
  await details.getByRole('button', { name: 'Delete location', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Insured location inventory', exact: true }).locator('tbody tr')).toHaveCount(17);
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'Ridgecrest medical centre', exact: true })).toBeVisible();
  await expect(inspector).toContainText('This location is no longer in the current portfolio');
  await expect(inspector.getByRole('button', { name: 'Open in Portfolio', exact: true })).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Open portfolio', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Insured location inventory', exact: true }).locator('tbody tr')).toHaveCount(17);
  await expect(page.getByRole('table', { name: 'Insured location inventory', exact: true })).not.toContainText('Ridgecrest medical centre');
});

test('Open in Portfolio resolves the source portfolio when another portfolio is active', async ({ page }) => {
  const { sourceId, inspector } = await assessedMedicalCentre(page);
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByLabel('Portfolio name', { exact: true }).fill('Other portfolio');
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Other portfolio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await inspector.getByRole('button', { name: 'Open in Portfolio', exact: true }).click();
  await expect(page.getByLabel('Active portfolio', { exact: true })).toHaveValue(sourceId);
  await expect(page.getByRole('complementary', { name: 'Portfolio location details', exact: true })).toContainText('Ridgecrest medical centre');
});

test('an unavailable source portfolio leaves the saved Exposure snapshot inspectable', async ({ page }) => {
  const { inspector } = await assessedMedicalCentre(page);
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Settings', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What do you insure?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'Ridgecrest medical centre', exact: true })).toBeVisible();
  await expect(inspector).toContainText('Source working portfolio unavailable');
  await expect(inspector.getByRole('button', { name: 'Open in Portfolio', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Open portfolio', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Investigate latest portfolio', exact: true })).toHaveCount(0);
  await expect(page.locator('.atlas-case-version')).toContainText('Exposure v1');
  await expect(page.locator('.portfolio-snapshot-notice')).toContainText('18 locations');
});
