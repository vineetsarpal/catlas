import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
async function choose(page: Page, id: string) {
    await expect(page.getByRole('combobox', { name: 'Demonstration scenario', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Demonstration scenario', exact: true }).selectOption(id);
    await expect(page.getByRole('region', { name: 'Local history storage' })).toContainText('Saved locally');
}
async function download(page: Page, button: string | RegExp) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: typeof button === 'string' }).click();
    const file = await pending;
    return fs.readFile((await file.path())!, 'utf8');
}
test('real IndexedDB retains reviewed bytes, unreviewed snapshots, selection clear and explicit reset', async ({ page, context }, testInfo) => {
    await page.goto('/');
    await choose(page, 'ridgecrest');
    await page.getByLabel('Review notes', { exact: true }).fill('Exact retained review.');
    await page.getByRole('button', { name: 'Review evaluation v1', exact: true }).click();
    const original = await download(page, 'Download reviewed JSON');
    await page.getByRole('button', { name: 'Clear event selection', exact: true }).click();
    await expect(page.getByTestId('treaty-total')).toHaveCount(0);
    await expect(page.getByTestId('retained-evaluation')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('retained-evaluation')).toHaveCount(1);
    await expect(page.getByTestId('treaty-total')).toHaveCount(0);
    expect(await download(page, /Download archived reviewed packet/)).toBe(original);
    // Store a non-fixture input through the public repository seam. Resume must show
    // this exact snapshot, never the newest fixture with its old stored calculation.
    await page.evaluate(async () => {
        const repoUrl = '/src/persistence/repository.ts', packetUrl = '/src/domain/packets.ts', fixtureUrl = '/src/data/fixtures.ts';
        const { demoRepository } = await import(repoUrl), { evaluate } = await import(packetUrl), { ridgecrest, mainContract } = await import(fixtureUrl);
        await demoRepository.mutateLifecycle((state: any) => evaluate(state, { ...ridgecrest, id: 'SIM-RETAINED', name: 'Retained custom simulation', magnitude: 6.9, evidenceVersion: 'SIM-RETAINED-1', provenance: { kind: 'simulation', description: 'Persistence verification fixture' } }, { ...mainContract, eventCap: 9000000 }), null);
        const serviceUrl='/src/delivery/service.ts';
        const retained=await demoRepository.db.packets.toArray();
        await (await import(serviceUrl)).submitPacket(demoRepository,retained[0].value,'accept');
    });
    // Reopen a tab on the same origin, not just React's current in-memory state.
    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.getByTestId('retained-evaluation')).toHaveCount(2);
    const unreviewed = reopened.getByTestId('retained-evaluation').filter({ hasText: 'Retained custom simulation' });
    await expect(unreviewed).toContainText('Unreviewed / no packet');
    await unreviewed.getByRole('button', { name: /Resume evaluation/ }).click();
    await expect(reopened.getByTestId('treaty-total')).toHaveText('$4,000,000');
    await expect(reopened.getByRole('heading', { name: 'Retained custom simulation' })).toBeVisible();
    await expect(reopened.getByText('Raw magnitude', { exact: true }).locator('..')).toContainText('6.9 mw');
    await expect(reopened.locator('.aggregation')).toContainText('$9,000,000');
    await expect(reopened.getByRole('button', { name: 'Review evaluation v1', exact: true })).toBeEnabled();
    expect(await download(reopened, /Download archived reviewed packet/)).toBe(original);
    expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await reopened.screenshot({path:`/private/tmp/catlas-history-${await reopened.evaluate(() => innerWidth)}.png`});
    await reopened.getByRole('button', { name: 'Reset demo data', exact: true }).click();
    await expect(reopened.getByRole('region', { name: 'Local history storage' })).toContainText('Saved locally');
    await expect(reopened.getByTestId('retained-evaluation')).toHaveCount(0);
    await expect(reopened.getByRole('region', { name: 'Retained packet history' })).toHaveCount(0);
    await expect(reopened.getByTestId('treaty-total')).toHaveCount(0);
    const raw = JSON.parse(await download(reopened, 'Export raw local history'));
    for (const table of ['evaluations', 'packets', 'deliveryAttempts', 'submissions', 'receiverRecords'])
        expect(raw[table]).toEqual([]);
    await reopened.reload();
    await expect(reopened.getByTestId('retained-evaluation')).toHaveCount(0);
    await choose(reopened, 'ridgecrest');
    await expect(reopened.getByTestId('treaty-total')).toHaveText('$6,000,000');
});
test('exception packet remains null and byte-identical after reload', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'incomplete');
    await page.getByRole('button', { name: 'Prepare exception packet', exact: true }).click();
    const original = await download(page, 'Download exception JSON');
    await page.reload();
    await expect(page.getByTestId('retained-evaluation')).toHaveCount(1);
    expect(await download(page, /Download archived exception packet/)).toBe(original);
    await page.getByRole('button', { name: /Resume evaluation/ }).click();
    await expect(page.getByTestId('treaty-total')).toHaveText('Indeterminate');
    await expect(page.getByRole('region', { name: 'Missing or unsupported inputs' })).toContainText('Contract inception:');
    expect(await download(page, 'Download exception JSON')).toBe(original);
});
test('incompatible history remains raw and requires explicit reset', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'ridgecrest');
    await page.getByRole('button', { name: 'Review evaluation v1', exact: true }).click();
    const packet = JSON.parse(await download(page, 'Download reviewed JSON'));
    await page.evaluate(async () => { const url = '/src/persistence/repository.ts'; const { demoRepository } = await import(url); await demoRepository.db.metadata.put({ key: 'format', schemaVersion: 99, ruleVersion: 'future-rule' }); });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Compatibility problem');
    await expect(page.getByRole('combobox', { name: 'Demonstration scenario', exact: true })).toBeDisabled();
    const raw = JSON.parse(await download(page, 'Export raw local history'));
    expect(raw.metadata[0].schemaVersion).toBe(99);
    expect(raw.packets[0].value).toEqual(packet);
    await page.getByRole('button', { name: 'Reset demo data', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Demonstration scenario', exact: true })).toBeEnabled();
    expect(JSON.parse(await download(page, 'Export raw local history')).packets).toEqual([]);
});
test('storage opening failure is visible and never claims successful retention', async ({ page }) => {
    await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Simulated storage denied', 'SecurityError'); }; });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Storage unavailable');
    await expect(page.getByRole('region', { name: 'Local history storage' })).toContainText('Simulated storage denied');
    await expect(page.getByRole('combobox', { name: 'Demonstration scenario', exact: true })).toBeDisabled();
    await expect(page.getByText('Saved locally in this browser · IndexedDB', { exact: true })).toHaveCount(0);
});
test('failed atomic save keeps previous retained content and displays error', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'ridgecrest');
    await page.evaluate(async () => { const url = '/src/persistence/repository.ts'; const { demoRepository } = await import(url); demoRepository.mutateLifecycle = async () => { throw new DOMException('Simulated quota exhausted', 'QuotaExceededError'); }; });
    await page.getByRole('button', { name: 'Review evaluation v1', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Storage unavailable');
    await expect(page.getByRole('region', { name: 'Local history storage' })).toContainText('Simulated quota exhausted');
    await expect(page.getByRole('button', { name: 'Download reviewed JSON', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByTestId('retained-evaluation')).toContainText('Unreviewed / no packet');
});

test('incomplete scheduled reference survives evaluation, exception export and reload',async({page})=>{
 await page.goto('/');await choose(page,'ridgecrest');
 await page.evaluate(async()=>{
  const repoUrl='/src/persistence/repository.ts',packetUrl='/src/domain/packets.ts',fixtureUrl='/src/data/fixtures.ts';
  const {demoRepository}=await import(repoUrl),{evaluate}=await import(packetUrl),{ridgecrest,mainContract}=await import(fixtureUrl);
  await demoRepository.mutateLifecycle((state:any)=>evaluate(state,ridgecrest,{...mainContract,id:'DEMO-MISSING-REFERENCE',areas:mainContract.areas.map((area:any,index:number)=>index?area:{...area,latitude:undefined})}),null);
 });
 await page.reload();
 const incomplete=page.getByTestId('retained-evaluation').filter({hasText:'DEMO-MISSING-REFERENCE'});
 await incomplete.getByRole('button').click();
 await expect(page.getByTestId('treaty-total')).toHaveText('Indeterminate');
 await expect(page.getByRole('region',{name:'Missing or unsupported inputs'})).toContainText('areas.0.latitude');
 await page.getByRole('button',{name:'Prepare exception packet',exact:true}).click();
 const bytes=await download(page,'Download exception JSON');
 expect(JSON.parse(bytes).aggregation.totalRecovery).toBeNull();
 await page.reload();
 expect(await download(page,/Download archived exception packet/)).toBe(bytes);
});
