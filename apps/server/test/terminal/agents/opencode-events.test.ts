// Created by The Angelo Umali.
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NewStudioEvent } from "../../../src/events/event-bus.ts";
import type { PreparedLaunch } from "../../../src/terminal/agents/agent-adapter.ts";
import { waitFor } from "../stub-claude.ts";
import {
  PROJECT_ID,
  TOKENS,
  SERVER_URL,
  BINARY,
  RESUMED_SESSION,
  launchRequest,
  sseResponse,
  fakeServer,
  adapterWith,
  connectWith,
} from "./opencode-fixtures.ts";

describe("opencode adapter: events", () => {
  async function subscribeWithSession(streams: Response[][], projectDir?: string) {
    const server = fakeServer(streams);
    const { adapter, connect } = await connectWith(server, projectDir === undefined ? {} : { projectDir });
    const launch = await connect();
    if (launch === undefined || adapter.events.kind !== "stream") throw new Error("opencode reports through its event stream");
    const events: NewStudioEvent[] = [];
    const stop = adapter.events.subscribe(launch, { projectId: PROJECT_ID, model: "openai/gpt-5.6-luna" }, (published) => events.push(...published));
    return { events, calls: server.calls, stop };
  }

  it("refuses to follow a launch whose server it never checked", async () => {
    const adapter = adapterWith();
    const prepared: PreparedLaunch = await adapter.prepare(await launchRequest(), TOKENS, BINARY);
    if (adapter.events.kind !== "stream") throw new Error("opencode reports through its event stream");
    expect(() => adapter.events.kind === "stream" && adapter.events.subscribe(prepared, { projectId: PROJECT_ID }, () => undefined)).toThrow(
      expect.objectContaining({ reason: "companion_failed" }),
    );
  });

  it("maps a turn: prompt, tool call, result, text, usage and the end", async () => {
    const scoped = (type: string, data: Record<string, unknown>) => ({ id: `evt_${type}`, type, data: { sessionID: RESUMED_SESSION, ...data } });
    const turn = await subscribeWithSession([
      [
        sseResponse([
          { id: "evt_0", type: "server.connected", data: {} },
          scoped("session.inbox.enqueued", { item: { type: "user", payload: { text: "cut it" } } }),
          scoped("session.execution.started", {}),
          scoped("session.tool.input.started", { id: "call_1", name: "studio_project_info" }),
          scoped("session.tool.called", { id: "call_1", input: { verbose: true } }),
          scoped("session.tool.success", { id: "call_1", content: [{ type: "text", text: "two clips" }] }),
          scoped("session.tool.input.started", { id: "call_2", name: "read" }),
          scoped("session.tool.called", { id: "call_2", input: { filePath: "/etc/passwd" } }),
          scoped("session.tool.failed", { id: "call_2", error: { type: "permission.rejected", message: "Permission denied: external_directory" } }),
          { id: "evt_other", type: "session.text.ended", data: { sessionID: "ses_someoneelse0000000000000", text: "not ours" } },
          scoped("session.text.ended", { text: "Two clips found.", native: { phase: "final_answer" } }),
          scoped("session.usage.updated", { cost: 0, tokens: { input: 2748, output: 218, reasoning: 178, cache: { read: 3584, write: 0 } } }),
          scoped("session.execution.succeeded", {}),
        ]),
      ],
    ]);
    await waitFor(() => turn.events.some((event) => event.type === "terminal.state" && event.state === "ready" && turn.events.length > 3), 5_000);
    turn.stop();
    expect(turn.events).toEqual([
      {
        type: "session.started",
        projectId: PROJECT_ID,
        sessionId: RESUMED_SESSION,
        model: "openai/gpt-5.6-luna",
        credential: "your OpenCode sign-in",
        skills: [],
      },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
      { type: "prompt.submitted", projectId: PROJECT_ID, text: "cut it" },
      { type: "terminal.state", projectId: PROJECT_ID, state: "working" },
      {
        type: "tool.called",
        projectId: PROJECT_ID,
        toolUseId: "call_1",
        name: "mcp__studio__project_info",
        label: expect.any(String) as unknown,
        input: { verbose: true },
      },
      { type: "tool.finished", projectId: PROJECT_ID, toolUseId: "call_1", ok: true, summary: "two clips" },
      {
        type: "tool.called",
        projectId: PROJECT_ID,
        toolUseId: "call_2",
        name: "read",
        label: expect.any(String) as unknown,
        input: { filePath: "/etc/passwd" },
      },
      { type: "tool.finished", projectId: PROJECT_ID, toolUseId: "call_2", ok: false, summary: "Permission denied: external_directory" },
      { type: "tool.denied", projectId: PROJECT_ID, name: "read", reason: "Permission denied: external_directory" },
      { type: "narration", projectId: PROJECT_ID, text: "Two clips found." },
      {
        type: "usage.reported",
        projectId: PROJECT_ID,
        sessionId: RESUMED_SESSION,
        source: "opencode",
        costUsd: 0,
        inputTokens: 2748,
        outputTokens: 396,
        cacheTokens: 3584,
      },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
    ]);
  });

  async function answerTo(action: string, resources: readonly string[], projectDir?: string) {
    const asked = { id: "evt_1", type: "permission.asked", data: { id: "per_1", sessionID: RESUMED_SESSION, action, resources } };
    const { events, calls, stop } = await subscribeWithSession([[sseResponse([asked])]], projectDir);
    await waitFor(() => calls.some((call) => call.url.endsWith("/reply")), 5_000);
    stop();
    const reply = calls.find((call) => call.url.endsWith("/reply"));
    expect(reply?.url).toBe(`${SERVER_URL}/api/session/${RESUMED_SESSION}/permission/per_1/reply`);
    expect(reply?.init?.method).toBe("POST");
    const body = reply?.init?.body;
    const decision: unknown = JSON.parse(typeof body === "string" ? body : "null");
    return { decision, events };
  }

  it("rejects every permission request but a read, and reports the tool as denied", async () => {
    const { decision, events } = await answerTo("bash", ["*"]);
    expect(decision).toEqual({ decision: "reject" });
    expect(events).toContainEqual({ type: "tool.denied", projectId: PROJECT_ID, name: "bash", reason: "bash is not available in ZKidz Studio." });
  });

  it("allows a read of a file in the project once, and only once", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "zks-proj-"));
    await writeFile(join(projectDir, "notes.md"), "hello");
    const { decision, events } = await answerTo("read", [join(projectDir, "notes.md")], projectDir);
    expect(decision).toEqual({ decision: "once" });
    expect(events.filter((event) => event.type === "tool.denied")).toEqual([]);
  });

  it("refuses a read through a symlink in the project that points outside it", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "zks-proj-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "zks-outside-"));
    await writeFile(join(outsideDir, "secret.txt"), "not the project's");
    await symlink(join(outsideDir, "secret.txt"), join(projectDir, "link.txt"));
    const { decision, events } = await answerTo("read", [join(projectDir, "notes.md"), join(projectDir, "link.txt")], projectDir);
    expect(decision).toEqual({ decision: "reject" });
    expect(events).toContainEqual({
      type: "tool.denied",
      projectId: PROJECT_ID,
      name: "read",
      reason: "Read is limited to the project folder and the studio plugin.",
    });
  });

  it("reconnects after the stream drops, without starting the session twice", async () => {
    const connected = { id: "evt_0", type: "server.connected", data: {} };
    const later = { id: "evt_2", type: "session.execution.started", data: { sessionID: RESUMED_SESSION } };
    const { events, calls, stop } = await subscribeWithSession([
      [sseResponse([connected])],
      [new Response("oops", { status: 503 })],
      [sseResponse([connected, later])],
    ]);
    await waitFor(() => events.some((event) => event.type === "terminal.state" && event.state === "working"), 5_000);
    stop();

    // The third stream also ends, so a fourth connection may already be open.
    expect(calls.filter((call) => call.url.endsWith("/api/event")).length).toBeGreaterThanOrEqual(3);
    expect(events.filter((event) => event.type === "session.started")).toHaveLength(1);
  });
});
