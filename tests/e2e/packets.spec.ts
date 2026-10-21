import { openRecoveryAssessment, openRecoveryHistory, openRecoveryDetails, closeRecoveryPanels } from '../helpers/recovery-workspace';
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { packetSchema } from "../../frontend/src/domain/packets";
async function downloaded(page: Page, buttonName: string) {
  await openRecoveryDetails(page);
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await promise;
  const path = await download.path();
  return fs.readFile(path!, "utf8");
}
test("reviewed positive download is immutable under presentation changes", async ({
  page,
}) => {
  await page.goto("/?mode=recovery&recovery=parametric");
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toHaveCount(0);
  await openRecoveryAssessment(page); await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("ridgecrest");
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeDisabled();
  await openRecoveryDetails(page); await page
    .getByLabel("Review notes", { exact: true })
    .fill("Checked both contributions.");
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Review evaluation v1", exact: true })
    .click();
  const content = await downloaded(page, "Download reviewed JSON"),
    packet = packetSchema.parse(JSON.parse(content));
  expect(packet.aggregation.totalRecovery).toBe(6000000);
  expect(packet.review?.notes).toBe("Checked both contributions.");
  await openRecoveryDetails(page); await expect(page.getByLabel("Review notes", { exact: true })).toBeDisabled();
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Western $1,500,000", exact: true })
    .click();
  await closeRecoveryPanels(page); await page.getByText('Appearance',{exact:true}).click();
  await page.getByRole("switch", { name: "Globe view", exact: true }).check();
  await page.getByText('Layers',{exact:true}).click();
  await page.getByLabel("Treaty trigger zones", { exact: true }).uncheck();
  expect(await downloaded(page, "Download reviewed JSON")).toBe(content);
  await openRecoveryAssessment(page); await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("outer");
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeDisabled();
  await openRecoveryHistory(page); await expect(
    page.getByRole("region", { name: "Retained packet history" }),
  ).toContainText("DEMO-CA-PARAMETRIC");
});
test("real zero and exception JSON downloads preserve zero versus null", async ({
  page,
}) => {
  await page.goto("/?mode=recovery&recovery=parametric");
  await openRecoveryAssessment(page); await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("high-threshold");
  await openRecoveryDetails(page); await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeDisabled();
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Review evaluation v1", exact: true })
    .click();
  const zero = packetSchema.parse(
    JSON.parse(await downloaded(page, "Download reviewed JSON")),
  );
  expect(zero.aggregation.totalRecovery).toBe(0);
  expect(zero.review).not.toBeNull();
  await openRecoveryAssessment(page); await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("incomplete");
  await openRecoveryDetails(page); await expect(page.getByLabel("Review notes", { exact: true })).toHaveCount(0);
  await openRecoveryDetails(page); await page
    .getByRole("button", { name: "Prepare exception packet", exact: true })
    .click();
  const exception = packetSchema.parse(
    JSON.parse(await downloaded(page, "Download exception JSON")),
  );
  expect(exception.aggregation.totalRecovery).toBeNull();
  expect(exception.review).toBeNull();
  expect(exception.evaluation.assessment.exceptions).toHaveLength(2);
  expect(exception.evaluation.contract.inception).toBeNull();
});
