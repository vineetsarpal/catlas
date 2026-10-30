import { expect, test, type Page } from '@playwright/test';

async function createPortfolio(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create portfolio', exact: true });
  await dialog.getByLabel('Portfolio name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openInventory(page: Page) {
  if (!await page.getByRole('table', { name: 'Insured location inventory' }).isVisible()) {
    await page.getByRole('button', { name: /Show locations/ }).click();
  }
}

async function addLocation(page: Page, id: string, name: string) {
  const addTool = page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Add locations', exact: true });
  if (await addTool.getAttribute('aria-expanded') !== 'true') await addTool.click();
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add location', exact: true });
  await form.getByLabel('Location ID', { exact: true }).fill(id);
  await form.getByLabel('Location name', { exact: true }).fill(name);
  await form.getByLabel('Latitude', { exact: true }).fill('35.62');
  await form.getByLabel('Longitude', { exact: true }).fill('-117.67');
  await form.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Insured location inventory' })).toContainText(name);
}

test('a portfolio created in one tab appears in another open tab without reloading', async ({ page, context }) => {
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/?mode=portfolios');
  await expect(second.getByRole('heading', { name: 'What do you insure?', exact: true })).toBeVisible();
  await createPortfolio(page, 'Live shared inventory');
  await expect(second.getByLabel('Active portfolio', { exact: true }).locator('option:checked')).toContainText('Live shared inventory');
  await expect(second.getByRole('heading', { name: 'Live shared inventory', exact: true })).toBeVisible();
  const options = second.getByRole('button', { name: 'Portfolio options', exact: true });
  if (await options.isVisible()) await options.click();
  await expect(second.getByLabel('Your portfolios', { exact: true }).getByRole('button', { name: /Live shared inventory/ })).toBeVisible();
  await second.close();
});

test('a location draft retains its original revision when another tab updates the inventory', async ({ page, context }) => {
  await page.goto('/');
  await createPortfolio(page, 'Concurrent inventory');
  await addLocation(page, 'SITE', 'Original site');
  const second = await context.newPage();
  await second.goto('/?mode=portfolios');
  await openInventory(second);
  await second.getByRole('button', { name: 'Edit Original site', exact: true }).click();
  const draft = second.getByRole('form', { name: 'Edit location', exact: true });
  await draft.getByLabel('Location name', { exact: true }).fill('Unsaved local name');
  await page.getByRole('button', { name: 'Edit Original site', exact: true }).click();
  await page.getByRole('form', { name: 'Edit location', exact: true }).getByLabel('Location name', { exact: true }).fill('Newer saved name');
  await page.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Insured location inventory' })).toContainText('Newer saved name');
  await expect(draft.getByLabel('Location name', { exact: true })).toHaveValue('Unsaved local name');
  await draft.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');
  await expect(draft.getByLabel('Location name', { exact: true })).toHaveValue('Unsaved local name');
  await expect(page.getByRole('table', { name: 'Insured location inventory' })).toContainText('Newer saved name');
  await second.close();
});

test('active selection and deletion propagate across tabs without an open draft', async ({ page, context }) => {
  await page.goto('/');
  await createPortfolio(page, 'First inventory');
  const firstId = await page.getByLabel('Active portfolio', { exact: true }).inputValue();
  const second = await context.newPage();
  await second.goto('/');
  await createPortfolio(page, 'Second inventory');
  await expect(second.getByRole('heading', { name: 'Second inventory', exact: true })).toBeVisible();
  await page.getByLabel('Active portfolio', { exact: true }).selectOption(firstId);
  await expect(second.getByRole('heading', { name: 'First inventory', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Settings', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete portfolio', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Second inventory', exact: true })).toBeVisible();
  await expect(second.getByLabel('Active portfolio', { exact: true }).locator('option')).toHaveCount(2);
  const settingsTool = page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Settings', exact: true });
  await expect(settingsTool).toHaveAttribute('aria-expanded', 'false');
  await settingsTool.click();
  await page.getByRole('button', { name: 'Delete portfolio', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'What do you insure?', exact: true })).toBeVisible();
  await second.close();
});

test('an external selection and deletion retain the original draft until it is discarded', async ({ page, context }) => {
  await page.goto('/');
  await createPortfolio(page, 'Draft inventory');
  const originalId = await page.getByLabel('Active portfolio', { exact: true }).inputValue();
  await addLocation(page, 'SITE', 'Original site');
  const second = await context.newPage();
  await second.goto('/');
  await openInventory(second);
  await second.getByRole('button', { name: 'Edit Original site', exact: true }).click();
  const input = second.getByRole('form', { name: 'Edit location', exact: true }).getByLabel('Location name', { exact: true });
  await input.fill('Retained draft name');
  await createPortfolio(page, 'Replacement inventory');
  await expect(second.getByLabel('Active portfolio', { exact: true }).locator('option:checked')).toContainText('Replacement inventory');
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toContainText('different portfolio is active');
  await expect(input).toHaveValue('Retained draft name');
  await page.getByLabel('Active portfolio', { exact: true }).selectOption(originalId);
  await expect(page.getByRole('heading', { name: 'Draft inventory', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Settings', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete portfolio', exact: true }).click();
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toContainText('deleted');
  await expect(input).toHaveValue('Retained draft name');
  await second.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');
  await expect(input).toHaveValue('Retained draft name');
  await second.getByRole('button', { name: 'Discard unsaved work and show active portfolio', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Replacement inventory', exact: true })).toBeVisible();
  await expect(second.getByRole('form', { name: 'Edit location', exact: true })).toHaveCount(0);
  await second.close();
});

test('settings and a reviewed CSV remain tied to their original inventory revision', async ({ page, context }) => {
  await page.goto('/');
  await createPortfolio(page, 'Reviewed inventory');
  await addLocation(page, 'SITE', 'Original site');
  const second = await context.newPage();
  await second.goto('/');
  const tools = second.getByRole('navigation', { name: 'Portfolio tools' });
  await tools.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = second.getByRole('heading', { name: 'Portfolio settings', exact: true }).locator('..').locator('..');
  await settings.getByLabel('Source', { exact: true }).fill('Unsaved source');
  await page.getByRole('button', { name: 'Edit Original site', exact: true }).click();
  await page.getByRole('form', { name: 'Edit location' }).getByLabel('Location name', { exact: true }).fill('Newer site');
  await page.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toContainText('changed since editing began');
  await expect(settings.getByLabel('Source', { exact: true })).toHaveValue('Unsaved source');
  await settings.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');
  await expect(settings.getByLabel('Source', { exact: true })).toHaveValue('Unsaved source');
  await settings.getByRole('button', { name: 'Cancel details', exact: true }).click();
  await tools.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await second.getByLabel('Preview portfolio CSV', { exact: true }).setInputFiles({ name: 'locations.csv', mimeType: 'text/csv', buffer: Buffer.from('location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\nNEW,Imported site,-117.67,35.62,100,USD,R,B\n') });
  const preview = second.getByRole('region', { name: 'CSV import preview', exact: true });
  await expect(preview).toContainText('Result: 2 locations');
  await preview.getByLabel('I have reviewed the changes and excluded rows.').check();
  await addLocation(page, 'REMOTE', 'Remote addition');
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toBeVisible();
  await expect(preview).toContainText('Result: 2 locations');
  await expect(preview.getByLabel('I have reviewed the changes and excluded rows.')).toBeChecked();
  await preview.getByRole('button', { name: 'Apply import', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');
  await expect(preview).toBeVisible();
  await second.getByRole('button', { name: 'Discard unsaved work and show active portfolio', exact: true }).click();
  await openInventory(second);
  await expect(second.getByRole('table', { name: 'Insured location inventory' })).toContainText('Remote addition');
  await expect(second.getByRole('table', { name: 'Insured location inventory' })).not.toContainText('Imported site');
  await second.close();
});

test('a live inventory change never rewrites a saved Exposure snapshot', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: 'Investigate Ridgecrest replay', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  const second = await context.newPage();
  await second.goto('/');
  await openInventory(second);
  second.once('dialog', dialog => dialog.accept());
  await second.getByRole('button', { name: 'Delete Phoenix warehouse', exact: true }).click();
  await expect(second.getByRole('table', { name: 'Insured location inventory' }).locator('tbody tr')).toHaveCount(17);
  await expect(page.getByRole('button', { name: 'Investigate latest portfolio', exact: true })).toBeVisible();
  await expect(page.locator('.portfolio-snapshot-notice')).toContainText('18 locations');
  await expect(page.getByTestId('exposure-count')).toHaveText('11');
  await expect(page.locator('.atlas-case-version')).toContainText('Exposure v1');
  await second.close();
});

test('a failed live read retains the last inventory and can be retried explicitly', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      if (this.name === 'catlas-portfolios-1' && args[1] === 'readonly' && Reflect.get(window, 'failNextPortfolioRead')) {
        Reflect.set(window, 'failNextPortfolioRead', false);
        throw new DOMException('Test portfolio read unavailable', 'UnknownError');
      }
      return Reflect.apply(transaction, this, args);
    };
  });
  await page.goto('/');
  await createPortfolio(page, 'Last verified inventory');
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Last verified inventory', exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'failNextPortfolioRead', true));
  await createPortfolio(second, 'New active inventory');
  await expect(page.getByRole('alert')).toContainText('Test portfolio read unavailable');
  await expect(page.getByRole('heading', { name: 'Last verified inventory', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create portfolio', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry portfolio storage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New active inventory', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await second.close();
});

test('cancelling a location draft keeps simultaneous settings work until it is also cancelled', async ({ page, context }) => {
  await page.goto('/');
  await createPortfolio(page, 'Multiple drafts');
  const second = await context.newPage();
  await second.goto('/');
  const tools = second.getByRole('navigation', { name: 'Portfolio tools' });
  await tools.getByRole('button', { name: 'Settings', exact: true }).click();
  await second.getByLabel('Source', { exact: true }).fill('Unsaved settings source');
  await tools.getByRole('button', { name: 'Add locations', exact: true }).click();
  await second.getByRole('button', { name: 'Add location', exact: true }).click();
  const location = second.getByRole('form', { name: 'Add location', exact: true });
  await location.getByLabel('Location name', { exact: true }).fill('Unsaved new location');
  await page.getByRole('navigation', { name: 'Portfolio tools' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).fill('Remote saved source');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toBeVisible();
  await location.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toBeVisible();
  await tools.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(second.getByLabel('Source', { exact: true })).toHaveValue('Unsaved settings source');
  await second.screenshot({ path: `/private/tmp/catlas-reactive-qa/draft-${test.info().project.name}.png` });
  await second.getByRole('button', { name: 'Cancel details', exact: true }).click();
  await expect(second.getByRole('status', { name: 'Retained portfolio draft' })).toHaveCount(0);
  await expect(second.getByLabel('Source', { exact: true })).toHaveValue('Remote saved source');
  await second.close();
});
