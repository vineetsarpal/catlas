import { expect, type Page } from '@playwright/test';

export async function openRecoveryAssessment(page: Page) {
  const button = page.getByRole('navigation', { name: 'Recovery tools', exact: true }).getByRole('button', { name: 'Assessment', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(page.locator('#atlas-recovery-panel')).toBeVisible();
}

export async function openRecoveryHistory(page: Page) {
  const button = page.getByRole('navigation', { name: 'Recovery tools', exact: true }).getByRole('button', { name: 'History', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(page.locator('#atlas-recovery-panel')).toBeVisible();
}

export async function openRecoveryDetails(page: Page) {
  const button = page.getByRole('navigation', { name: 'Recovery tools', exact: true }).getByRole('button', { name: 'Recovery details', exact: true });
  await expect(async () => {
    if (!await page.locator('#atlas-recovery-inspector').isVisible()) await button.click();
    await expect(page.locator('#atlas-recovery-inspector')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 5000 });
}

export async function closeRecoveryPanels(page: Page) {
  await expect(page.getByTestId("treaty-total")).toBeAttached();
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-settled", "true");
  await openRecoveryDetails(page);
  for (const name of ['Close recovery options', 'Close recovery details']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
}
