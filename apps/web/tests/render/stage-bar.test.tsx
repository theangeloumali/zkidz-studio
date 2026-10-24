// Created by The Angelo Umali.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stageRowsFor } from "../../src/render/job-display.ts";
import { StageBar } from "../../src/render/stage-bar.tsx";
import { makeJob } from "./fixtures.ts";

function renderEncodeStage(etaS: number | null) {
  const encode = stageRowsFor(makeJob({ stage: "master", pct: 30, etaS }))[3];
  if (encode === undefined) throw new Error("no Encode row");
  render(<StageBar stage={encode} />);
}

describe("StageBar", () => {
  it("shows the stage label, its percent and the ETA, and names the bar with the ETA", () => {
    renderEncodeStage(40);

    const bar = screen.getByRole("progressbar", { name: "Encode, about 40 s left" });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByText("Encode")).toBeInTheDocument();
    expect(screen.getByText("about 40 s left")).toBeInTheDocument();
  });

  it("shows no ETA when the engine has none", () => {
    renderEncodeStage(null);

    expect(screen.getByRole("progressbar", { name: "Encode" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
  });
});
