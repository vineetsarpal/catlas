import { openRecoveryAssessment, openRecoveryHistory, openRecoveryDetails } from '../helpers/recovery-workspace';
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
const panel = (page: Page) => page.getByRole('region', { name: 'Simulated RAS delivery', exact: true });
async function download(page: Page) { const pending = page.waitForEvent('download'); await openRecoveryDetails(page); await page.getByRole('button', { name: 'Download reviewed JSON', exact: true }).click(); return fs.readFile((await (await pending).path())!, 'utf8'); }
async function archive(page: Page) { return page.evaluate(async () => { const url = '/src/persistence/repository.ts'; return (await import(url)).demoRepository.exportArchive(); }); }
async function review(page: Page, version: number) { await openRecoveryDetails(page); await page.getByRole('button', { name: `Review evaluation v${version}`, exact: true }).click(); await openRecoveryDetails(page); await expect(page.getByRole('button', { name: 'Download reviewed JSON', exact: true })).toBeEnabled(); return download(page); }
async function send(page: Page) { await openRecoveryDetails(page); await panel(page).getByRole('combobox', { name: 'Simulated receiver outcome' }).selectOption('accept'); await openRecoveryDetails(page); await panel(page).getByRole('button', { name: 'Send reviewed packet', exact: true }).click(); await openRecoveryDetails(page); await expect(panel(page)).toContainText('Received by simulated RAS'); }
async function resume(page: Page, version: number) { await openRecoveryHistory(page); await page.getByTestId('retained-evaluation').filter({ hasText: `evaluation v${version}` }).getByRole('button', { name: /Resume evaluation/ }).click(); }
test('full $4m → $6m → zero linked replacements retain exact bytes and one receiving case offline', async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('/?mode=recovery&recovery=parametric');
    await openRecoveryAssessment(page); await page.getByRole('combobox', { name: 'Demonstration scenario', exact: true }).selectOption('sensitivity');
    await expect(page.getByTestId('treaty-total')).toHaveText('$4,000,000');
    const firstBytes = await review(page, 1), first = JSON.parse(firstBytes);
    await send(page);
    const reference = (await archive(page)).receiverRecords[0].reference;
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Apply captured M7.1 reference/ }).click();
    const secondBytes = await review(page, 2), second = JSON.parse(secondBytes);
    expect(second.replacement).toEqual({ purpose: 'Full replacement assessment', previousPacketId: first.packetId, previousEvaluationId: first.evaluation.id, previousEvaluationVersion: 1, priorRASReference: reference });
    expect(second.aggregation.totalRecovery).toBe(6000000);
    await send(page);
    let raw = await archive(page);
    expect(raw.receiverRecords).toHaveLength(1);
    expect(raw.receiverRecords[0].currentAmount).toBe(6000000);
    expect(raw.submissions.find((s: any) => s.packetId === second.packetId).payload).toBe(secondBytes);
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Import fictional RAS terms v3/ }).click();
    await expect(page.getByTestId('treaty-total')).toHaveText('$0');
    const zeroBytes = await review(page, 3), zero = JSON.parse(zeroBytes);
    expect(zero.replacement.previousPacketId).toBe(second.packetId);
    await send(page);
    raw = await archive(page);
    expect(raw.receiverRecords).toHaveLength(1);
    expect(raw.receiverRecords[0].currentAmount).toBe(0);
    expect(raw.receiverRecords[0].reference).toBe(reference);
    expect(raw.submissions.find((s: any) => s.packetId === zero.packetId).payload).toBe(zeroBytes);
    await resume(page, 1);
    await openRecoveryDetails(page); await panel(page).getByRole('button', { name: 'Retry same reviewed packet', exact: true }).click();
    await openRecoveryDetails(page); await expect(panel(page)).toContainText('Received by simulated RAS');
    expect((await archive(page)).receiverRecords[0].currentAmount).toBe(0);
    await page.reload();
    await expect(page.getByTestId('retained-evaluation')).toHaveCount(3);
    await resume(page, 2);
    expect(await download(page)).toBe(secondBytes);
    await resume(page, 3);
    expect(await download(page)).toBe(zeroBytes);
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Import incomplete fictional RAS terms v4/ }).click();
    await expect(page.getByTestId('treaty-total')).toHaveText('Indeterminate');
    await openRecoveryDetails(page); await page.getByRole('button', { name: 'Prepare exception packet', exact: true }).click();
    await openRecoveryDetails(page); await expect(panel(page).getByRole('button', { name: 'Send reviewed packet', exact: true })).toBeDisabled();
    expect((await archive(page)).receiverRecords[0].currentAmount).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('current revision reconciles earlier uncertainty before immutable replacement review', async ({ page }) => {
    await page.goto('/?mode=recovery&recovery=parametric');
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Start simulated M6.9 exercise/ }).click();
    await review(page, 1);
    await openRecoveryDetails(page); await panel(page).getByRole('combobox', { name: 'Simulated receiver outcome' }).selectOption('unconfirmed');
    await openRecoveryDetails(page); await panel(page).getByRole('button', { name: 'Send reviewed packet', exact: true }).click();
    await openRecoveryDetails(page); await expect(panel(page)).toContainText('Delivery unconfirmed');
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Apply captured M7.1 reference/ }).click();
    await openRecoveryDetails(page); await expect(page.getByRole('button', { name: 'Review evaluation v2', exact: true })).toBeDisabled();
    await openRecoveryDetails(page); await expect(page.getByRole('region', { name: 'Replacement review context' })).toContainText('Reconcile prior unconfirmed');
    await openRecoveryDetails(page); await page.getByRole('button', { name: 'Reconcile prior delivery status', exact: true }).click();
    await openRecoveryDetails(page); await expect(page.getByRole('button', { name: 'Review evaluation v2', exact: true })).toBeEnabled();
    const replacement = JSON.parse(await review(page, 2));
    expect(replacement.replacement.priorRASReference).toMatch(/^MOCK-RAS-/);
    await send(page);
    const raw = await archive(page);
    expect(raw.receiverRecords).toHaveLength(1);
    expect(raw.receiverRecords[0].currentAmount).toBe(6000000);
    expect(raw.deliveryAttempts.map((a: any) => a.action)).toContain('check');
});
test('already frozen initial revision requires a fresh version after earlier delivery', async ({ page }) => {
    await page.goto('/?mode=recovery&recovery=parametric');
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Start simulated M6.9 exercise/ }).click();
    await review(page, 1);
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Apply captured M7.1 reference/ }).click();
    const frozenBytes = await review(page, 2);
    expect(JSON.parse(frozenBytes).replacement).toBeUndefined();
    await resume(page, 1);
    await send(page);
    await resume(page, 2);
    await openRecoveryDetails(page); await expect(panel(page).getByRole('button', { name: 'Send reviewed packet', exact: true })).toBeDisabled();
    await openRecoveryDetails(page); await expect(panel(page)).toContainText('fresh evaluation');
    expect(await download(page)).toBe(frozenBytes);
    await openRecoveryDetails(page); await page.getByRole('button', { name: 'Create fresh evaluation for replacement review', exact: true }).click();
    await openRecoveryDetails(page); await expect(page.getByRole('button', { name: 'Review evaluation v3', exact: true })).toBeEnabled();
    const fresh = JSON.parse(await review(page, 3));
    expect(fresh.replacement.previousEvaluationVersion).toBe(1);
    await send(page);
    expect((await archive(page)).receiverRecords).toHaveLength(1);
});
test('receiver rejects stale racing replacement base without changing the accepted full amount', async ({ page }) => {
    await page.goto('/?mode=recovery&recovery=parametric');
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Start simulated M6.9 exercise/ }).click();
    await review(page, 1);
    await send(page);
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Apply captured M7.1 reference/ }).click();
    const second = JSON.parse(await review(page, 2));
    await openRecoveryAssessment(page); await page.getByRole('button', { name: /Import fictional RAS terms v3/ }).click();
    const zero = JSON.parse(await review(page, 3));
    expect(zero.replacement.previousEvaluationVersion).toBe(1);
    await resume(page, 2);
    await send(page);
    await resume(page, 3);
    await openRecoveryDetails(page); await expect(panel(page)).toContainText('stale');
    await openRecoveryDetails(page); await expect(panel(page).getByRole('button', { name: 'Send reviewed packet', exact: true })).toBeDisabled();
    // Service checks the current receiver under its own transaction, even if a stale
    // UI caller submits before observing the new operational state.
    const outcome = await page.evaluate(async (packet: any) => { const repo = '/src/persistence/repository.ts', service = '/src/delivery/service.ts'; return (await import(service)).submitPacket((await import(repo)).demoRepository, packet, 'accept'); }, zero);
    expect(outcome.state).toBe('rejected');
    expect(outcome.reason).toContain('stale');
    const raw = await archive(page);
    expect(raw.receiverRecords[0].currentAmount).toBe(6000000);
    expect(raw.receiverRecords[0].currentPacketId).toBe(second.packetId);
});
