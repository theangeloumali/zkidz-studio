// Created by The Angelo Umali.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StudioEvent } from "@zks/shared";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { AgentPane } from "../src/agent/agent-pane.tsx";
import { SAMPLE_EVENTS, sampleEvent } from "./event-fixtures.ts";
import { PROJECT_ID, jsonResponse } from "./fakes.ts";
import { renderWithProviders, requestBody, stubFetch } from "./render.tsx";

// The real pane opens xterm and a socket; terminal-pane.test.tsx covers it.
vi.mock("../src/terminal/TerminalPane.tsx", () => ({
  TerminalPane: ({ sessionId, onRestart }: { sessionId: string; onRestart: () => void }) => (
    <button type="button" onClick={onRestart}>
      Terminal {sessionId}
    </button>
  ),
}));

const HOSTILE = "</script><img src=x onerror=alert(1)>";
const DECISIONS = `/api/projects/${PROJECT_ID}/decisions`;
const CUT_CANDIDATES = `/api/projects/${PROJECT_ID}/cut-candidates/c-1`;
const OPEN_TERMINAL = `/api/projects/${PROJECT_ID}/terminal`;
// The shared contract types sessionId as a UUID, so a free-form id fails the response parse.
const TERMINAL_SESSION_ID = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7";

function renderPane(events: readonly StudioEvent[], mode: "api_key" | "terminal" = "api_key") {
  return renderWithProviders(<AgentPane projectId={PROJECT_ID} events={events} mode={mode} />);
}

function stubAgentApi() {
  return stubFetch({
    "GET /api/projects": () => jsonResponse({ projects: [] }),
    [`POST ${DECISIONS}`]: () => jsonResponse({ ok: true }),
    [`POST ${CUT_CANDIDATES}`]: () => jsonResponse({ ok: true }),
    [`POST /api/projects/${PROJECT_ID}/prompt`]: () => jsonResponse({ ok: true }),
    [`POST /api/projects/${PROJECT_ID}/stop`]: () => jsonResponse({ ok: true }),
    [`POST ${OPEN_TERMINAL}`]: () => jsonResponse({ sessionId: TERMINAL_SESSION_ID }),
  });
}

