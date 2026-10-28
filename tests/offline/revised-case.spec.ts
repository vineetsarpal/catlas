import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import { openLocations } from '../helpers/exposure-workspace';

const event = { id: 'cat54-offline', aliases: ['cat54-offline'], name: 'Synthetic portable earthquake', magnitude: 6.2,
  latitude: 35.5, longitude: -117.5, occurredAt: '2019-07-06T03:19:53.000Z', updatedAt: '2026-10-27T12:00:00.000Z', significance: 700 };
const grid = (version: number) => `<shakemap_grid event_id="${event.id}" shakemap_version="${version}" process_timestamp="2026-10-27T12:00:00Z"><event event_id="${event.id}"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-124 40 ${version === 1 ? 3 : 6}\n-110 40 ${version === 1 ? 3 : 6}\n-124 30 ${version === 1 ? 3 : 6}\n-110 30 ${version === 1 ? 3 : 6}</grid_data></shakemap_grid>`;
async function download(page: Page) {
  await openLocations(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download self-contained case', exact: true }).click();
  const bytes = await fs.readFile((await (await downloading).path())!);
  return { bytes, envelope: JSON.parse(gunzipSync(bytes).toString()) };
}

test('exact ZIP transfers revised archive cases with services unavailable and preserves working inventory', async ({ page, browser, baseURL }) => {
  let unavailable = false;
  const originals = new Map<string, string>();
  const captures: { url: string; body: unknown }[] = [];
  const forbidden: string[] = [];
  const artifact = (raw: string, kind: string) => {
    const sha256 = createHash('sha256').update(raw).digest('hex'); originals.set(sha256, raw);
    return { sha256, bytes: Buffer.byteLength(raw), path: `/api/artifacts/${sha256}`, sourceUrl: `https://earthquake.usgs.gov/${kind}`, contentType: kind === 'grid' ? 'application/xml' : 'application/geo+json' };
  };
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== baseURL) { forbidden.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (unavailable) { forbidden.push(url.pathname); return route.abort(); }
    if (url.pathname.endsWith('/catalog')) return route.fulfill({ json: { events: [event], checkedAt: event.updatedAt, range: { start: '2026-07-29T00:00:00.000Z', end: '2026-10-27T00:00:00.000Z' }, offset: 0, limit: 50, hasMore: false, completeness: 'complete', rejected: 0 } });
    if (request.method() === 'POST') {
      captures.push({ url: url.pathname, body: request.postDataJSON() });
      expect(request.postDataJSON()).toEqual({ eventId: event.id });
      const version = url.pathname.endsWith('/check') ? 2 : 1;
      const detail = JSON.stringify({ id: event.id, properties: { mag: event.magnitude, time: Date.parse(event.occurredAt), updated: Date.parse(event.updatedAt) }, geometry: { coordinates: [event.longitude, event.latitude, 8] } });
      return route.fulfill({ json: { schemaVersion: 1, event, product: { id: `portable-product-${version}`, source: 'us', code: event.id, updatedAt: event.updatedAt, retrospective: false }, capturedAt: '2026-10-27T12:05:00.000Z', artifacts: { grid: artifact(grid(version), 'grid'), detail: artifact(detail, 'detail') } } });
    }
    const raw = originals.get(url.pathname.split('/').at(-1)!);
    return raw === undefined ? route.abort() : route.fulfill({ body: raw });
  });
  await page.goto('/exposure.html');
  await page.getByRole('button', { name: 'Portfolios', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: /Synthetic portable earthquake/ }).click();
  await page.getByRole('button', { name: 'Assess portfolio', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  const first = await download(page);
  await page.getByRole('button', { name: 'Check source for updates', exact: true }).click();
  await page.getByRole('button', { name: 'Apply selected evidence as new version', exact: true }).click();
  await expect(page.getByTestId('exposure-count')).toHaveText('18');
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  const second = await download(page);
  expect(second.envelope.record).toMatchObject({ version: 2, caseId: first.envelope.record.caseId, previousId: first.envelope.record.id, portfolioHash: first.envelope.record.portfolioHash });
  unavailable = true;
  for (const [version, saved] of [[1, first], [2, second]] as const) {
    if (await page.getByRole('button', { name: 'Saved', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: 'Saved', exact: true }).click();
    await page.getByRole('button', { name: `Open saved version ${version}`, exact: true }).click();
    expect((await download(page)).envelope).toEqual(saved.envelope);
  }
  expect(forbidden).toEqual([]);
  expect(captures).toEqual([{ url: '/api/exposure/captures', body: { eventId: event.id } }, { url: '/api/exposure/captures/check', body: { eventId: event.id } }]);

  const freshContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const fresh = await freshContext.newPage();
  const requests: string[] = [];
  await fresh.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL || url.pathname.startsWith('/api/')) { requests.push(`${route.request().method()} ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  try {
    await fresh.goto(new URL('/exposure.html', baseURL!).href);
    await fresh.getByRole('button', { name: 'Portfolios', exact: true }).click();
    await fresh.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
    if (!await fresh.getByRole('table', { name: 'Insured location inventory' }).isVisible()) await fresh.getByRole('button', { name: /Show locations/ }).click();
    fresh.once('dialog', dialog => dialog.accept());
    await fresh.getByRole('button', { name: 'Delete Phoenix warehouse', exact: true }).click();
    await expect(fresh.getByRole('table', { name: 'Insured location inventory' }).locator('tbody tr')).toHaveCount(17);
    await fresh.getByRole('button', { name: 'Exposure', exact: true }).click();
    const beforeImport = requests.length;
    for (const saved of [second, first]) {
      if (await fresh.getByRole('button', { name: 'Saved', exact: true }).getAttribute('aria-expanded') !== 'true') await fresh.getByRole('button', { name: 'Saved', exact: true }).click();
      await fresh.getByLabel('Open a self-contained case').setInputFiles({ name: 'portable.json.gz', mimeType: 'application/gzip', buffer: saved.bytes });
      await expect(fresh.getByTestId('exposure-count')).toHaveText(saved === first ? '0' : '18');
      expect((await download(fresh)).envelope).toEqual(saved.envelope);
    }
    expect(requests.slice(beforeImport)).toEqual([]);
    await fresh.reload();
    await fresh.getByRole('button', { name: 'Saved', exact: true }).click();
    await fresh.getByRole('button', { name: 'Open saved version 2', exact: true }).click();
    expect((await download(fresh)).envelope).toEqual(second.envelope);
    // Discovery may report the missing endpoint on entry; reopening never fetches source artifacts.
    expect(requests.slice(beforeImport).every(request => request === 'GET /api/exposure/catalog')).toBe(true);
    await fresh.getByRole('button', { name: 'Portfolios', exact: true }).click();
    if (!await fresh.getByRole('table', { name: 'Insured location inventory' }).isVisible()) await fresh.getByRole('button', { name: /Show locations/ }).click();
    await expect(fresh.getByRole('table', { name: 'Insured location inventory' }).locator('tbody tr')).toHaveCount(17);
    await expect(fresh.getByRole('table', { name: 'Insured location inventory' })).not.toContainText('Phoenix warehouse');
  } finally { await freshContext.close(); }
});
