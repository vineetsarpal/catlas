import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { packetSchema } from "../../src/domain/packets";
async function downloaded(page: Page, buttonName: string) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await promise;
  const path = await download.path();
  return fs.readFile(path!, "utf8");
}
test("reviewed positive download is immutable under presentation changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("ridgecrest");
  await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Review notes", { exact: true })
    .fill("Checked both contributions.");
  await page
    .getByRole("button", { name: "Review evaluation v1", exact: true })
    .click();
  const content = await downloaded(page, "Download reviewed JSON"),
    packet = packetSchema.parse(JSON.parse(content));
  expect(packet.aggregation.totalRecovery).toBe(6000000);
  expect(packet.review?.notes).toBe("Checked both contributions.");
  await expect(page.getByLabel("Review notes", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Western $1,500,000", exact: true })
    .click();
  await page.getByRole("button", { name: "World", exact: true }).click();
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await page.getByLabel("Treaty trigger zones", { exact: true }).uncheck();
  await page.getByLabel("Synthetic locations", { exact: true }).uncheck();
  await page
    .getByLabel("Inspect synthetic location · 18 contextual sites")
    .selectOption("DEMO-LOC-03");
  expect(await downloaded(page, "Download reviewed JSON")).toBe(content);
  await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("outer");
  await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Session packet history" }),
  ).toContainText("DEMO-CA-PARAMETRIC");
});
test("real zero and exception JSON downloads preserve zero versus null", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("high-threshold");
  await expect(
    page.getByRole("button", { name: "Download reviewed JSON", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Review evaluation v1", exact: true })
    .click();
  const zero = packetSchema.parse(
    JSON.parse(await downloaded(page, "Download reviewed JSON")),
  );
  expect(zero.aggregation.totalRecovery).toBe(0);
  expect(zero.review).not.toBeNull();
  await page
    .getByRole("combobox", { name: "Demonstration scenario", exact: true })
    .selectOption("incomplete");
  await expect(page.getByLabel("Review notes", { exact: true })).toHaveCount(0);
  await page
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
