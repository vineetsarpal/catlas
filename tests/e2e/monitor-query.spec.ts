import { expect, test, type Page } from '@playwright/test';

const acquiredAt = '2026-10-29T12:00:00.000Z';
const liveFeed = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

function earthquake(name: string) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 'monitor-query-earthquake',
      properties: { mag: 5.2, place: name, time: Date.parse(acquiredAt), updated: Date.parse(acquiredAt) },
      geometry: { type: 'Point', coordinates: [-117.6, 35.7, 8] },
    }],
  };
}

async function openPanel(page: Page, name: 'Attention' | 'Feeds') {
  const tool = page.getByRole('navigation', { name: 'Monitor tools' }).getByRole('button', { name, exact: true });
  if (!await tool.isVisible()) await page.getByRole('button', { name: 'Monitor options', exact: true }).click();
  if (await tool.getAttribute('aria-expanded') !== 'true') await tool.click();
  return page.getByRole('region', { name: 'Live monitoring controls' });
}

for (const entry of ['/', '/exposure.html']) {
  test(`${entry} retains Monitor observations after a failed refresh and recovers only on the next explicit refresh`, async ({ page }) => {
    await page.clock.install({ time: new Date(acquiredAt) });
    await page.clock.pauseAt(new Date(Date.parse(acquiredAt) + 1000));
    await page.addInitScript(() => localStorage.setItem('catlas-monitor-1', JSON.stringify({
      earthquakes: true, cyclones: false, wind: false, vessels: false,
      fires: false, perimeters: false, alerts: false, locations: true,
      nearPortfolio: false, watchedOnly: false, watchlist: [],
    })));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    let unavailable = false;
    let eventName = 'Retained Monitor observation';
    let requests = 0;
    await page.route(liveFeed, async route => {
      requests++;
      await route.fulfill(unavailable
        ? { status: 503, body: 'Temporarily unavailable' }
        : { json: earthquake(eventName) });
    });

    await page.goto(`${entry}?mode=monitor`);
    let panel = await openPanel(page, 'Attention');
    await expect(panel.getByRole('button', { name: 'M5.2 · Retained Monitor observation', exact: true })).toBeVisible();
    panel = await openPanel(page, 'Feeds');
    const status = panel.locator('.monitor-feed-status').filter({ has: page.getByText('USGS earthquakes', { exact: true }) });
    await expect(status).toContainText('Latest check succeeded');
    const checkedBeforeFailure = await status.locator('small').first().textContent();

    unavailable = true;
    const beforeRefresh = requests;
    await panel.getByRole('button', { name: 'Refresh enabled feeds', exact: true }).click();
    await expect(status).toContainText('Unavailable · previous data may be stale');
    expect(requests).toBe(beforeRefresh + 1);
    await expect(status.locator('small').first()).toHaveText(checkedBeforeFailure!);
    panel = await openPanel(page, 'Attention');
    await expect(panel.getByRole('button', { name: 'M5.2 · Retained Monitor observation', exact: true })).toBeVisible();

    // Default retry delays would issue more requests here; the scheduled poll is at 60 seconds.
    await page.clock.runFor(10_000);
    expect(requests).toBe(beforeRefresh + 1);
    panel = await openPanel(page, 'Feeds');
    await expect(status).toContainText('Unavailable · previous data may be stale');

    unavailable = false;
    eventName = 'Replacement Monitor observation';
    await panel.getByRole('button', { name: 'Refresh enabled feeds', exact: true }).click();
    await expect(status).toContainText('Latest check succeeded');
    await expect(status.locator('small').first()).not.toHaveText(checkedBeforeFailure!);
    expect(requests).toBe(beforeRefresh + 2);
    panel = await openPanel(page, 'Attention');
    await expect(panel.getByRole('button', { name: 'M5.2 · Replacement Monitor observation', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'M5.2 · Retained Monitor observation', exact: true })).toHaveCount(0);
  });
}
