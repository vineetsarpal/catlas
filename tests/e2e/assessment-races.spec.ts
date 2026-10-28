import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const event = { id: 'us-assessment-race', aliases: ['us-assessment-race'], name: 'Assessment race earthquake', magnitude: 6.2, latitude: 35.7, longitude: -117.6, occurredAt: '2019-07-06T03:19:53.000Z', updatedAt: '2026-10-24T12:00:00.000Z', significance: 1000 };
const grid = Buffer.from('<shakemap_grid event_id="us-assessment-race" shakemap_version="1" process_timestamp="2026-10-24T12:00:00Z"><event event_id="us-assessment-race"/><grid_specification nlon="2" nlat="2"/><grid_field name="MMI" index="1" units="intensity"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="LON" index="3" units="dd"/><grid_data>6 36 -118\n8 36 -117\n4 35 -118\n6 35 -117</grid_data></shakemap_grid>');
const detail = Buffer.from(JSON.stringify({ id: event.id, properties: { mag: event.magnitude, time: Date.parse(event.occurredAt), updated: Date.parse(event.updatedAt) }, geometry: { coordinates: [event.longitude, event.latitude, 8] } }));
const artifact = (bytes: Buffer, kind: string) => { const sha256 = createHash('sha256').update(bytes).digest('hex'); return { sha256, bytes: bytes.length, path: `/api/artifacts/${sha256}`, sourceUrl: `https://earthquake.usgs.gov/${kind}`, contentType: kind === 'grid' ? 'application/xml' : 'application/geo+json' }; };
const artifacts = { grid: artifact(grid, 'grid'), detail: artifact(detail, 'detail') };
type DigestGate = Window & { assessmentDigestStarted?: boolean; releaseAssessmentDigest?: () => void };

test('a delayed assessment cannot replace a newer observation selected in Recovery', async ({ page }) => {
  await page.route('**/api/exposure/catalog?**', route => route.fulfill({ json: { events: [event], checkedAt: '2026-10-26T12:00:00.000Z', range: { start: '2019-07-01T00:00:00.000Z', end: '2019-07-31T23:59:59.999Z' }, offset: 0, limit: 50, hasMore: false, completeness: 'complete', rejected: 0 } }));
  await page.route('**/api/exposure/captures', route => route.fulfill({ status: 201, json: { schemaVersion: 1, event, product: { id: 'race:product', source: 'us', code: event.id, updatedAt: event.updatedAt, retrospective: false }, capturedAt: '2026-10-25T12:00:00.000Z', artifacts } }));
  await page.route('**/api/exposure/artifacts/*', route => route.fulfill({ body: route.request().url().endsWith(artifacts.grid.sha256) ? grid : detail }));
  await page.goto('/exposure.html?recovery=parametric');
  await page.getByRole('button', { name: 'Portfolios', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await page.getByRole('button', { name: /Assessment race earthquake/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Earthquake evidence inspector' });
  await expect(inspector).toContainText(artifacts.grid.sha256);
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let delayed = false;
    crypto.subtle.digest = async (algorithm, data) => {
      if (!delayed) {
        delayed = true;
        (window as DigestGate).assessmentDigestStarted = true;
        await new Promise<void>(resolve => { (window as DigestGate).releaseAssessmentDigest = resolve; });
      }
      return digest(algorithm, data);
    };
  });
  await inspector.getByRole('button', { name: 'Assess portfolio', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as DigestGate).assessmentDigestStarted)).toBe(true);
  await page.getByRole('button', { name: 'Recovery', exact: true }).click();
  const scenario = page.getByRole('combobox', { name: 'Demonstration scenario', exact: true });
  if (!await scenario.isVisible()) await page.getByRole('button', { name: 'Assessment', exact: true }).first().click();
  await scenario.selectOption('outer');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Synthetic');
  await page.evaluate(() => (window as DigestGate).releaseAssessmentDigest!());
  await page.getByRole('button', { name: 'Exposure', exact: true }).click();
  await expect(page.getByRole('button', { name: /Assessment race earthquake/ })).toBeEnabled();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Synthetic');
  await expect(page.getByTestId('exposure-count')).toHaveText('—');
  await expect(inspector.getByRole('button', { name: 'Save investigation', exact: true })).toBeDisabled();
});