describe("AgentPane", () => {
  it("invites a first prompt when nothing has happened yet", () => {
    renderPane([]);
    expect(screen.getByText("Tell the agent what you want")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start editing" })).toBeInTheDocument();
  });

  it("renders hostile labels as literal text", () => {
    const { container } = renderPane([
      sampleEvent("tool.called", { label: HOSTILE }),
      sampleEvent("narration", { text: HOSTILE }),
      sampleEvent("approval.requested", { agentNote: HOSTILE }),
    ]);
    expect(screen.getAllByText(HOSTILE, { exact: false }).length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws an entry for every event type", () => {
    renderPane(Object.values(SAMPLE_EVENTS));
    const feed = screen.getByRole("list", { name: "Agent activity" });
    expect(within(feed).getByText("Transcribing beach.mp4")).toBeInTheDocument();
    expect(within(feed).getByText("render · succeeded")).toBeInTheDocument();
    expect(within(feed).getByText("Which take should open the video?")).toBeInTheDocument();
    expect(within(feed).getByText("so um yeah")).toBeInTheDocument();
    expect(within(feed).getByText("Your API key was rejected")).toBeInTheDocument();
  });

  it("shows a running job's latest progress", () => {
    renderPane([SAMPLE_EVENTS["job.started"], SAMPLE_EVENTS["job.progress"]]);
    expect(screen.getByText("render · encode 42% · about 2 min left")).toBeInTheDocument();
  });

  it("shows the server's facts before Claude's own note on an approval", async () => {
    const fetchMock = stubAgentApi();
    renderPane([SAMPLE_EVENTS["approval.requested"]]);
    const card = screen.getByRole("article", { name: "Render the 4K master" });
    const facts = within(card).getByRole("list", { name: "What will happen" });
    const note = within(card).getByRole("blockquote");
    expect(facts.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText("Claude says")).toBeInTheDocument();
    expect(within(facts).getByText("about 6 GPU minutes")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(requestBody(fetchMock, DECISIONS)).toEqual({ kind: "approval", requestId: "a-1", decision: "allow" });
  });

  it("denies an approval with Not yet", async () => {
    const fetchMock = stubAgentApi();
    renderPane([SAMPLE_EVENTS["approval.requested"]]);
    await userEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(requestBody(fetchMock, DECISIONS)).toEqual({ kind: "approval", requestId: "a-1", decision: "deny" });
  });

  it("answers a question with the picked option", async () => {
    const fetchMock = stubAgentApi();
    renderPane([SAMPLE_EVENTS["question.asked"]]);
    await userEvent.click(screen.getByRole("radio", { name: /Take 2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(requestBody(fetchMock, DECISIONS)).toEqual({ kind: "question", requestId: "q-1", answers: { "Which take should open the video?": "Take 2" } });
  });

  it("sends the cut decisions to the cut-candidates route the reviewer waits on", async () => {
    const fetchMock = stubAgentApi();
    renderPane([SAMPLE_EVENTS["cuts.proposed"]]);
    await userEvent.click(screen.getByRole("button", { name: "Apply cuts" }));
    expect(requestBody(fetchMock, CUT_CANDIDATES)).toEqual({ approved: ["cut-1"], rejected: [] });
    expect(await screen.findByText("Sent.")).toBeInTheDocument();
  });

  it("sends the prompt with Ctrl+Enter and clears the field", async () => {
    const fetchMock = stubAgentApi();
    renderPane([]);
    const field = screen.getByLabelText("Prompt");
    await userEvent.type(field, "Cut the dead air{Control>}{Enter}{/Control}");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === `/api/projects/${PROJECT_ID}/prompt`)).toBe(true));
    expect(requestBody(fetchMock, `/api/projects/${PROJECT_ID}/prompt`)).toEqual({ text: "Cut the dead air" });
    expect(field).toHaveValue("");
  });

  it("stops a running turn", async () => {
    const fetchMock = stubAgentApi();
    renderPane([sampleEvent("prompt.submitted"), SAMPLE_EVENTS["tool.started"]]);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(fetchMock.mock.calls.some(([url]) => url === `/api/projects/${PROJECT_ID}/stop`)).toBe(true);
  });

  it("shows the latest turn cost as an estimate, never a total", () => {
    renderPane([sampleEvent("turn.completed", { costUsd: 0.1 }), sampleEvent("turn.completed", { costUsd: 0.42 }), SAMPLE_EVENTS.limit]);
    const usage = screen.getByRole("group", { name: "Usage" });
    expect(within(usage).getByText("≈ $0.42 this turn (estimate)")).toBeInTheDocument();
    expect(within(usage).getByRole("meter")).toHaveAttribute("aria-valuenow", "80");
  });

  it("offers the Terminal tab and hides the cost only in terminal mode", () => {
    stubAgentApi();
    renderPane([sampleEvent("turn.completed", { costUsd: 0.42 })], "terminal");
    expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.queryByText(/this turn/)).toBeNull();
  });

  it("opens the project's terminal before Claude Code has started, and restarts it on request", async () => {
    const fetchMock = stubAgentApi();
    renderPane([], "terminal");
    await userEvent.click(await screen.findByText(`Terminal ${TERMINAL_SESSION_ID}`, {}, { timeout: 2000 }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === OPEN_TERMINAL)).toHaveLength(2));
  });

  it("sends a terminal-mode prompt through the server, which writes it to the PTY", async () => {
    const fetchMock = stubAgentApi();
    renderPane([], "terminal");
    await userEvent.type(screen.getByLabelText("Prompt"), "Cut the dead air{Control>}{Enter}{/Control}");
    await waitFor(() => expect(requestBody(fetchMock, `/api/projects/${PROJECT_ID}/prompt`)).toEqual({ text: "Cut the dead air" }));
  });

  it("has no axe violations with cards on screen", async () => {
    const { container } = renderPane(Object.values(SAMPLE_EVENTS));
    const results = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
