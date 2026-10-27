// Created by The Angelo Umali.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { act } from "react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES, PROJECT_TITLE_HEADER } from "@zks/shared";
import { editorPath } from "../../src/lib/routes.ts";
import { StartTemplates } from "../../src/templates/start-templates.tsx";
import { FakeUploadRequest, PROJECT_ID, jsonResponse, makeAsset, makeProject } from "../fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "../render.tsx";
import { SHIPPED_TEMPLATES, shippedTemplate } from "../shipped-presets.ts";

const PROJECTS_KEY = "GET /api/projects";
const PROMPT_PATH = `/api/projects/${PROJECT_ID}/prompt`;
const PROMPT_KEY = `POST ${PROMPT_PATH}`;
const DEMO_KEY = `POST ${API_ROUTES.openDemoProject.path}`;
const TEMPLATES_KEY = `GET ${API_ROUTES.listTemplates.path}`;
const START_PATH = API_ROUTES.startTemplate.path.replace(":projectId", PROJECT_ID);
const START_KEY = `POST ${START_PATH}`;
const CONNECTION_KEY = `GET ${API_ROUTES.getConnection.path}`;
const CAMERA_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SECOND_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

function renderTemplates() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<StartTemplates />} />
      <Route path={editorPath(PROJECT_ID)} element={<p>Editor page</p>} />
    </Routes>,
  );
}

const listTemplates = () => jsonResponse({ templates: SHIPPED_TEMPLATES });
const connectedAs = (mode: "api_key" | "terminal" | null) => () => jsonResponse({ mode, keyLast4: null, provider: null, claudeVersion: "2.1.300" });

