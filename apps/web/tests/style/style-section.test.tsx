// Created by The Angelo Umali.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { ProjectStyle } from "@zks/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventsStore } from "../../src/events/store.ts";
import { StyleSection } from "../../src/style/style-section.tsx";
import { SAMPLE_EVENTS } from "../event-fixtures.ts";
import { FakeUploadRequest, PROJECT_ID, jsonResponse, makeAsset } from "../fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "../render.tsx";

const STYLE_KEY = `GET /api/projects/${PROJECT_ID}/style`;
const PUT_KEY = `PUT /api/projects/${PROJECT_ID}/style`;
const MEDIA_KEY = `GET /api/projects/${PROJECT_ID}/media`;
const STYLE_PATH = `/api/projects/${PROJECT_ID}/style`;
const REFERENCE_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const MATCHED: ProjectStyle = {
  theme: "minimal",
  tokens: { ink: "#112233", gold: "#ccaa00" },
  type: { display: "Caveat", body: "Inter" },
  sfx: "light",
  shotLengthS: 2.5,
  referenceAssetId: REFERENCE_ID,
};

function stubStudio(style: ProjectStyle | null, assets = [makeAsset({ id: REFERENCE_ID, kind: "reference", name: "tiktok-look.mp4" })]) {
  return stubFetch({
    [STYLE_KEY]: () => jsonResponse({ style }),
    [MEDIA_KEY]: () => jsonResponse({ assets }),
    [PUT_KEY]: (init) => jsonResponse(JSON.parse(typeof init?.body === "string" ? init.body : "null")),
  });
}

function renderSection() {
  return renderWithProviders(<StyleSection projectId={PROJECT_ID} />);
}

beforeEach(() => {
  FakeUploadRequest.instances.length = 0;
  useEventsStore.setState({ feeds: {} });
});

describe("Style section: current look", () => {
  it("says the ZKidz look is in use when no style is set", async () => {
    stubStudio(null);
    renderSection();

    expect(await screen.findByText("Using the ZKidz look. Drop a reference video and ask Claude to match it.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
  });

  it("lists theme, colours, fonts, sound effects, pace and the reference it came from", async () => {
    stubStudio(MATCHED);
    renderSection();

    const look = await screen.findByRole("group", { name: "Current look" });
    expect(within(look).getByText("Minimal")).toBeVisible();
    expect(within(look).getByText("ink")).toBeVisible();
    expect(within(look).getByText("#112233")).toBeVisible();
    expect(within(look).getByText("Display")).toBeVisible();
    expect(within(look).getByText("Caveat")).toBeVisible();
    expect(within(look).getByText("Light sound effects")).toBeVisible();
    expect(within(look).getByText("About 2.5 s per shot")).toBeVisible();
    expect(screen.getByText("Matched from tiktok-look.mp4")).toBeVisible();
  });

  it("says so when the reference it came from is gone", async () => {
    stubStudio(MATCHED, []);
    renderSection();

    expect(await screen.findByText("Matched from a reference that is no longer in this project")).toBeVisible();
  });

  it("shows an error when the style cannot be read", async () => {
    stubFetch({ [STYLE_KEY]: () => jsonResponse({ error: "Project not found" }, 404), [MEDIA_KEY]: () => jsonResponse({ assets: [] }) });
    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("Project not found");
  });

  it("has no accessibility violations", async () => {
    stubStudio(MATCHED);
    const { container } = renderSection();
    await screen.findByRole("group", { name: "Current look" });

    const { violations } = await axe.run(container);
    expect(violations).toEqual([]);
  });
});

describe("Style section: theme and reset", () => {
  it("saves a theme switch, keeping the rest of the look", async () => {
    const fetchMock = stubStudio(MATCHED);
    renderSection();

    await userEvent.selectOptions(await screen.findByLabelText("Theme"), "zkidz");

    await waitFor(() => expect(requestBody(fetchMock, STYLE_PATH, "PUT")).toEqual({ style: { ...MATCHED, theme: "zkidz" } }));
  });

  it("saves a bare theme when no style was set", async () => {
    const fetchMock = stubStudio(null);
    renderSection();

    await userEvent.selectOptions(await screen.findByLabelText("Theme"), "minimal");

    await waitFor(() => expect(requestBody(fetchMock, STYLE_PATH, "PUT")).toEqual({ style: { theme: "minimal" } }));
  });

  it("refetches the style after a save", async () => {
    const fetchMock = stubStudio(MATCHED);
    renderSection();
    await userEvent.selectOptions(await screen.findByLabelText("Theme"), "zkidz");

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => url === STYLE_PATH && (init?.method ?? "GET") === "GET")).toHaveLength(2));
  });

  it("asks in place before resetting, then PUTs null", async () => {
    const fetchMock = stubStudio(MATCHED);
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Reset to the ZKidz look" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Yes, reset" }));

    await waitFor(() => expect(requestBody(fetchMock, STYLE_PATH, "PUT")).toEqual({ style: null }));
  });

  it("keeps the look when the reset is declined", async () => {
    stubStudio(MATCHED);
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Reset to the ZKidz look" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(screen.getByRole("button", { name: "Reset to the ZKidz look" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Yes, reset" })).not.toBeInTheDocument();
  });

  it("shows the server's message when a save fails", async () => {
    stubFetch({
      [STYLE_KEY]: () => jsonResponse({ style: MATCHED }),
      [MEDIA_KEY]: () => jsonResponse({ assets: [] }),
      [PUT_KEY]: () => jsonResponse({ error: 'Token "ink" is not in the Minimal theme' }, 400),
    });
    renderSection();

    await userEvent.selectOptions(await screen.findByLabelText("Theme"), "zkidz");

    expect(await screen.findByRole("alert")).toHaveTextContent('Token "ink" is not in the Minimal theme');
  });
});

