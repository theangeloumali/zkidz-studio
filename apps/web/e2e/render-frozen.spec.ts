// Created by The Angelo Umali.
import { deliveredFileNames, editAndApprove, readQcReport, RENDER_TIMEOUT_MS } from "./support/render-steps.ts";
import { expect, test } from "./support/studio-fixture.ts";

// Its own file: a worker option forces a new worker, which Playwright allows only at the top level.
test.use({ frozenMaster: true });

test("a master whose footage froze fails the motion gate, so the approved export is refused and nothing is delivered", async ({ page, studio }) => {
  test.setTimeout(RENDER_TIMEOUT_MS * 2);

  const projectId = await editAndApprove(page);
  const exportRow = page.getByRole("list", { name: "Agent activity" }).getByRole("listitem").filter({ hasText: "export deliverable" });
  await expect(exportRow.filter({ hasText: "failed QC" })).toBeVisible({ timeout: RENDER_TIMEOUT_MS });

  const qcReport = await readQcReport(studio, projectId);
  expect(qcReport.ok).toBe(false);
  expect(qcReport.checks.find((check) => check.name === "motion")?.ok).toBe(false);

  await page.goto(`/p/${projectId}/render`);
  const deliverables = page.getByRole("region", { name: "Deliverables" });
  await expect(deliverables.getByText("No files yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Checks" }).getByRole("listitem").filter({ hasText: "Moving footage" })).toContainText("failed");
  await expect(deliverables.getByRole("listitem")).toHaveCount(0);
  expect(await deliveredFileNames(studio, projectId)).toEqual([]);
});
