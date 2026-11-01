import { expect, test } from '@playwright/test';

test('browser history suspends a hidden Portfolio dialog and retains its unsaved creation draft', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.goto('/?mode=exposure');
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByLabel('Portfolio name', { exact: true }).fill('Unsaved history draft');
  await dialog.getByLabel('Source', { exact: true }).fill('Analyst working draft');
  await dialog.getByLabel('As-of date', { exact: true }).fill('2026-10-15');

  await page.goBack();
  await expect(page).toHaveURL(/mode=exposure/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter locations', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Filter locations', exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/mode=portfolios/);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Portfolio name', { exact: true })).toHaveValue('Unsaved history draft');
  await expect(dialog.getByLabel('Source', { exact: true })).toHaveValue('Analyst working draft');
  await expect(dialog.getByLabel('As-of date', { exact: true })).toHaveValue('2026-10-15');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What do you insure?', exact: true })).toBeVisible();
});
