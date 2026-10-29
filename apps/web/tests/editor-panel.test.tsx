// Created by The Angelo Umali.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { PREVIEW_LOADED_MESSAGE, PREVIEW_SEEK_MESSAGE, type CutSpec, type PlayerEdl } from "@zks/shared";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queries.ts";
import { EditorPanel } from "../src/editor/editor-panel.tsx";
import { useEventsStore } from "../src/events/store.ts";
import { SAMPLE_EVENTS } from "./event-fixtures.ts";
import { PROJECT_ID, jsonResponse, makeAsset, makeProject } from "./fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "./render.tsx";

const SPECS_URL = `/api/projects/${PROJECT_ID}/specs`;
const CUTS_URL = `${SPECS_URL}/v1/cuts`;
const DECIDE_URL = `/api/projects/${PROJECT_ID}/cut-candidates/c-2`;
const PROJECT_URL = `/api/projects/${PROJECT_ID}`;
const MEDIA_URL = `${PROJECT_URL}/media`;
const PROXY_URL = `${PROJECT_URL}/videos/v1/proxy`;
const EDL_URL = `/api/projects/${PROJECT_ID}/videos/v1/edl`;

function cutSpec(removals: CutSpec["removals"]): CutSpec {
  return {
    schemaVersion: 1,
    sourceAssetId: "0b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e",
    durationS: 30,
    fps: { num: 30000, den: 1001 },
    removals,
    bleeps: [],
    zooms: [{ at: 1, end: 4, preset: "snap" }],
    blurBoxes: [],
    portals: [],
    matteRanges: [],
  };
}

function specVersion(version: number, content: unknown) {
  return { videoId: "v1", kind: "cuts", version, author: "agent", note: "", createdAt: "2026-10-23T10:00:00.000Z", content };
}

// The server's view of cut spec v3 (30 s, 10–12 removed).
function playerEdl(overrides: Partial<PlayerEdl> = {}): PlayerEdl {
  return {
    videoId: "v1",
    cutsVersion: 3,
    durationS: 30,
    keptS: 28,
    segments: [
      { sourceAtS: 0, sourceEndS: 10, editedAtS: 0 },
      { sourceAtS: 12, sourceEndS: 30, editedAtS: 10 },
    ],
    preview: null,
    ...overrides,
  };
}

const SOURCE_ASSET = makeAsset({ kind: "source", name: "v1 source", durationS: 468 });

function stubEditorApi(extra: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    [`GET ${PROJECT_URL}`]: () => jsonResponse(makeProject()),
    [`GET ${MEDIA_URL}`]: () => jsonResponse({ assets: [SOURCE_ASSET] }),
    [`GET ${EDL_URL}`]: () => jsonResponse(playerEdl()),
    [`GET ${SPECS_URL}`]: () => jsonResponse({ specs: [{ videoId: "v1", kind: "cuts", currentVersion: 3 }] }),
    [`GET ${CUTS_URL}`]: () => jsonResponse(specVersion(3, cutSpec([{ at: 10, end: 12, reason: "pause" }]))),
    [`GET ${CUTS_URL}?version=1`]: () => jsonResponse(specVersion(1, cutSpec([]))),
    ...extra,
  });
}

