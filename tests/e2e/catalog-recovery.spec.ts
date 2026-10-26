import { test, expect } from '@playwright/test';

const retainedEvent = { id: 'retained-event', aliases: ['retained-event'], name: 'Retained catalog event', magnitude: 6, latitude: 35, longitude: -117, occurredAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z', significance: 601 };
const successfulPage = { events: [retainedEvent], checkedAt: '2026-10-25T12:00:00.000Z', range: { start: '2026-07-27T12:00:00.000Z', end: '2026-10-25T12:00:00.000Z' }, offset: 0, limit: 50, hasMore: false, completeness: 'complete', rejected: 0 };

test('failed historical discovery retains provenance and retries its submitted query after drafts change', async ({ page }) => {
  const requests: Record<string, string>[] = [];
  let failure = true;
  await page.route('**/api/exposure/catalog?**', route => {
    const query = Object.fromEntries(new URL(route.request().url()).searchParams);
    requests.push(query);
    if (query.mode === 'historical' && failure) return route.fulfill({ status: 503, json: { error: { code: 'source_unavailable' } } });
    return route.fulfill({ json: { ...successfulPage, events: query.mode === 'historical' ? [{ ...retainedEvent, id: 'historical-event', aliases: ['historical-event'], name: 'Recovered historical event' }] : [retainedEvent] } });
  });
  await page.goto('/exposure.html');
  await expect(page.getByRole('button', { name: /Retained catalog event/ })).toBeVisible();
  await expect(page.getByText(/^Last discovery check succeeded:/).locator('time')).toHaveAttribute('datetime', /T/);
  await page.getByRole('button', { name: 'Historical search', exact: true }).click();
  await page.getByLabel('Start date (UTC)').fill('1906-04-01');
  await page.getByLabel('End date (UTC)').fill('1906-04-30');
  await page.getByRole('button', { name: 'Search historical earthquakes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Previous successful results are retained');
  await expect(page.getByText(/^Last discovery check failed:/).locator('time')).toHaveAttribute('datetime', /T/);
  await expect(page.getByText(/Last successful retrieval:/).locator('time')).toHaveAttribute('datetime', successfulPage.checkedAt);
  await expect(page.getByRole('button', { name: /Retained catalog event/ })).toBeVisible();
  const failedQuery = requests.at(-1);
  await page.getByLabel('Source event ID').fill('changed-draft');
  failure = false;
  await page.getByRole('button', { name: 'Retry event discovery', exact: true }).click();
  await expect(page.getByRole('button', { name: /Recovered historical event/ })).toBeVisible();
  expect(requests.at(-1)).toEqual(failedQuery);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/^Last discovery check succeeded:/).locator('time')).toHaveAttribute('datetime', /T/);
});

test('catalog failures identify safe source and service states and recover only on explicit retry', async ({ page }) => {
  const outcomes = [
    { code: 'source_unavailable', text: 'Public earthquake source unavailable' },
    { code: 'database_unavailable', text: 'Archive database unavailable' },
    { code: 'object_store_unavailable', text: 'Archive object storage unavailable' },
    { code: 'unknown_provider_secret', text: 'Archive API unavailable' },
  ];
  let attempts = 0;
  let outcomeIndex = 0;
  await page.route('**/api/exposure/catalog?**', route => {
    attempts++;
    const outcome = outcomes[outcomeIndex];
    return outcome ? route.fulfill({ status: 503, json: { error: { code: outcome.code, message: 'private upstream diagnostic' } } }) : route.fulfill({ json: { ...successfulPage, events: [] } });
  });
  await page.goto('/exposure.html');
  await expect(page.getByRole('alert')).toContainText(outcomes[0].text);
  const initialAttempts = attempts;
  for (let index = 0; index < outcomes.length; index++) {
    await expect(page.getByRole('alert')).toContainText(outcomes[index].text);
    await expect(page.getByRole('alert')).toContainText('No successful catalog results are available');
    await expect(page.getByText(/^Last discovery check failed:/).locator('time')).toHaveAttribute('datetime', /T/);
    await expect(page.getByText(/^Failed query:/)).toContainText('Last 90 days');
    await expect(page.getByText('private upstream diagnostic')).toHaveCount(0);
    expect(attempts).toBe(initialAttempts + index);
    outcomeIndex++;
    await page.getByRole('button', { name: 'Retry event discovery', exact: true }).click();
  }
  await expect(page.getByText('No matching events in the retrieved results.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry event discovery', exact: true })).toHaveCount(0);
});

test('failed continuation retries the same pinned page and preserves the retained catalog', async ({ page }) => {
  const requests: Record<string, string>[] = [];
  let failed = true;
  await page.route('**/api/exposure/catalog?**', route => {
    const query = Object.fromEntries(new URL(route.request().url()).searchParams);
    requests.push(query);
    if (query.offset === '50' && failed) return route.fulfill({ status: 503, json: { error: { code: 'database_unavailable' } } });
    return route.fulfill({ json: query.offset === '50' ? { ...successfulPage, offset: 50, events: [{ ...retainedEvent, id: 'second-page', aliases: ['second-page'], name: 'Second catalog page' }] } : { ...successfulPage, hasMore: true, completeness: 'more-available' } });
  });
  await page.goto('/exposure.html');
  await expect(page.getByRole('button', { name: /Retained catalog event/ })).toBeVisible();
  await page.getByRole('button', { name: 'Load more earthquakes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Archive database unavailable');
  await expect(page.getByText(/^Failed query:/)).toContainText('source offset 50');
  const failedPage = requests.at(-1);
  expect(failedPage).toEqual({ significant: 'true', offset: '50', end: successfulPage.range.end });
  await expect(page.getByRole('button', { name: /Retained catalog event/ })).toBeVisible();
  await page.getByRole('button', { name: 'Historical search', exact: true }).click();
  await page.getByLabel('Source event ID').fill('different-draft');
  failed = false;
  await page.getByRole('button', { name: 'Retry event discovery', exact: true }).click();
  await expect(page.getByRole('button', { name: /Second catalog page/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Retained catalog event/ })).toBeVisible();
  expect(requests.at(-1)).toEqual(failedPage);
  await expect(page.locator('.catalog-event-list li')).toHaveCount(2);
});
