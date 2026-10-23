// Created by The Angelo Umali.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRoute } from "../src/routes/home.tsx";
import { FakeUploadRequest, PROJECT_ID, jsonResponse, makeAsset, makeProject } from "./fakes.ts";
import { renderWithProviders, stubFetch } from "./render.tsx";

const PROJECTS_KEY = "GET /api/projects";

describe("Home", () => {
  beforeEach(() => {
    FakeUploadRequest.instances.length = 0;
  });

  it("lists recent projects with a text status", async () => {
    stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [makeProject({ status: "rendering" })] }) });
    renderWithProviders(<HomeRoute />);

    const link = await screen.findByRole("link", { name: /Beach day/ });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}`);
    expect(within(link).getByText("Rendering")).toBeInTheDocument();
  });

  it("shows the empty state when there are no projects", async () => {
    stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [] }) });
    renderWithProviders(<HomeRoute />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("shows a loading state, then an error with a working retry", async () => {
    let attempt = 0;
    stubFetch({
      [PROJECTS_KEY]: () => {
        attempt += 1;
        return attempt === 1 ? jsonResponse({ error: "Database is starting" }, 503) : jsonResponse({ projects: [makeProject()] });
      },
    });
    renderWithProviders(<HomeRoute />);

    expect(screen.getByRole("status", { name: "Loading projects" })).toBeInTheDocument();
    expect(await screen.findByText("Database is starting")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Beach day/ })).toBeInTheDocument();
  });

  it("creates a project from a drop and shows each file's upload progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const fetchMock = stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      "POST /api/projects": () => jsonResponse(makeProject({ title: "beach" }), 201),
    });
    renderWithProviders(<HomeRoute />);

    const files = [new File(["a"], "beach.mp4"), new File(["b"], "pier.mov")];
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files, types: ["Files"] } });

    await waitFor(() => expect(FakeUploadRequest.instances).toHaveLength(1));
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(createCall?.[1]?.body).toBe(JSON.stringify({ title: "beach" }));

    const first = screen.getByRole("progressbar", { name: "Uploading beach.mp4" });
    expect(screen.getByRole("progressbar", { name: "Uploading pier.mov" })).toHaveAttribute("aria-valuenow", "0");

    act(() => FakeUploadRequest.instances[0]?.progress(50, 100));
    expect(first).toHaveAttribute("aria-valuenow", "50");

    act(() => FakeUploadRequest.instances[0]?.respond(201, makeAsset({ name: "beach.mp4" })));
    await waitFor(() => expect(FakeUploadRequest.instances).toHaveLength(2));
    act(() => FakeUploadRequest.instances[1]?.respond(201, makeAsset({ name: "pier.mov" })));

    expect(await screen.findByText("2 files added to the project.")).toBeInTheDocument();
  });

  it("marks a failed upload with its reason", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      "POST /api/projects": () => jsonResponse(makeProject(), 201),
    });
    renderWithProviders(<HomeRoute />);

    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [new File(["a"], "notes.txt")], types: ["Files"] } });
    await waitFor(() => expect(FakeUploadRequest.instances).toHaveLength(1));
    act(() => FakeUploadRequest.instances[0]?.respond(415, { error: "Not a video file" }));

    expect(await screen.findByText("Not a video file")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [makeProject(), makeProject({ id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", title: "Pier" })] }),
    });
    const { container } = renderWithProviders(<HomeRoute />);
    await screen.findByRole("link", { name: /Pier/ });

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
