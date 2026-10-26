import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Only browser-contract fixtures. These checks do not establish provider or hosted fit.
const bytes = { detail: Buffer.from('{"type":"Feature","id":"ci38457511"}\n'), grid: Buffer.from('<shakemap_grid>MMI fixture</shakemap_grid>\n') };
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const artifacts = Object.fromEntries(Object.entries(bytes).map(([kind, value]) => [kind, {
  sha256: digest(value), bytes: value.length, path: `/api/artifacts/${digest(value)}`,
  sourceUrl: `https://earthquake.usgs.gov/${kind === 'detail' ? 'fdsnws/event/1/query?format=geojson&eventid=ci38457511' : 'product/shakemap/ci38457511/download/grid.xml'}`,
  contentType: kind === 'detail' ? 'application/geo+json' : 'application/xml',
}]));
const manifest = {
  schemaVersion: 1,
  event: { id: 'ci38457511', aliases: ['ci38457511'], name: 'Ridgecrest', occurredAt: '2019-07-06T03:19:53.040Z', updatedAt: '2020-01-01T00:00:00.000Z' },
  product: { id: 'urn:usgs-product:ci:shakemap:ci38457511:1', source: 'ci', code: 'ci38457511', updatedAt: '2020-01-02T00:00:00.000Z', retrospective: false },
  capturedAt: '2026-10-24T20:00:00.000Z', artifacts, cache: 'miss', timings: { total: 123 },
};