function stubStartFetch(mode: "api_key" | "terminal" | null = "api_key") {
  const fetchMock = stubFetch({
    [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
    [TEMPLATES_KEY]: listTemplates,
    [CONNECTION_KEY]: connectedAs(mode),
    [START_KEY]: () => {
      const { templateId } = requestBody(fetchMock, START_PATH, "POST") as { templateId: string };
      return jsonResponse({ templateId, ingestMode: shippedTemplate(templateId).ingestMode, ingestJobId: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f" });
    },
    [PROMPT_KEY]: () => jsonResponse({ ok: true }),
  });
  return fetchMock;
}

/** Typed as video so the inputs' accept filter keeps them. */
function video(content: string, name: string): File {
  return new File([content], name, { type: "video/mp4" });
}

function nthUpload(index: number): Promise<FakeUploadRequest> {
  return vi.waitFor(() => {
    const request = FakeUploadRequest.instances[index];
    if (!request) throw new Error(`upload ${index} has not started`);
    return request;
  });
}

function promptText(fetchMock: ReturnType<typeof stubFetch>): string {
  const body = requestBody(fetchMock, PROMPT_PATH, "POST") as { text: string };
  return body.text;
}

async function openTemplate(name: RegExp): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.getByRole("dialog");
}

describe("Start from a template", () => {
  beforeEach(() => {
    FakeUploadRequest.instances.length = 0;
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
  });

  it("lists every shipped template with its ingest mode, plus the demo project", async () => {
    stubStartFetch();
    renderTemplates();

    const list = await screen.findByRole("list", { name: "Templates" });
    const items = await within(list).findAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("button").dataset["templateId"]).sort()).toEqual(SHIPPED_TEMPLATES.map((template) => template.id).sort());
    expect(screen.getByRole("button", { name: /Talking-head short/ })).toHaveTextContent("Ingest: single clip");
    expect(screen.getByRole("button", { name: /Vlog/ })).toHaveTextContent("Ingest: join clips in order");
    expect(screen.getByRole("button", { name: /Screen-recording showcase/ })).toHaveTextContent("Ingest: showcase");
    expect(screen.getByRole("button", { name: /Try the demo project/ })).toBeInTheDocument();
  });

  it("says why the templates could not load", async () => {
    stubFetch({ [PROJECTS_KEY]: () => jsonResponse({ projects: [] }), [TEMPLATES_KEY]: () => jsonResponse({ error: "Presets are unreadable" }, 500) });
    renderTemplates();

    expect(await screen.findByRole("alert")).toHaveTextContent("Presets are unreadable");
  });

  it("starts a talking-head project from one clip and sends the template prompt", async () => {
    const fetchMock = stubStartFetch();
    renderTemplates();

    const dialog = await openTemplate(/Talking-head short/);
    expect(within(dialog).getByRole("heading", { name: "Talking-head short" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Prompt")).toHaveValue(shippedTemplate("talking-head-short").prompt);
    await userEvent.upload(within(dialog).getByLabelText("Clip"), video("a", "talk.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));

    const create = await nthUpload(0);
    expect(create.url).toBe(API_ROUTES.createProjectWithMedia.path);
    expect(create.headers.get(PROJECT_TITLE_HEADER)).toBe("talk");
    act(() => create.respond(201, { project: makeProject(), asset: makeAsset({ id: CAMERA_ID, name: "talk.mp4" }) }));

    expect(await screen.findByText("Editor page")).toBeInTheDocument();
    expect(requestBody(fetchMock, START_PATH, "POST")).toEqual({ templateId: "talking-head-short", clipAssetIds: [CAMERA_ID] });
    expect(promptText(fetchMock)).toBe(shippedTemplate("talking-head-short").prompt);
  });

  it("uploads vlog clips in the order picked and asks for a joined source", async () => {
    const fetchMock = stubStartFetch();
    renderTemplates();

    const dialog = await openTemplate(/Vlog/);
    await userEvent.upload(within(dialog).getByLabelText("Clips, in order"), [video("a", "morning.mp4"), video("b", "lunch.mp4")]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));

    const create = await nthUpload(0);
    expect(create.headers.get(PROJECT_TITLE_HEADER)).toBe("morning");
    act(() => create.respond(201, { project: makeProject(), asset: makeAsset({ id: CAMERA_ID, name: "morning.mp4" }) }));
    const second = await nthUpload(1);
    expect(second.url).toBe(`/api/projects/${PROJECT_ID}/media`);
    act(() => second.respond(201, makeAsset({ id: SECOND_ID, name: "lunch.mp4" })));

    expect(await screen.findByText("Editor page")).toBeInTheDocument();
    expect(requestBody(fetchMock, START_PATH, "POST")).toEqual({ templateId: "vlog", clipAssetIds: [CAMERA_ID, SECOND_ID] });
  });

  it("uploads the camera clip first and the screen recording second for a showcase", async () => {
    const fetchMock = stubStartFetch();
    renderTemplates();

    const dialog = await openTemplate(/Screen-recording showcase/);
    await userEvent.upload(within(dialog).getByLabelText("Screen recording"), video("s", "screen.mp4"));
    await userEvent.upload(within(dialog).getByLabelText("Camera clip"), video("c", "face.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));

    const create = await nthUpload(0);
    expect(create.headers.get(PROJECT_TITLE_HEADER)).toBe("face");
    act(() => create.respond(201, { project: makeProject(), asset: makeAsset({ id: CAMERA_ID, name: "face.mp4" }) }));
    const second = await nthUpload(1);
    act(() => second.respond(201, makeAsset({ id: SECOND_ID, name: "screen.mp4" })));

    expect(await screen.findByText("Editor page")).toBeInTheDocument();
    expect(requestBody(fetchMock, START_PATH, "POST")).toEqual({
      templateId: "screen-recording-showcase",
      clipAssetIds: [CAMERA_ID],
      insertAssetId: SECOND_ID,
    });
  });

  it("shows the server's reason and sends no prompt when the template cannot start", async () => {
    const fetchMock = stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      [TEMPLATES_KEY]: listTemplates,
      [CONNECTION_KEY]: connectedAs("api_key"),
      [START_KEY]: () => jsonResponse({ error: "Both files need a known duration for a showcase" }, 400),
    });
    renderTemplates();

    const dialog = await openTemplate(/Talking-head short/);
    await userEvent.upload(within(dialog).getByLabelText("Clip"), video("a", "talk.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));
    const create = await nthUpload(0);
    act(() => create.respond(201, { project: makeProject(), asset: makeAsset({ id: CAMERA_ID }) }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Both files need a known duration for a showcase");
    expect(fetchMock.mock.calls.some(([url]) => url === PROMPT_PATH)).toBe(false);
  });

  it("creates nothing and points to Setup when no connection is set up", async () => {
    const fetchMock = stubStartFetch(null);
    renderTemplates();

    const dialog = await openTemplate(/Talking-head short/);
    await userEvent.upload(within(dialog).getByLabelText("Clip"), video("a", "talk.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Connect Claude before starting a template.");
    expect(within(dialog).getByRole("link", { name: "Open Setup" })).toHaveAttribute("href", "/setup");
    expect(FakeUploadRequest.instances).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => url === START_PATH || url === PROMPT_PATH)).toBe(false);
  });

  it("starts in terminal mode, where the server opens the terminal on the first prompt", async () => {
    stubStartFetch("terminal");
    renderTemplates();

    const dialog = await openTemplate(/Talking-head short/);
    await userEvent.upload(within(dialog).getByLabelText("Clip"), video("a", "talk.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));

    const create = await nthUpload(0);
    act(() => create.respond(201, { project: makeProject(), asset: makeAsset({ id: CAMERA_ID }) }));
    expect(await screen.findByText("Editor page")).toBeInTheDocument();
  });

  it("asks for the missing files instead of starting", async () => {
    stubStartFetch();
    renderTemplates();

    const dialog = await openTemplate(/Screen-recording showcase/);
    await userEvent.upload(within(dialog).getByLabelText("Camera clip"), video("c", "face.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Add a screen recording.");
    expect(FakeUploadRequest.instances).toHaveLength(0);
  });

  it("shows the server's reason when an upload is rejected", async () => {
    stubStartFetch();
    renderTemplates();

    const dialog = await openTemplate(/Talking-head short/);
    await userEvent.upload(within(dialog).getByLabelText("Clip"), video("x", "notes.mp4"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the edit" }));
    const create = await nthUpload(0);
    act(() => create.respond(415, { error: "Not a video file" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Not a video file");
    expect(screen.queryByText("Editor page")).not.toBeInTheDocument();
  });

  it("opens the demo project without any footage", async () => {
    const fetchMock = stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      [TEMPLATES_KEY]: listTemplates,
      [DEMO_KEY]: () => jsonResponse(makeProject({ title: "Demo" }), 201),
    });
    renderTemplates();

    await userEvent.click(screen.getByRole("button", { name: /Try the demo project/ }));

    expect(await screen.findByText("Editor page")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => url === API_ROUTES.openDemoProject.path && init?.method === "POST")).toBe(true);
  });

  it("says why the demo project could not open", async () => {
    stubFetch({
      [PROJECTS_KEY]: () => jsonResponse({ projects: [] }),
      [TEMPLATES_KEY]: listTemplates,
      [DEMO_KEY]: () => jsonResponse({ error: "The demo footage is missing" }, 500),
    });
    renderTemplates();

    await userEvent.click(screen.getByRole("button", { name: /Try the demo project/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The demo footage is missing");
  });

  it("has no axe violations with a template open", async () => {
    stubStartFetch();
    const { container } = renderTemplates();
    await openTemplate(/Vlog/);

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
