import { openRecoveryAssessment, openRecoveryHistory, openRecoveryDetails } from '../helpers/recovery-workspace';
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function select(page: Page, id = "ridgecrest") {
  await openRecoveryAssessment(page); await expect(
    page.getByRole("combobox", { name: "Demonstration scenario", exact: true }),
  ).toBeEnabled();
  await openRecoveryAssessment(page); await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption(id);
  await openRecoveryHistory(page); await expect(
    page.getByRole("region", { name: "Local history storage" }),
  ).toContainText("Saved locally");
}
async function review(page: Page) {
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Review evaluation v1", exact: true })
    .click();
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeEnabled();
}
async function downloaded(page: Page) {
  const waiting = page.waitForEvent("download");
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Download reviewed JSON", exact: true })
    .click();
  const d = await waiting;
  return fs.readFile((await d.path())!, "utf8");
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const url = "/src/persistence/repository.ts";
    const { demoRepository } = await import(url);
    return demoRepository.exportArchive();
  });
}
test("offline send/retry preserves downloaded bytes and one durable receiver record", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/?mode=recovery&recovery=parametric");
  await select(page);
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Send reviewed packet", exact: true }),
  ).toBeDisabled();
  await review(page);
  const bytes = await downloaded(page);
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "0 simulated receiving records",
  );
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Send reviewed packet", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Simulated RAS delivery",
    exact: true,
  });
  await openRecoveryDetails(page); await expect(panel).toContainText("Received by simulated RAS · MOCK-RAS-");
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Retry same reviewed packet", exact: true })
    .click();
  await openRecoveryHistory(page); await expect(page.getByTestId("delivery-attempt")).toHaveCount(2);
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "1 simulated receiving record",
  );
  const archive = await records(page);
  expect(archive.submissions).toHaveLength(1);
  expect(archive.submissions[0].payload).toBe(bytes);
  expect(archive.receiverRecords[0].currentPayload).toBe(bytes);
  expect(archive.deliveryAttempts[0].submissionId).toBe(
    archive.deliveryAttempts[1].submissionId,
  );
  expect(archive.deliveryAttempts[0].reference).toBe(
    archive.deliveryAttempts[1].reference,
  );
  expect(await downloaded(page)).toBe(bytes);
  await page.reload();
  await openRecoveryHistory(page); await expect(page.getByTestId("delivery-attempt")).toHaveCount(2);
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "1 simulated receiving record",
  );
  await select(page);
  await openRecoveryDetails(page); await expect(panel).toContainText("Received by simulated RAS");
});
test("rejection gives reason; retry accepts once; initial zero/incomplete stay blocked", async ({
  page,
}) => {
  await page.goto("/?mode=recovery&recovery=parametric");
  await select(page);
  await review(page);
  await openRecoveryDetails(page); await page
    .getByLabel("Simulated receiver outcome", { exact: true })
    .selectOption("reject");
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Send reviewed packet", exact: true })
    .click();
  await openRecoveryDetails(page); await expect(
    page.getByRole("region", { name: "Simulated RAS delivery", exact: true }),
  ).toContainText("Rejected by simulated RAS");
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "0 simulated receiving records",
  );
  await openRecoveryDetails(page); await page
    .getByLabel("Simulated receiver outcome", { exact: true })
    .selectOption("accept");
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Retry same reviewed packet", exact: true })
    .click();
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "1 simulated receiving record",
  );
  await openRecoveryHistory(page); await expect(page.getByTestId("delivery-attempt")).toHaveCount(2);
  await select(page, "high-threshold");
  await review(page);
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Send reviewed packet", exact: true }),
  ).toBeDisabled();
  await select(page, "incomplete");
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Prepare exception packet", exact: true })
    .click();
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Send reviewed packet", exact: true }),
  ).toBeDisabled();
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "1 simulated receiving record",
  );
});
test("incompatible operational rows are preserved and block send until explicit reset", async ({
  page,
}) => {
  await page.goto("/?mode=recovery&recovery=parametric");
  await select(page);
  await review(page);
  await page.evaluate(async () => {
    const url = "/src/persistence/repository.ts";
    const { demoRepository } = await import(url);
    await demoRepository.deliveryTransaction(async ({ submissions }: any) =>
      submissions.add({ id: "future-submission", schemaVersion: 99 }),
    );
  });
  const history = page.getByRole("region", {
    name: "Simulated RAS delivery history",
    exact: true,
  });
  await openRecoveryHistory(page); await expect(history).toContainText("incompatible");
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Send reviewed packet", exact: true }),
  ).toBeDisabled();
  expect((await records(page)).submissions[0].id).toBe("future-submission");
  await openRecoveryHistory(page); await page
    .getByRole("button", { name: "Reset demo data", exact: true })
    .click();
  await openRecoveryHistory(page); await expect(page.getByTestId("receiver-count")).toHaveText(
    "0 simulated receiving records",
  );
});
test("atomic concurrent sends deduplicate and altered retained content cannot reuse identity", async ({
  page,
}) => {
  await page.goto("/?mode=recovery&recovery=parametric");
  await select(page);
  await review(page);
  const result = await page.evaluate(async () => {
    const repo = "/src/persistence/repository.ts",
      service = "/src/delivery/service.ts";
    const { demoRepository } = await import(repo);
    const { submitPacket } = await import(service);
    const archive = await demoRepository.exportArchive();
    const packet = archive.packets[0].value;
    await Promise.all([
      submitPacket(demoRepository, packet),
      submitPacket(demoRepository, packet),
    ]);
    const before = await demoRepository.exportArchive();
    const altered = structuredClone(packet);
    altered.review.notes = "changed content";
    let failure = "";
    try {
      await submitPacket(demoRepository, altered);
    } catch (error) {
      failure = String(error);
    }
    return { before, after: await demoRepository.exportArchive(), failure };
  });
  expect(result.before.receiverRecords).toHaveLength(1);
  expect(result.before.deliveryAttempts).toHaveLength(2);
  expect(result.after).toEqual(result.before);
  expect(result.failure).toContain("exact retained reviewed packet");
});
