/// <reference path="../../services/exposure-archive/node_modules/@cloudflare/workers-types/index.d.ts" />
import { test, expect } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import { createArchiveHandler } from '../../services/exposure-archive/src/archive';
import { ArchiveError, type ArchiveDatabase, type Capture, type ArchiveDependencies } from '../../services/exposure-archive/src/types';
import { archiveBridge } from '../../functions/_archive';

// Node fixture equivalent of the Workers byte-counting stream runtime primitive.
class FixtureFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expected: number) { let received = 0; super({ transform(chunk, controller) { received += chunk.byteLength; if (received > expected) throw new Error('Length exceeded'); controller.enqueue(chunk); }, flush() { if (received !== expected) throw new Error('Length mismatch'); } }); }
}
Object.assign(globalThis, { FixedLengthStream: FixtureFixedLengthStream });

test('real archive HTTP boundaries recover visibly while frozen local evidence stays usable', async ({ page }) => {
  const token = 'cat50-local-fixture-only-32-character-token';
  let failure: 'source'|'database'|'objects'|'api'|null = 'source';
  const captured = new Map<string, Capture>();
  const objects = new Map<string, { bytes: ArrayBuffer; hash: ArrayBuffer }>();
  let grid = '<shakemap_grid event_id="cat50-public" shakemap_version="1" process_timestamp="2026-10-24T12:00:00Z"><event event_id="cat50-public"/><grid_specification nlon="2" nlat="2"/><grid_field name="MMI" index="1" units="intensity"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="LON" index="3" units="dd"/><grid_data>6 36 -118\n8 36 -117\n4 35 -118\n6 35 -117</grid_data></shakemap_grid>';
  const detail = { type: 'Feature', id: 'cat50-public', properties: { mag: 6.2, place: 'Availability fixture earthquake', time: Date.parse('2019-07-06T03:19:53.000Z'), updated: Date.parse('2026-10-24T12:00:00.000Z'), sig: 900, ids: ',cat50-public,', products: { shakemap: [{ id: 'product:cat50-public', source: 'atlas', code: 'cat50-public', updateTime: Date.parse('2026-10-24T12:00:00.000Z'), status: 'UPDATE', contents: { 'download/grid.xml': { url: 'https://earthquake.usgs.gov/product/shakemap/cat50-public/atlas/1/download/grid.xml' } } }] } }, geometry: { type: 'Point', coordinates: [-117.6, 35.7, 8] } };
  let leased = false;
  const database: ArchiveDatabase = {
    async lookup(id) { if (failure === 'database') throw new ArchiveError('database_unavailable', 'private database connection string', 503); return captured.get(id) ?? null; },
    async status() { return null; },
    async acquire() { if (leased) return false; leased = true; return true; },
    async release() { leased = false; },
    async publish(_owner, capture) { for (const id of capture.event.aliases) captured.set(id, capture); },
    async associate(_owner, requested, canonical) { const capture = captured.get(canonical); if (capture) captured.set(requested, capture); },
    async reserve() {}, async setBackupUsage() {}, async recordOrphan() {},
    async orphanCandidates() { return []; }, async acquireMaintenance() { return false; },
    async usage() { return { databaseBytes: 0, reservedArtifactBytes: 0, referencedArtifactBytes: 0, abandonedArtifactBytes: 0, recordedBackupBytes: 0, captureAttemptsToday: 0, maintenanceRequestsToday: 0, usageDate: '2026-10-26' }; },
    async referencedArtifact(sha256) { for (const capture of captured.values()) for (const artifact of Object.values(capture.artifacts)) if (artifact.sha256 === sha256) return artifact; return null; },
  };
  const deps: ArchiveDependencies = { database, rateLimit: async () => true,
    providerFetch: async input => {
      const url = new URL(String(input));
      if (url.searchParams.has('eventid') && failure === 'source') return new Response('private source diagnostic', { status: 503 });
      return url.pathname.endsWith('grid.xml') ? new Response(grid) : Response.json(url.searchParams.has('eventid') ? detail : { type: 'FeatureCollection', features: [detail] });
    },
    bucket: {
      async head(key) { if (failure === 'objects') throw new Error('private R2 diagnostic'); const item = objects.get(key); return item ? { size: item.bytes.byteLength, checksums: { sha256: item.hash } } : null; },
      async put(key, value) { const bytes = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer(); objects.set(key, { bytes, hash: await crypto.subtle.digest('SHA-256', bytes) }); },
      async get(key) { const item = objects.get(key); return item ? { size: item.bytes.byteLength, checksums: { sha256: item.hash }, body: new Response(item.bytes).body! } : null; },
    },
  };
  const handler = createArchiveHandler(deps);
  await page.route('**/api/exposure/**', async route => {
    const original = route.request();
    const result = await archiveBridge(new Request(original.url(), { method: original.method(), headers: original.headers(), ...(original.method() === 'POST' ? { body: original.postData()! } : {}) }), { ARCHIVE_API_ORIGIN: 'https://fixture.example.workers.dev', ARCHIVE_PROOF_TOKEN: token }, async (input, init) => {
      if (failure === 'api') throw new Error('private API transport diagnostic');
      return handler(new Request(String(input), init), { PROOF_TOKEN: token });
    });
    await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
  });
  await page.goto('/exposure.html');
  await page.getByRole('button', { name: /Availability fixture earthquake/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Earthquake evidence inspector' });
  await expect(inspector).toContainText('Public earthquake source unavailable');
  await expect(page.getByTestId('exposure-count')).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Assess portfolio', exact: true })).toBeDisabled();
  failure = null;
  await inspector.getByRole('button', { name: 'Retry evidence retrieval', exact: true }).click();
  await expect(inspector).toContainText('Original evidence verified');
  const frozenHash = await inspector.locator('code').innerText();
  await page.getByRole('button', { name: 'Portfolios', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: 'Assess portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Save investigation', exact: true }).click();
  for (const [boundary, label] of [['database', 'Archive database unavailable'], ['objects', 'Archive object storage unavailable'], ['api', 'Archive API unavailable']] as const) {
    failure = boundary;
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await page.getByRole('button', { name: /Availability fixture earthquake/ }).click();
    await expect(inspector).toContainText(label);
    await expect(inspector).toContainText(frozenHash);
    await expect(inspector).not.toContainText('private');
    await expect(inspector.getByText('Last failed check', { exact: true })).toBeVisible();
    failure = null;
    await inspector.getByRole('button', { name: 'Retry evidence retrieval', exact: true }).click();
    await expect(inspector).toContainText('Original evidence verified');
    await expect(inspector).toContainText(frozenHash);
    await page.getByRole('button', { name: 'Saved', exact: true }).click();
    await expect(page.locator('.atlas-catalog-panel .exposure-history li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Open saved version 1', exact: true }).click();
    await expect(page.getByTestId('exposure-count')).not.toHaveText('—');
  }
  // Exercise the browser → real bridge → real archive HTTP update path.
  async function exportedRecord() {
    if (await page.getByRole('button', { name: 'Toggle location table' }).getAttribute('aria-expanded') !== 'true')
      await page.getByRole('button', { name: 'Toggle location table' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download self-contained case', exact: true }).click();
    return JSON.parse(gunzipSync(await fs.readFile((await (await downloading).path())!)).toString());
  }
  const original = await exportedRecord();
  await inspector.getByRole('button', { name: 'Check source for updates', exact: true }).click();
  await expect(inspector.getByRole('region', { name: 'Source update check' })).toContainText('No newer evidence found');
  expect(await exportedRecord()).toEqual(original);
  detail.properties.products.shakemap[0].id = 'product:cat50-public-revised';
  detail.properties.products.shakemap[0].updateTime = Date.parse('2026-10-27T12:00:00.000Z');
  grid = grid.replace('shakemap_version="1"', 'shakemap_version="2"').replace('6 36 -118', '3 36 -118');
  await inspector.getByRole('button', { name: 'Check source for updates', exact: true }).click();
  const pending = inspector.getByRole('region', { name: 'Captured update to apply' });
  await expect(pending).toContainText('product:cat50-public-revised');
  expect(await exportedRecord()).toEqual(original);
  await pending.getByRole('button', { name: 'Apply selected evidence as new version', exact: true }).click();
  const revised = await exportedRecord();
  expect(revised.record).toMatchObject({ caseId: original.record.caseId, version: 2, previousId: original.record.id,
    portfolio: original.record.portfolio, portfolioHash: original.record.portfolioHash, settings: original.record.settings });
  expect(revised.record.evidence.rawSha256).not.toBe(original.record.evidence.rawSha256);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('button', { name: 'Open saved version 1', exact: true }).click();
  expect(await exportedRecord()).toEqual(original);

});
