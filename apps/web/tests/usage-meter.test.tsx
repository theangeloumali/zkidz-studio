// Created by The Angelo Umali.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { UsageMeter } from "../src/agent/usage-meter.tsx";
import { summarizeSession } from "../src/agent/feed-items.ts";
import { COST_DISCLAIMER } from "../src/copy/claude.ts";
import { makeOpenEdit } from "./edits/fixtures.ts";

const NO_TURNS = summarizeSession([]);

describe("UsageMeter", () => {
  it("shows the open edit's time, estimate and tokens", () => {
    render(<UsageMeter summary={NO_TURNS} mode="api_key" openEdit={makeOpenEdit()} />);
    const usage = screen.getByRole("group", { name: "Usage" });
    expect(within(usage).getByText("This edit · 14 min · ≈ $0.62 estimate · 210k tokens")).toBeInTheDocument();
  });

  it("shows time and tokens only when no cost was reported", () => {
    render(<UsageMeter summary={NO_TURNS} mode="terminal" openEdit={makeOpenEdit({ costUsd: null })} />);
    expect(screen.getByText("This edit · 14 min · 210k tokens")).toBeInTheDocument();
  });

  it("explains the estimate on focus, adding the plan note only when the user signed in with a plan", async () => {
    const { unmount } = render(<UsageMeter summary={NO_TURNS} mode="terminal" openEdit={makeOpenEdit()} />);
    await userEvent.tab();
    expect(await screen.findByText(`${COST_DISCLAIMER} What you pay depends on your plan.`)).toBeInTheDocument();
    unmount();

    render(<UsageMeter summary={NO_TURNS} mode="api_key" openEdit={makeOpenEdit()} />);
    await userEvent.tab();
    expect(await screen.findByText(COST_DISCLAIMER)).toBeInTheDocument();
  });

  it("draws nothing before an edit or a turn has reported anything", () => {
    const { container } = render(<UsageMeter summary={NO_TURNS} mode="api_key" openEdit={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations", async () => {
    const { container } = render(<UsageMeter summary={NO_TURNS} mode="terminal" openEdit={makeOpenEdit()} />);
    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
