// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import {
  API_ROUTES,
  APP_PORT,
  CSRF_HEADER,
  DecisionRequestSchema,
  EventsQuerySchema,
  HookResponseSchema,
  LastEventIdSchema,
  PREVIEW_PORT,
  PreToolUseHookPayloadSchema,
  RULE_TEXT_MAX_CHARS,
  SSE_REPLAY_LIMIT,
  SUPABASE_DB_PORT,
  TERMINAL_TICKET_TTL_S,
  isStateChangingMethod,
} from "../src/index.ts";
import { PROJECT_ID } from "./fixtures.ts";

describe("API_ROUTES", () => {
  const routes = Object.values(API_ROUTES);

  it("keeps every route under /api/ with a unique method and path", () => {
    const routeKeys = routes.map((route) => `${route.method} ${route.path}`);

    expect(routes.every((route) => route.path.startsWith("/api/"))).toBe(true);
    expect(new Set(routeKeys).size).toBe(routeKeys.length);
  });

  it("has no state-changing GET, and gives every JSON write a body schema or an explicit none", () => {
    for (const route of routes) {
      expect("body" in route).toBe(route.method !== "GET");
    }
  });

  it("serves the event stream as SSE, the terminal as a WebSocket and media as bytes", () => {
    expect(API_ROUTES.events).toMatchObject({ method: "GET", path: "/api/events", response: "sse" });
    expect(API_ROUTES.terminalSocket).toMatchObject({ method: "GET", path: "/api/terminal/:sessionId/ws", response: "websocket" });
    expect(API_ROUTES.streamMedia).toMatchObject({ method: "GET", path: "/api/media/:assetId", response: "binary" });
  });

  it("takes reveal with no client path (plan §9.1)", () => {
    expect(API_ROUTES.revealDeliverables).toMatchObject({ method: "POST", path: "/api/projects/:projectId/reveal", body: null });
  });

  it("caps a rule at 500 characters", () => {
    const createRuleBody = API_ROUTES.createRule.body;

    expect(RULE_TEXT_MAX_CHARS).toBe(500);
    expect(createRuleBody.safeParse({ text: "x".repeat(500) }).success).toBe(true);
    expect(createRuleBody.safeParse({ text: "x".repeat(501) }).success).toBe(false);
  });
});

describe("security constants", () => {
  it("names the app and preview ports and the CSRF header", () => {
    expect(APP_PORT).toBe(4317);
    expect(PREVIEW_PORT).toBe(4318);
    expect(CSRF_HEADER).toBe("x-zks-csrf");
  });

  it("keeps the Supabase port below 49152, outside Hyper-V's shifting reserved ranges (spike 03)", () => {
    expect(SUPABASE_DB_PORT).toBe(45322);
  });

  it("treats every method but GET and HEAD as state-changing", () => {
    expect(isStateChangingMethod("GET")).toBe(false);
    expect(isStateChangingMethod("head")).toBe(false);
    expect(isStateChangingMethod("POST")).toBe(true);
    expect(isStateChangingMethod("DELETE")).toBe(true);
  });
});

describe("SSE contract (plan §8, D3)", () => {
  it("subscribes to one or more projects", () => {
    expect(EventsQuerySchema.safeParse({ project: [PROJECT_ID] }).success).toBe(true);
    expect(EventsQuerySchema.safeParse({ project: [] }).success).toBe(false);
  });

  it("parses a single ?project=<id>, which a query parser hands over as a bare string", () => {
    expect(EventsQuerySchema.parse({ project: PROJECT_ID })).toEqual({ project: [PROJECT_ID] });
    expect(EventsQuerySchema.safeParse({ project: "not-a-uuid" }).success).toBe(false);
  });

  it("parses Last-Event-ID as a positive event id", () => {
    expect(LastEventIdSchema.parse("42")).toBe(42);
    expect(LastEventIdSchema.safeParse("-1").success).toBe(false);
    expect(LastEventIdSchema.safeParse("abc").success).toBe(false);
  });

  it("replays at most 500 events before sending resync", () => {
    expect(SSE_REPLAY_LIMIT).toBe(500);
  });
});

describe("settings (plan §6.5, §6.6)", () => {
  it("returns every setting, typed", () => {
    expect(API_ROUTES.getSettings.response.safeParse({ proxyOptIn: false }).success).toBe(true);
    expect(API_ROUTES.updateSettings.response.safeParse({}).success).toBe(false);
  });

  it("accepts a partial update of known keys", () => {
    expect(API_ROUTES.updateSettings.body.safeParse({ proxyOptIn: true }).success).toBe(true);
    expect(API_ROUTES.updateSettings.body.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown key and a non-boolean proxy opt-in", () => {
    expect(API_ROUTES.updateSettings.body.safeParse({ NODE_EXTRA_CA_CERTS: "/tmp/ca.pem" }).success).toBe(false);
    expect(API_ROUTES.updateSettings.body.safeParse({ proxyOptIn: "true" }).success).toBe(false);
  });
});

describe("decisions", () => {
  it("discriminates approval, question and cut-review answers", () => {
    expect(DecisionRequestSchema.safeParse({ kind: "approval", requestId: "a-1", decision: "allow" }).success).toBe(true);
    expect(DecisionRequestSchema.safeParse({ kind: "question", requestId: "q-1", answers: { "Keep the intro?": "Keep" } }).success).toBe(true);
    expect(DecisionRequestSchema.safeParse({ kind: "cuts", requestId: "c-1", approved: ["cand-1"], rejected: [] }).success).toBe(true);
    expect(DecisionRequestSchema.safeParse({ kind: "approval", requestId: "a-1", decision: "later" }).success).toBe(false);
  });
});

describe("terminal mode contract (plan §6.3)", () => {
  it("issues single-use tickets valid for 30 s", () => {
    expect(TERMINAL_TICKET_TTL_S).toBe(30);
    expect(API_ROUTES.terminalTicket.response.safeParse({ ticket: "t".repeat(43), expiresAt: "2026-10-22T12:00:30.000Z" }).success).toBe(true);
  });

  it("accepts a PreToolUse hook payload with fields it does not know yet", () => {
    const hookPayload = {
      hook_event_name: "PreToolUse",
      session_id: "s-1",
      tool_name: "Read",
      tool_input: { file_path: "a.json" },
      cwd: "/p",
      future_field: 1,
    };

    expect(PreToolUseHookPayloadSchema.safeParse(hookPayload).success).toBe(true);
  });

  it("answers a PreToolUse hook with a permission decision", () => {
    const denyResponse = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Bash is not available" } };

    expect(HookResponseSchema.safeParse(denyResponse).success).toBe(true);
    expect(HookResponseSchema.safeParse({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "maybe" } }).success).toBe(false);
  });
});
