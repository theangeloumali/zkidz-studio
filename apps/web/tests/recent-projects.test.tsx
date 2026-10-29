// Created by The Angelo Umali.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentProjects } from "../src/components/recent-projects.tsx";
import { LATEST_EDITS_PATH, makeEdit, makeOpenEdit } from "./edits/fixtures.ts";
import { PROJECT_ID, jsonResponse, makeProject } from "./fakes.ts";
import { renderWithProviders, stubFetch } from "./render.tsx";

const OTHER_PROJECT_ID = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

describe("RecentProjects", () => {
  it("shows each project's last finished edit totals, and none for an edit still open", async () => {
    stubFetch({
      "GET /api/projects": () =>
        jsonResponse({
          projects: [makeProject({ status: "delivered" }), makeProject({ id: OTHER_PROJECT_ID, slug: "harbor", title: "Harbor", status: "editing" })],
        }),
      [`GET ${LATEST_EDITS_PATH}`]: () => jsonResponse({ edits: [makeOpenEdit({ projectId: OTHER_PROJECT_ID }), makeEdit({ projectId: PROJECT_ID })] }),
    });
    renderWithProviders(<RecentProjects />);

    const delivered = await screen.findByRole("link", { name: /Beach day/ });
    expect(await within(delivered).findByText("Last edit · 14 min · ≈ $0.62 estimate · 210k tokens")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Harbor/ })).queryByText(/Last edit/)).toBeNull();
  });
});
