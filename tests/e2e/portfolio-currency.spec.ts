import { test, expect } from '@playwright/test';
import { demoPortfolio } from '../../frontend/src/exposure/fixtures';

test('existing fictional CAD demo updates to USD while imported CAD values remain unchanged', async ({ page }) => {
  // Seed the previous Dexie schema before the application opens the database.
  await page.route('**/currency-seed', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/currency-seed');
  const id = '00000000-0000-4000-8000-000000000001';
  await page.evaluate(async ({ demo, id }) => {
    const legacy = structuredClone(demo);
    Object.assign(legacy.locations.find(row => row.id === 'RC-CA')!, { name: 'Ridgecrest CAD schedule', currency: 'CAD' });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('catlas-portfolios-1', 10);
      request.onupgradeneeded = () => {
        const portfolios = request.result.createObjectStore('portfolios', { keyPath: 'id' });
        portfolios.createIndex('updatedAt', 'updatedAt');
        request.result.createObjectStore('preferences', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['portfolios', 'preferences'], 'readwrite');
        const portfolio = { id, name: 'Existing demo', revision: 1, updatedAt: new Date().toISOString(), data: legacy };
        tx.objectStore('portfolios').put(portfolio);
        tx.objectStore('portfolios').put({ ...portfolio, id: '00000000-0000-4000-8000-000000000002', name: 'Imported CAD', data: { ...legacy, synthetic: false } });
        tx.objectStore('preferences').put({ key: 'active', value: id });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { demo: demoPortfolio, id });
  await page.goto('/?mode=portfolios');
  const summary = page.getByLabel('Portfolio inventory summary');
  await expect(summary).toContainText('$289,000,000 USD');
  await expect(summary).not.toContainText('CAD');
  await page.getByLabel('Active portfolio', { exact: true }).selectOption('00000000-0000-4000-8000-000000000002');
  await expect(summary).toContainText('CA$12,000,000 CAD');
});
