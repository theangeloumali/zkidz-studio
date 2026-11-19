// Created by The Angelo Umali.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROJECT_STATUSES, type Stats } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { StatsRoute } from "../../src/stats/stats-route.tsx";
import { jsonResponse } from "../fakes.ts";
import { renderWithProviders, stubFetch } from "../render.tsx";

function makeStats(overrides: Partial<Stats> = {}): Stats {
  return {
    range: "30d",
    hasAnyEdit: true,
    projectsByStatus: PROJECT_STATUSES.map((status) => ({ status, count: status === "delivered" ? 3 : status === "draft" ? 1 : 0 })),
    jobsByWeek: [
      { week: "2026-W46", kind: "render_master", outcome: "succeeded", count: 2 },
      { week: "2026-W47", kind: "render_master", outcome: "failed", count: 1 },
    ],
    medianRunS: 45,
    medianQueueWaitS: 5,
    recentJobs: [
      {
        jobId: "5c1d7e2a-3b4f-4a6c-8d9e-0f1a2b3c4d5e",
        projectTitle: "Beach day",
        kind: "render_master",
        outcome: "failed",
        runS: 12,
        error: "ffmpeg exited with code 1",
        finishedAt: "2026-11-18T10:00:00.000Z",
      },
      {
        jobId: "6d2e8f3b-4c5a-4b7d-9e0f-1a2b3c4d5e6f",
        projectTitle: "Market walk",
        kind: "render_master",
        outcome: "succeeded",
        runS: 39.5,
        error: null,
        finishedAt: "2026-11-17T16:12:00.000Z",
      },
    ],
    edits: [{ id: "7e2f9a1b-4c5d-4e6f-9a0b-1c2d3e4f5a6b", projectTitle: "Beach day", startedAt: "2026-11-18T09:00:00.000Z", turns: 9, tokens: 1250 }],
    footage: { keptS: 50, sourceS: 200 },
    deliverablesByWeek: [{ week: "2026-W47", count: 4 }],
    ...overrides,
  };
}

describe("StatsRoute", () => {
  it("shows the empty state until the first edit", async () => {
    stubFetch({ "GET /api/stats?range=30d": () => jsonResponse(makeStats({ hasAnyEdit: false, edits: [], recentJobs: [], jobsByWeek: [] })) });
    renderWithProviders(<StatsRoute />);

    expect(await screen.findByText("No edits yet.")).toBeInTheDocument();
    expect(screen.getByText("Stats fill in as you edit.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open a project" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("group", { name: "Range" })).not.toBeInTheDocument();
  });

  it("shows the ledger, project states, renders and per-edit use, without a dollar figure", async () => {
    stubFetch({ "GET /api/stats?range=30d": () => jsonResponse(makeStats()) });
    renderWithProviders(<StatsRoute />);

    const ledger = await screen.findByRole("list", { name: "Summary" });
    expect(within(ledger).getByText("3")).toBeInTheDocument();
    expect(within(ledger).getByText("0:45")).toBeInTheDocument();
    expect(within(ledger).getByText("33%")).toBeInTheDocument();
    expect(within(ledger).getByText("25%")).toBeInTheDocument();

    expect(screen.getByRole("listitem", { name: "Delivered: 3" })).toBeInTheDocument();
    const renders = screen.getByRole("list", { name: "Renders" });
    const [failedJob, finishedJob] = within(renders).getAllByRole("listitem");
    if (failedJob === undefined || finishedJob === undefined) throw new Error("no render rows");
    expect(within(failedJob).getByText("Failed")).toBeInTheDocument();
    expect(within(failedJob).getByText("render master · ffmpeg exited with code 1")).toBeInTheDocument();
    expect(within(finishedJob).getByText("Finished")).toBeInTheDocument();
    expect(within(finishedJob).getByText("render master · 0:40 to run")).toBeInTheDocument();

    const row = within(screen.getByRole("table", { name: "Claude use per edit" })).getAllByRole("row")[1];
    if (row === undefined) throw new Error("no edit row");
    expect(within(row).getByText("Beach day")).toBeInTheDocument();
    expect(within(row).getByText("9")).toBeInTheDocument();
    expect(within(row).getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("Max plan: token counts only. Studio never shows a dollar figure.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("loads the range the user presses", async () => {
    const fetchMock = stubFetch({
      "GET /api/stats?range=30d": () => jsonResponse(makeStats()),
      "GET /api/stats?range=7d": () => jsonResponse(makeStats({ range: "7d" })),
    });
    renderWithProviders(<StatsRoute />);
    const sevenDays = await screen.findByRole("button", { name: "7 days" });

    await userEvent.click(sevenDays);

    expect(sevenDays).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).toHaveBeenCalledWith("/api/stats?range=7d", expect.anything());
  });
});
