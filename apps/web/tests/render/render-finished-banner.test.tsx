// Created by The Angelo Umali.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RenderFinishedBanner } from "../../src/render/render-finished-banner.tsx";
import { PROJECT_EDITS_PATH, makeEdit, makeOpenEdit } from "../edits/fixtures.ts";
import { PROJECT_ID, jsonResponse } from "../fakes.ts";
import { renderWithProviders, stubFetch } from "../render.tsx";

function renderBanner() {
  return renderWithProviders(<RenderFinishedBanner projectId={PROJECT_ID} projectSlug="beach-day" fileCount={2} />);
}

describe("RenderFinishedBanner", () => {
  it("adds up what the finished edit took", async () => {
    stubFetch({ [`GET ${PROJECT_EDITS_PATH}`]: () => jsonResponse({ edits: [makeOpenEdit({ costUsd: 9 }), makeEdit()] }) });
    renderBanner();
    expect(await screen.findByText("This edit took 14 min · ≈ $0.62 estimate · 210k tokens.")).toBeInTheDocument();
  });

  it("says nothing about totals while no edit has finished", async () => {
    const fetchMock = stubFetch({ [`GET ${PROJECT_EDITS_PATH}`]: () => jsonResponse({ edits: [makeOpenEdit()] }) });
    renderBanner();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(/2 files in/)).toBeInTheDocument();
    expect(screen.queryByText(/This edit took/)).toBeNull();
  });
});