describe("Style section: refresh from the agent", () => {
  it("refetches when the agent finishes set_project_style", async () => {
    const fetchMock = stubStudio(null);
    renderSection();
    await screen.findByText(/Using the ZKidz look/);
    const styleReads = () => fetchMock.mock.calls.filter(([url, init]) => url === STYLE_PATH && (init?.method ?? "GET") === "GET").length;
    expect(styleReads()).toBe(1);

    act(() => {
      useEventsStore.getState().receive({ ...SAMPLE_EVENTS["tool.called"], toolUseId: "t9", name: "mcp__studio__set_project_style" });
      useEventsStore.getState().receive({ ...SAMPLE_EVENTS["tool.finished"], toolUseId: "t9" });
    });

    await waitFor(() => expect(styleReads()).toBe(2));
  });
});

describe("Style section: reference slot", () => {
  async function dropReference(name = "tiktok-look.mp4") {
    stubStudio(null);
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    renderSection();
    const input = await screen.findByLabelText("Style reference video");
    fireEvent.change(input, { target: { files: [new File(["frames"], name, { type: "video/mp4" })] } });
    return vi.waitFor(() => {
      const request = FakeUploadRequest.instances[0];
      if (!request) throw new Error("upload has not started");
      return request;
    });
  }

  it("uploads the picked video as a reference and names the sentence to tell Claude", async () => {
    const request = await dropReference();
    expect(request.url).toBe(`/api/projects/${PROJECT_ID}/media?kind=reference`);

    act(() => request.respond(201, makeAsset({ kind: "reference", name: "tiktok-look.mp4" })));

    expect(await screen.findByText("Now tell Claude: match the style of tiktok-look.mp4")).toBeVisible();
  });

  it("copies that sentence", async () => {
    const user = userEvent.setup();
    const request = await dropReference();
    act(() => request.respond(201, makeAsset({ kind: "reference", name: "tiktok-look.mp4" })));

    await user.click(await screen.findByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe("match the style of tiktok-look.mp4");
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("takes a dropped video on the slot itself", async () => {
    stubStudio(null);
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    renderSection();
    const slot = await screen.findByTestId("reference-slot");

    fireEvent.drop(slot, { dataTransfer: { files: [new File(["frames"], "look.mov", { type: "video/quicktime" })], types: ["Files"] } });

    await vi.waitFor(() => expect(FakeUploadRequest.instances).toHaveLength(1));
  });

  it("explains a rejected file", async () => {
    const request = await dropReference("notes.txt");
    act(() => request.respond(400, { error: "That file is not a video." }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That file is not a video.");
    expect(screen.queryByText(/Now tell Claude/)).not.toBeInTheDocument();
  });

  it("shows the newest reference when a second replaces the first", async () => {
    const first = await dropReference("first.mp4");
    act(() => first.respond(201, makeAsset({ kind: "reference", name: "first.mp4" })));
    await screen.findByText("Now tell Claude: match the style of first.mp4");

    fireEvent.change(screen.getByLabelText("Style reference video"), { target: { files: [new File(["frames"], "second.mp4", { type: "video/mp4" })] } });
    const second = await vi.waitFor(() => {
      const request = FakeUploadRequest.instances[1];
      if (!request) throw new Error("second upload has not started");
      return request;
    });
    act(() => second.respond(201, makeAsset({ kind: "reference", name: "second.mp4" })));

    expect(await screen.findByText("Now tell Claude: match the style of second.mp4")).toBeVisible();
    expect(screen.queryByText(/first\.mp4/)).not.toBeInTheDocument();
  });
});
