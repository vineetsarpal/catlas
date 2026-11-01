import { expect, test } from '@playwright/test';

test('switching to Portfolio does not turn Exposure event browsing into a modal', async ({ page }) => {
  await page.goto('/?mode=exposure');
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What do you insure?', exact: true })).toBeVisible();
});

test('Escape in Exposure preserves a hidden unsaved Portfolio location edit', async ({ page }) => {
  await page.goto('/?mode=portfolios');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo · Ridgecrest locations', exact: true })).toBeVisible();
  const views = page.getByRole('group', { name: 'Location view', exact: true });
  if (await views.isVisible()) await views.getByRole('button', { name: 'Locations', exact: true }).click();
  const table = page.getByRole('table', { name: 'Insured location inventory', exact: true });
  await table.getByRole('button', { name: 'Ridgecrest medical centre', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Portfolio location details', exact: true });
  await details.getByRole('button', { name: 'Edit location', exact: true }).click();
  const edit = page.getByRole('form', { name: 'Edit location', exact: true });
  await edit.getByLabel('Location name', { exact: true }).fill('Unsaved draft centre');
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('Location name', { exact: true })).toHaveValue('Unsaved draft centre');
});
