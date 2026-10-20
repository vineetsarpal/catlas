import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function choose(page: Page) {
  await expect(
    page.getByRole("combobox", { name: "Demonstration scenario", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("ridgecrest");
  await expect(
    page.getByRole("region", { name: "Local history storage" }),
  ).toContainText("Saved locally");
}
async function prepare(page: Page) {
  await page.goto("/?mode=recovery");
  await choose(page);
  await page
    .getByRole("button", { name: "Review evaluation v1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeEnabled();
}
async function rows(page: Page) {
  return page.evaluate(async () => {
    const url = "/src/persistence/repository.ts";
    const { demoRepository } = await import(url);
    return demoRepository.exportArchive();
  });
}
async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download reviewed JSON", exact: true })
    .click();
  return fs.readFile((await (await pending).path())!, "utf8");
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Simulated RAS delivery", exact: true });
async function loseAck(page: Page) {
  await page
    .getByLabel("Simulated receiver outcome", { exact: true })
    .selectOption("unconfirmed");
  await page
    .getByRole("button", { name: "Send reviewed packet", exact: true })
    .click();
  await expect(panel(page)).toContainText("Delivery unconfirmed");
  await expect(panel(page)).not.toContainText("MOCK-RAS-");
  await expect(page.getByTestId("receiver-count")).toHaveText(
    "1 simulated receiving record",
  );
}
test("lost acknowledgement survives refresh and repeated checks reconcile original identity without changing packet bytes", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await prepare(page);
  const bytes = await download(page);
  await loseAck(page);
  const before = await rows(page);
  expect(before.submissions[0].reference).toBeNull();
  expect(before.deliveryAttempts[0].reference).toBeNull();
  expect(before.submissions[0].payload).toBe(bytes);
  await page.reload();
  await expect(page.getByTestId("delivery-attempt")).toHaveCount(1);
  await expect(page.getByTestId("delivery-attempt")).toContainText(
    "Delivery unconfirmed",
  );
  await choose(page);
  await expect(panel(page)).toContainText("Delivery unconfirmed");
  await expect(panel(page)).not.toContainText("MOCK-RAS-");
  await page
    .getByRole("button", { name: "Check delivery status", exact: true })
    .click();
  await expect(panel(page)).toContainText(
    `Received by simulated RAS · ${before.receiverRecords[0].reference}`,
  );
  await expect(page.getByTestId("delivery-attempt")).toHaveCount(2);
  await page.evaluate(async () => {
    const repo = "/src/persistence/repository.ts",
      service = "/src/delivery/service.ts";
    const { demoRepository } = await import(repo);
    const { checkPacketStatus } = await import(service);
    const archive = await demoRepository.exportArchive();
    await checkPacketStatus(demoRepository, archive.packets[0].value);
  });
  await expect(page.getByTestId("delivery-attempt")).toHaveCount(3);
  const after = await rows(page);
  expect(after.receiverRecords).toEqual(before.receiverRecords);
  expect(after.submissions[0].id).toBe(before.submissions[0].id);
  expect(after.submissions[0].reference).toBe(
    before.receiverRecords[0].reference,
  );
  expect(
    after.deliveryAttempts
      .sort((a: any, b: any) => a.attemptedAt.localeCompare(b.attemptedAt))
      .map((a: any) => a.action),
  ).toEqual(["send", "check", "check"]);
  expect(await download(page)).toBe(bytes);
});
test("repeated lost acknowledgements and successful retry produce one receiving record", async ({
  page,
}) => {
  await prepare(page);
  await loseAck(page);
  const first = await rows(page);
  await page
    .getByRole("button", { name: "Retry same reviewed packet", exact: true })
    .click();
  await expect(page.getByTestId("delivery-attempt")).toHaveCount(2);
  await expect(panel(page)).toContainText("Delivery unconfirmed");
  await expect(panel(page)).not.toContainText("MOCK-RAS-");
  await page
    .getByLabel("Simulated receiver outcome", { exact: true })
    .selectOption("accept");
  await page
    .getByRole("button", { name: "Retry same reviewed packet", exact: true })
    .click();
  await expect(panel(page)).toContainText(
    `Received by simulated RAS · ${first.receiverRecords[0].reference}`,
  );
  await expect(page.getByTestId("delivery-attempt")).toHaveCount(3);
  await expect(page.getByTestId("receiver-count")).toHaveText(
    "1 simulated receiving record",
  );
  const after = await rows(page);
  expect(after.submissions).toHaveLength(1);
  expect(after.submissions[0].payload).toBe(first.submissions[0].payload);
  expect(after.deliveryAttempts.map((a: any) => a.submissionId)).toEqual([
    first.submissions[0].id,
    first.submissions[0].id,
    first.submissions[0].id,
  ]);
});
test("unknown receiver status remains unconfirmed and changed content cannot reuse the original identity", async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const repo = "/src/persistence/repository.ts",
      service = "/src/delivery/service.ts";
    const { demoRepository } = await import(repo);
    const { checkPacketStatus } = await import(service);
    const archive = await demoRepository.exportArchive();
    const packet = archive.packets[0].value;
    await checkPacketStatus(demoRepository, packet);
    const changed = structuredClone(packet);
    changed.review.notes = "changed";
    let failure = "";
    try {
      await checkPacketStatus(demoRepository, changed);
    } catch (error) {
      failure = String(error);
    }
    return { archive: await demoRepository.exportArchive(), failure };
  });
  expect(result.failure).toContain("exact retained reviewed packet");
  expect(result.archive.submissions[0].state).toBe("unconfirmed");
  expect(result.archive.receiverRecords).toHaveLength(0);
  await expect(panel(page)).toContainText("Delivery unconfirmed");
  await page
    .getByRole("button", { name: "Check delivery status", exact: true })
    .click();
  await expect(page.getByTestId("delivery-attempt")).toHaveCount(2);
  await expect(page.getByTestId("receiver-count")).toHaveText(
    "0 simulated receiving records",
  );
  await expect(panel(page)).toContainText("Delivery unconfirmed");
  await expect(panel(page)).not.toContainText("Rejected by simulated RAS");
});
