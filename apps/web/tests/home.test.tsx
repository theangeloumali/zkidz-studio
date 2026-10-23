// Created by The Angelo Umali.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES, PROJECT_TITLE_HEADER } from "@zks/shared";
import { HomeRoute } from "../src/routes/home.tsx";
import { FakeUploadRequest, PROJECT_ID, jsonResponse, makeAsset, makeProject } from "./fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "./render.tsx";

const PROJECTS_KEY = "GET /api/projects";
const CREATE_WITH_MEDIA_PATH = API_ROUTES.createProjectWithMedia.path;
const IN_PLACE_KEY = `POST ${API_ROUTES.createProjectInPlace.path}`;
const LISTING_KEY = `GET ${API_ROUTES.listFolder.path}`;
const CLIP_PATH = "/media/raw/harbor.mp4";

function dropFiles(files: readonly File[]): void {
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files, types: ["Files"] } });
}

/** Uploads open after an async CSRF read, so wait for the request to exist. */
function nthUpload(index: number): Promise<FakeUploadRequest> {
  return vi.waitFor(() => {
    const request = FakeUploadRequest.instances[index];
    if (!request) throw new Error(`upload ${index} has not started`);
    return request;
  });
}

async function pickInPlace(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Use a file in place" }));
  await userEvent.click(await screen.findByRole("button", { name: /harbor\.mp4/ }));
}

function listingResponse(): Response {
  return jsonResponse({ path: "/media/raw", entries: [{ name: "harbor.mp4", isDirectory: false, bytes: 2048 }] });
}

function projectCreates(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([url, init]) => url === "/api/projects" && init?.method === "POST");
}

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

  it("creates the project with the first file's upload and shows each file's progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const fetchMock = stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [] }) });
    renderWithProviders(<HomeRoute />);

    dropFiles([new File(["a"], "beach.mp4"), new File(["b"], "pier.mov")]);

    const first = await nthUpload(0);
    expect(first.url).toBe(CREATE_WITH_MEDIA_PATH);
    expect(first.headers.get(PROJECT_TITLE_HEADER)).toBe("beach");
    expect(screen.getByRole("progressbar", { name: "Uploading pier.mov" })).toHaveAttribute("aria-valuenow", "0");

    act(() => first.progress(50, 100));
    expect(screen.getByRole("progressbar", { name: "Uploading beach.mp4" })).toHaveAttribute("aria-valuenow", "50");

    act(() => first.respond(201, { project: makeProject({ title: "beach" }), asset: makeAsset({ name: "beach.mp4" }) }));
    const second = await nthUpload(1);
    expect(second.url).toBe(`/api/projects/${PROJECT_ID}/media`);
    act(() => second.respond(201, makeAsset({ name: "pier.mov" })));

    expect(await screen.findByText("2 files added to the project.")).toBeInTheDocument();
    expect(projectCreates(fetchMock)).toHaveLength(0);
  });

  it("creates no project when every dropped file is rejected", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const fetchMock = stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [] }) });
    renderWithProviders(<HomeRoute />);

    dropFiles([new File(["#EXTM3U"], "playlist.mp4"), new File(["a"], "notes.txt")]);
    await nthUpload(0);
    act(() => FakeUploadRequest.instances[0]?.respond(415, { error: "Not a video file" }));
    const second = await nthUpload(1);
    expect(second.url).toBe(CREATE_WITH_MEDIA_PATH);
    act(() => second.respond(415, { error: "Not a playable video" }));

    expect(await screen.findByText("Not a playable video")).toBeInTheDocument();
    expect(screen.getByText("Not a video file")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose files" })).toBeEnabled());
    expect(screen.queryByText(/added to the project/)).not.toBeInTheDocument();
    expect(FakeUploadRequest.instances).toHaveLength(2);
    expect(projectCreates(fetchMock)).toHaveLength(0);
  });

  it("keeps the project when a later file in a mixed drop is rejected", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [] }) });
    renderWithProviders(<HomeRoute />);

    dropFiles([new File(["a"], "beach.mp4"), new File(["#EXTM3U"], "playlist.mp4")]);
    await nthUpload(0);
    act(() => FakeUploadRequest.instances[0]?.respond(201, { project: makeProject({ title: "beach" }), asset: makeAsset() }));
    const second = await nthUpload(1);
    expect(second.url).toBe(`/api/projects/${PROJECT_ID}/media`);
    act(() => second.respond(415, { error: "Not a video file" }));

    expect(await screen.findByText("1 file added to the project.")).toBeInTheDocument();
    expect(screen.getByText("Not a video file")).toBeInTheDocument();
    expect(FakeUploadRequest.instances.filter((request) => request.url === CREATE_WITH_MEDIA_PATH)).toHaveLength(1);
  });

  it("creates the project from the first accepted file when an earlier one is rejected", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [] }) });
    renderWithProviders(<HomeRoute />);

    dropFiles([new File(["#EXTM3U"], "playlist.mp4"), new File(["a"], "pier.mov")]);
    await nthUpload(0);
    act(() => FakeUploadRequest.instances[0]?.respond(415, { error: "Not a video file" }));
    const second = await nthUpload(1);
    expect(second.url).toBe(CREATE_WITH_MEDIA_PATH);
    expect(second.headers.get(PROJECT_TITLE_HEADER)).toBe("pier");
    act(() => second.respond(201, { project: makeProject({ title: "pier" }), asset: makeAsset({ name: "pier.mov" }) }));

    expect(await screen.findByText("1 file added to the project.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open pier" })).toHaveAttribute("href", `/p/${PROJECT_ID}`);
    expect(FakeUploadRequest.instances).toHaveLength(2);
  });

  it("creates the project and its in-place file in one request", async () => {
    const fetchMock = stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      [LISTING_KEY]: listingResponse,
      [IN_PLACE_KEY]: () => jsonResponse({ project: makeProject({ title: "harbor" }), asset: makeAsset() }, 201),
    });
    renderWithProviders(<HomeRoute />);

    await pickInPlace();

    expect(await screen.findByText("1 file added to the project.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open harbor" })).toBeInTheDocument();
    expect(requestBody(fetchMock, API_ROUTES.createProjectInPlace.path)).toEqual({ path: CLIP_PATH, title: "harbor" });
    expect(projectCreates(fetchMock)).toHaveLength(0);
  });

  it("creates no project when the in-place file is rejected", async () => {
    const fetchMock = stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      [LISTING_KEY]: listingResponse,
      [IN_PLACE_KEY]: () => jsonResponse({ error: "Playlists and concat lists are not media files" }, 415),
    });
    renderWithProviders(<HomeRoute />);

    await pickInPlace();

    expect(await screen.findByText("Playlists and concat lists are not media files")).toBeInTheDocument();
    expect(screen.queryByText(/added to the project/)).not.toBeInTheDocument();
    expect(projectCreates(fetchMock)).toHaveLength(0);
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