describe("EditorPanel", () => {
  beforeEach(() => useEventsStore.setState({ feeds: {} }));

  describe("before the first cut spec", () => {
    const noSpecs = { [`GET ${SPECS_URL}`]: () => jsonResponse({ specs: [] }) };

    it("plays the original through its proxy and says it is not edited yet", async () => {
      stubEditorApi(noSpecs);
      const { container } = renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

      expect(await screen.findByText("Original video · not edited yet")).toBeInTheDocument();
      await waitFor(() => expect(container.querySelector("video")).toHaveAttribute("src", PROXY_URL));
      expect(screen.queryByText("Live preview · not a render")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
      expect(screen.queryByRole("list", { name: "Versions of this edit" })).not.toBeInTheDocument();
    });

    it("lays the whole original on the timeline as one block", async () => {
      stubEditorApi(noSpecs);
      renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

      expect(await screen.findByRole("group", { name: "Video, 1 item" })).toBeInTheDocument();
      expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "468");
    });

    it("shows a preparing state while the source is being ingested", async () => {
      stubEditorApi({ ...noSpecs, [`GET ${MEDIA_URL}`]: () => jsonResponse({ assets: [makeAsset({ kind: "camera" })] }) });
      const { container } = renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

      expect(await screen.findByText("Preparing your video…")).toBeInTheDocument();
      expect(container.querySelector("video")).toBeNull();
    });

    it("keeps preparing when the source has no duration yet", async () => {
      stubEditorApi({ ...noSpecs, [`GET ${MEDIA_URL}`]: () => jsonResponse({ assets: [makeAsset({ kind: "source", durationS: null })] }) });
      renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
      expect(await screen.findByText("Preparing your video…")).toBeInTheDocument();
    });

    it("asks for a clip when the project has no media", async () => {
      stubEditorApi({ ...noSpecs, [`GET ${MEDIA_URL}`]: () => jsonResponse({ assets: [] }) });
      renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
      expect(await screen.findByText("Add a clip to see it here.")).toBeInTheDocument();
    });

    it("switches to the edit when a cut spec appears while the original is showing", async () => {
      let hasCuts = false;
      stubEditorApi({
        [`GET ${SPECS_URL}`]: () => jsonResponse({ specs: hasCuts ? [{ videoId: "v1", kind: "cuts", currentVersion: 3 }] : [] }),
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <EditorPanel projectId={PROJECT_ID} />
        </QueryClientProvider>,
      );
      await screen.findByText("Original video · not edited yet");

      hasCuts = true;
      await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.specs(PROJECT_ID) }));

      expect(await screen.findByText("Edited · 0:28 (from 0:30)")).toBeInTheDocument();
      expect(screen.getByText("Live preview · not a render")).toBeInTheDocument();
    });
  });

  it("keeps the edit's own header over an older version picked in the strip", async () => {
    stubEditorApi();
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "v1" }));
    expect(await screen.findByText("Edited · 0:30 (from 0:30)")).toBeInTheDocument();
    expect(screen.getByText("Live preview · not a render")).toBeInTheDocument();
  });

  it("shows the edited length and the version history of the cut", async () => {
    stubEditorApi();
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

    expect(await screen.findByText("Edited · 0:28 (from 0:30)")).toBeInTheDocument();
    const versions = within(screen.getByRole("list", { name: "Versions of this edit" })).getAllByRole("button");
    expect(versions.map((button) => button.textContent)).toEqual(["v1", "v2", "v3"]);
    expect(versions[2]).toHaveAttribute("aria-current", "true");
  });

  it("opens the video's player EDL, which starts its preview build, and times the edit by it", async () => {
    const fetchMock = stubEditorApi({
      [`GET ${EDL_URL}`]: () => jsonResponse(playerEdl({ keptS: 26, segments: [{ sourceAtS: 4, sourceEndS: 30, editedAtS: 0 }] })),
    });
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

    expect(await screen.findByText("Edited · 0:26 (from 0:30)")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === EDL_URL)).toBe(true);
  });

  it("seeks the overlay frame with the preview contract once the frame says it loaded", async () => {
    stubEditorApi();
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    await screen.findByText("Edited · 0:28 (from 0:30)");
    act(() => useEventsStore.getState().receive(SAMPLE_EVENTS["preview.ready"]));
    const overlayWindow = screen.getByTitle<HTMLIFrameElement>("Overlay preview").contentWindow;
    if (overlayWindow === null) throw new Error("the overlay frame has no window");
    const postMessage = vi.spyOn(overlayWindow, "postMessage");

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source: overlayWindow, data: { type: PREVIEW_LOADED_MESSAGE, durationS: 28 } }));
    });

    expect(postMessage).toHaveBeenCalledWith({ type: PREVIEW_SEEK_MESSAGE, time: 0 }, "*");
  });

  it("ignores a loaded notice from any window but the overlay frame", async () => {
    stubEditorApi();
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    await screen.findByText("Edited · 0:28 (from 0:30)");
    act(() => useEventsStore.getState().receive(SAMPLE_EVENTS["preview.ready"]));
    const overlayWindow = screen.getByTitle<HTMLIFrameElement>("Overlay preview").contentWindow;
    if (overlayWindow === null) throw new Error("the overlay frame has no window");
    const postMessage = vi.spyOn(overlayWindow, "postMessage");

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: PREVIEW_LOADED_MESSAGE, durationS: 28 } }));
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("restores an older version through the restore route", async () => {
    const fetchMock = stubEditorApi({ [`POST ${CUTS_URL}/restore`]: () => jsonResponse({ videoId: "v1", kind: "cuts", currentVersion: 4 }) });
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

    await userEvent.click(await screen.findByRole("button", { name: "v1" }));
    expect(await screen.findByText("Edited · 0:30 (from 0:30)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore v1" }));

    await waitFor(() => expect(requestBody(fetchMock, `${CUTS_URL}/restore`)).toEqual({ version: 1 }));
  });

  it("sends only explicitly approved cut candidates", async () => {
    const fetchMock = stubEditorApi({ [`POST ${DECIDE_URL}`]: () => jsonResponse({ ok: true }) });
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    act(() =>
      useEventsStore.getState().receive({
        ...SAMPLE_EVENTS["cuts.proposed"],
        requestId: "c-2",
        candidates: [
          { id: "keep-me", kind: "filler", at: 3, end: 4, context: "um", reason: "Filler word" },
          { id: "drop-me", kind: "pause", at: 6, end: 8, context: "…", reason: "Long pause" },
          { id: "undecided", kind: "stutter", at: 9, end: 9.5, context: "I I", reason: "Stutter" },
        ],
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "Approve cut 0:03.0–0:04.0" }));
    await userEvent.click(screen.getByRole("button", { name: "Reject cut 0:06.0–0:08.0" }));
    expect(screen.getByRole("button", { name: "Approve cut 0:03.0–0:04.0" })).toHaveAttribute("aria-pressed", "true");
    // Tenths, so a sub-second cut never reads as "0:09–0:09".
    expect(screen.getByRole("button", { name: "Approve cut 0:09.0–0:09.5" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send cut decisions" }));

    await waitFor(() => expect(requestBody(fetchMock, DECIDE_URL)).toEqual({ approved: ["keep-me"], rejected: ["drop-me", "undecided"] }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Send cut decisions" })).not.toBeInTheDocument());
  });

  it("points the overlay frame at the latest preview composition", async () => {
    stubEditorApi();
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    await screen.findByText("Edited · 0:28 (from 0:30)");
    act(() => useEventsStore.getState().receive({ ...SAMPLE_EVENTS["preview.ready"], edlVersion: 5 }));

    const overlay = screen.getByTitle("Overlay preview");
    expect(overlay).toHaveAttribute("sandbox", "allow-scripts");
    expect(overlay).toHaveAttribute("data-edl-version", "5");
  });

  it("shows the composition built before the page opened, with no preview.ready on its feed", async () => {
    const compositionUrl = "http://127.0.0.1:4318/compositions/p/v1/index.html?build=4";
    stubEditorApi({ [`GET ${EDL_URL}`]: () => jsonResponse(playerEdl({ preview: { compositionUrl, edlVersion: 3 } })) });
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);

    const overlay = await screen.findByTitle("Overlay preview");
    expect(overlay).toHaveAttribute("src", compositionUrl);
    expect(overlay).toHaveAttribute("data-edl-version", "3");
  });

  it("prefers a live preview.ready over the composition the EDL reported", async () => {
    stubEditorApi({
      [`GET ${EDL_URL}`]: () => jsonResponse(playerEdl({ preview: { compositionUrl: "http://127.0.0.1:4318/old/index.html", edlVersion: 3 } })),
    });
    renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    await screen.findByTitle("Overlay preview");
    act(() => useEventsStore.getState().receive({ ...SAMPLE_EVENTS["preview.ready"], edlVersion: 5 }));

    expect(screen.getByTitle("Overlay preview")).toHaveAttribute("data-edl-version", "5");
  });

  it("has no axe violations", async () => {
    stubEditorApi();
    const { container } = renderWithProviders(<EditorPanel projectId={PROJECT_ID} />);
    await screen.findByText("Edited · 0:28 (from 0:30)");

    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
