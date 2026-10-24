// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectConsoleErrors,
  deliverablesDir,
  deliveredFileNames,
  editAndApprove,
  openRenderFromNav,
  readQcReport,
  RENDER_TIMEOUT_MS,
} from "./support/render-steps.ts";
import { expect, test } from "./support/studio-fixture.ts";

const DELIVERED_KINDS = 3;

async function sha256Of(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

test("a dropped clip is cut, approved, rendered, QC'd and delivered with matching SHA-256s", async ({ page, studio }) => {
  test.setTimeout(RENDER_TIMEOUT_MS * 2);

  const consoleErrors = collectConsoleErrors(page);
  const projectId = await editAndApprove(page);
  await openRenderFromNav(page);
  const deliverableRows = page.getByRole("region", { name: "Deliverables" }).getByRole("listitem");
  await expect(deliverableRows).toHaveCount(DELIVERED_KINDS, { timeout: RENDER_TIMEOUT_MS });

  const qcReport = await readQcReport(studio, projectId);
  expect(qcReport.checks.filter((check) => !check.ok)).toEqual([]);
  expect(qcReport.ok).toBe(true);
  // The panel must read the engine's report, not just the file existing: every gate shows passed, none still waiting.
  const checkRows = page.getByRole("region", { name: "Checks" }).getByRole("listitem");
  await expect(checkRows.filter({ hasText: "Moving footage" })).toContainText("passed");
  await expect(checkRows.filter({ hasText: "waiting" })).toHaveCount(0);

  const deliveredDir = await deliverablesDir(studio, projectId);
  const deliveredFiles = await deliveredFileNames(studio, projectId);
  expect(deliveredFiles).toHaveLength(DELIVERED_KINDS);
  for (const fileName of deliveredFiles) {
    const row = deliverableRows.filter({ hasText: fileName });
    await expect(row.locator("span[title]")).toHaveAttribute("title", await sha256Of(join(deliveredDir, fileName)));
  }
  expect(consoleErrors).toEqual([]);
});
