import { expect, test } from '@playwright/test';

test('portfolio modal keeps background workspaces out of the accessibility tree and returns keyboard focus', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Create portfolio', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: `test-results/dialog-portfolio-${test.info().project.name}.png` });
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toHaveCount(0);
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
});

test('portfolio validation keeps the dialog open and a successful submission restores its trigger', async ({ page }) => {
  await page.goto('/exposure.html?mode=portfolios');
  const trigger = page.getByRole('button', { name: 'Create portfolio', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Portfolio name', { exact: true })).toBeFocused();
  await dialog.getByLabel('Portfolio name', { exact: true }).fill('Keyboard managed portfolio');
  await dialog.getByLabel('As-of date', { exact: true }).fill('2026-10-29');
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Keyboard managed portfolio', exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('a failed Portfolio save keeps its error and values in the dialog until a successful retry', async ({ page }) => {
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    let failed = false;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'portfolios' && !failed) {
        failed = true;
        throw new DOMException('Portfolio storage is full', 'QuotaExceededError');
      }
      return Reflect.apply(add, this, args);
    };
  });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Create portfolio', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  const name = dialog.getByLabel('Portfolio name', { exact: true });
  await name.fill('Retained unsaved portfolio');
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Portfolio storage is full');
  await expect(name).toHaveValue('Retained unsaved portfolio');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Retained unsaved portfolio', exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('close, cancel and backdrop dismissal restore Portfolio focus without closing its options', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Create portfolio', exact: true });
  const options = page.getByRole('button', { name: /^(Portfolio options|Hide options)$/ });
  const expanded = await options.getAttribute('aria-expanded');
  for (const dismissal of ['Close dialog', 'Cancel', 'backdrop']) {
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
    await expect(dialog).toBeVisible();
    if (dismissal === 'backdrop') await page.locator('.atlas-modal-backdrop').click({ position: { x: 1, y: 1 } });
    else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(options).toHaveAttribute('aria-expanded', expanded!);
  }
});

test('Recovery event modal isolates the workspace and Escape preserves underlying options', async ({ page }) => {
  await page.route('**/api/exposure/catalog?**', route => route.fulfill({ status: 503, json: { error: { code: 'archive_unavailable' } } }));
  await page.goto('/?mode=recovery');
  const options = page.getByRole('button', { name: /^(Recovery options|Hide options)$/ });
  const expanded = await options.getAttribute('aria-expanded');
  const trigger = page.getByRole('button', { name: 'Change event', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose an earthquake', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.screenshot({ path: `test-results/dialog-recovery-${test.info().project.name}.png` });
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toHaveCount(0);
  for (let index = 0; index < 15; index++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(options).toHaveAttribute('aria-expanded', expanded!);
  for (const dismissal of ['Close dialog', 'backdrop']) {
    await trigger.click();
    await expect(dialog).toBeFocused();
    if (dismissal === 'backdrop') await page.locator('.atlas-modal-backdrop').click({ position: { x: 1, y: 1 } });
    else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(options).toHaveAttribute('aria-expanded', expanded!);
  }
});

test('event dialog scrolls within a short mobile viewport while its heading and close control remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 480 });
  await page.route('**/api/exposure/catalog?**', route => route.fulfill({ status: 503, json: { error: { code: 'archive_unavailable' } } }));
  await page.goto('/?mode=recovery');
  await page.getByRole('button', { name: 'Change event', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose an earthquake', exact: true });
  const input = dialog.getByLabel('USGS event ID', { exact: true });
  await input.scrollIntoViewIfNeeded();
  await input.fill('ci38457511');
  await expect(input).toBeInViewport();
  expect(await dialog.locator('.atlas-modal-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole('heading', { name: 'Choose an earthquake', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