test('inspect public evidence and verify the exact downloaded bytes before offering downloads', async ({ page }) => {
  const requests: { method: string; path: string; body: unknown; token: string | undefined }[] = [];
  await page.route('https://archive-proof.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) {
      requests.push({ method: request.method(), path, body: request.postDataJSON(), token: request.headers().authorization });
      if (path.startsWith('/api/artifacts/')) {
        const artifact = Object.values(bytes).find(value => path.endsWith(digest(value)));
        return route.fulfill({ status: artifact ? 200 : 404, body: artifact });
      }
      return route.fulfill({ json: { ...manifest, cache: request.method() === 'GET' ? 'hit' : 'miss' } });
    }
    const file = path === '/' ? 'index.html' : path.slice(1);
    try {
      const body = await readFile(`services/exposure-archive/public/${file}`);
      return route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('https://archive-proof.test/');
  await page.getByLabel('Proof token', { exact: true }).fill('test-proof-secret');
  await page.getByLabel('USGS event ID', { exact: true }).fill('ci38457511');
  await page.getByRole('button', { name: 'Capture or reuse evidence', exact: true }).click();
  await expect(page.getByText('Ridgecrest', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download verified grid', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retrieve saved capture', exact: true }).click();
  await expect(page.getByText('Captured evidence reused', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download verified grid', exact: true })).toBeVisible();
  expect(requests.find(request => request.method === 'POST')).toMatchObject({ path: '/api/captures', body: { eventId: 'ci38457511' }, token: 'Bearer test-proof-secret' });
  expect(requests.every(request => request.token === 'Bearer test-proof-secret')).toBe(true);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(requests.some(request => request.method === 'GET' && request.path === '/api/captures/ci38457511')).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await expect(page.locator('body')).not.toContainText('test-proof-secret');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('refuse a corrupted grid and recover only after an explicit retry', async ({ page }) => {
  let corrupt = true;
  await page.route('https://archive-proof.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/artifacts/')) {
      const artifact = Object.values(bytes).find(value => path.endsWith(digest(value)));
      const body = corrupt && artifact === bytes.grid ? Buffer.alloc(bytes.grid.length, 120) : artifact;
      return route.fulfill({ status: body ? 200 : 404, body });
    }
    if (path.startsWith('/api/')) return route.fulfill({ json: manifest });
    const file = path === '/' ? 'index.html' : path.slice(1);
    return route.fulfill({ body: await readFile(`services/exposure-archive/public/${file}`), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto('https://archive-proof.test/');
  await page.getByLabel('Proof token', { exact: true }).fill('test-proof-secret');
  await page.getByRole('button', { name: 'Capture or reuse evidence', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('SHA-256 does not match');
  await expect(page.getByRole('link', { name: 'Download verified grid', exact: true })).toHaveCount(0);
  corrupt = false;
  await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download verified grid', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('explain pending and interrupted captures and recover only on explicit retry', async ({ page }) => {
  await page.clock.install();
  let captureRequests = 0;
  const failures = ['capture_pending', 'capture_interrupted'];
  await page.route('https://archive-proof.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/captures') {
      const code = failures[captureRequests++];
      if (code) return route.fulfill({ status: 409, json: { error: { code, message: 'private backend diagnostics: test-proof-secret' } } });
      return route.fulfill({ json: manifest });
    }
    if (path.startsWith('/api/artifacts/')) {
      const artifact = Object.values(bytes).find(value => path.endsWith(digest(value)));
      return route.fulfill({ status: artifact ? 200 : 404, body: artifact });
    }
    const file = path === '/' ? 'index.html' : path.slice(1);
    return route.fulfill({ body: await readFile(`services/exposure-archive/public/${file}`), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto('https://archive-proof.test/');
  await page.getByLabel('Proof token', { exact: true }).fill('test-proof-secret');
  await page.getByRole('button', { name: 'Capture or reuse evidence', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This capture is still in progress. No complete evidence is available yet. Retry explicitly after it finishes.');
  await expect(page.getByRole('link', { name: /Download verified/ })).toHaveCount(0);
  await page.clock.fastForward(10_000);
  expect(captureRequests).toBe(1);
  await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This capture was interrupted. No complete evidence is available yet. Retry explicitly to try again.');
  await expect(page.getByRole('link', { name: /Download verified/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('private backend diagnostics');
  await expect(page.locator('body')).not.toContainText('test-proof-secret');
  await page.clock.fastForward(10_000);
  expect(captureRequests).toBe(2);
  await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download verified grid', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
  expect(captureRequests).toBe(3);
});

for (const refusal of [
  { code: 'provider_suspended', status: 502, message: 'A service provider has suspended access. The archive cannot complete this request. Try saved evidence where services remain available, or retry explicitly after access is restored.' },
  { code: 'provider_quota', status: 503, message: 'A service provider has reached its quota. This is separate from the archive’s storage budget. Try saved evidence where services remain available, or retry explicitly later.' },
  { code: 'usage_limit', status: 429, message: 'The archive capture usage budget is exhausted. New captures are paused. You can still try retrieving saved evidence.' },
  { code: 'capacity_exceeded', status: 507, message: 'The archive storage budget is full. New captures are paused. You can still try retrieving saved evidence.' },
]) {
  test(`explain ${refusal.code} without blocking saved evidence or retrying automatically`, async ({ page }) => {
    await page.clock.install();
    let captureRequests = 0;
    await page.route('https://archive-proof.test/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === '/api/captures') {
        captureRequests++;
        return route.fulfill({ status: refusal.status, json: { error: { code: refusal.code, message: 'private diagnostics: test-proof-secret' } } });
      }
      if (path.startsWith('/api/artifacts/')) {
        const artifact = Object.values(bytes).find(value => path.endsWith(digest(value)));
        return route.fulfill({ status: artifact ? 200 : 404, body: artifact });
      }
      if (path === '/api/captures/ci38457511') return route.fulfill({ json: { ...manifest, cache: 'hit' } });
      const file = path === '/' ? 'index.html' : path.slice(1);
      return route.fulfill({ body: await readFile(`services/exposure-archive/public/${file}`), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('https://archive-proof.test/');
    await page.getByLabel('Proof token', { exact: true }).fill('test-proof-secret');
    await page.getByRole('button', { name: 'Capture or reuse evidence', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(refusal.message);
    await expect(page.getByRole('link', { name: /Download verified/ })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('private diagnostics');
    await expect(page.locator('body')).not.toContainText('test-proof-secret');
    await page.clock.fastForward(10_000);
    expect(captureRequests).toBe(1);
    await page.getByRole('button', { name: 'Retrieve saved capture', exact: true }).click();
    await expect(page.getByText('Captured evidence reused', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download verified grid', exact: true })).toBeVisible();
    expect(captureRequests).toBe(1);
  });
}
