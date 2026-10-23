// Created by The Angelo Umali.
import { rules } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { API_ROUTES, RULE_TEXT_MAX_CHARS, RULES_ENABLED_MAX } from "@zks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionFrom, createTestServer, getRequest, insertProject, TEST_HOST, type TestServer } from "../support/test-server.ts";

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});
afterEach(async () => {
  await server.close();
});

function sendJson(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body: unknown = null) {
  const init = { method, headers: { host: TEST_HOST, "content-type": "application/json" }, body: JSON.stringify(body) };
  return server.app.request(path, init, connectionFrom("127.0.0.1"));
}
const rulePath = (ruleId: string) => API_ROUTES.updateRule.path.replace(":ruleId", ruleId);
const settingsPath = (projectId: string) => API_ROUTES.getProjectSettings.path.replace(":projectId", projectId);

async function createRule(text: string, sourceQuote?: string) {
  const response = await sendJson("POST", API_ROUTES.createRule.path, sourceQuote === undefined ? { text } : { text, sourceQuote });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("rules CRUD", () => {
  it("creates a rule from the user's click, trimmed, with the quote it came from", async () => {
    const created = await createRule("  Keep cuts under 60 s  ", "make them all short");

    expect(created.status).toBe(201);
    expect(API_ROUTES.createRule.response.parse(created.body)).toMatchObject({
      text: "Keep cuts under 60 s",
      sourceQuote: "make them all short",
      isEnabled: true,
    });
    const listed = await (await getRequest(server, API_ROUTES.listRules.path)).json();
    expect(API_ROUTES.listRules.response.parse(listed).rules.map((rule) => rule.text)).toEqual(["Keep cuts under 60 s"]);
  });

  it("caps a rule at 500 characters and refuses an empty one or an extra field", async () => {
    expect((await createRule("x".repeat(RULE_TEXT_MAX_CHARS))).status).toBe(201);
    expect((await createRule("x".repeat(RULE_TEXT_MAX_CHARS + 1))).status).toBe(400);
    expect((await createRule("   ")).status).toBe(400);
    expect((await sendJson("POST", API_ROUTES.createRule.path, { text: "ok", isEnabled: false })).status).toBe(400);
    expect(await server.database.db.select().from(rules)).toHaveLength(1);
  });

  it("caps the quote a rule came from like the rule itself", async () => {
    expect((await createRule("Short cuts", "q".repeat(RULE_TEXT_MAX_CHARS))).status).toBe(201);
    expect((await createRule("Short cuts", "q".repeat(RULE_TEXT_MAX_CHARS + 1))).status).toBe(400);
    expect(await server.database.db.select().from(rules)).toHaveLength(1);
  });

  it("refuses a rule past the enabled cap with 409, on create and on re-enable", async () => {
    const created = await createRule("Rule 0");
    await sendJson("PATCH", rulePath(String(created.body.id)), { isEnabled: false });
    await server.database.db.insert(rules).values(Array.from({ length: RULES_ENABLED_MAX }, (_, index) => ({ text: `Rule ${index + 1}` })));

    expect((await createRule("One too many")).status).toBe(409);
    expect((await sendJson("PATCH", rulePath(String(created.body.id)), { isEnabled: true })).status).toBe(409);
    // Turning one off frees the slot.
    const [first] = await server.database.db.select().from(rules).where(eq(rules.text, "Rule 1"));
    await sendJson("PATCH", rulePath(first?.id ?? ""), { isEnabled: false });
    expect((await createRule("Now it fits")).status).toBe(201);
  });

  it("turns a rule off and on, then deletes it", async () => {
    const created = await createRule("Captions in English");
    const ruleId = String(created.body.id);

    const disabled = await sendJson("PATCH", rulePath(ruleId), { isEnabled: false });
    expect(await disabled.json()).toMatchObject({ id: ruleId, isEnabled: false });
    expect(await (await sendJson("DELETE", rulePath(ruleId))).json()).toEqual({ ok: true });
    expect(await server.database.db.select().from(rules)).toEqual([]);
  });

  it("answers 404 for an unknown or malformed rule id", async () => {
    expect((await sendJson("PATCH", rulePath(crypto.randomUUID()), { isEnabled: false })).status).toBe(404);
    expect((await sendJson("DELETE", rulePath("not-a-uuid"))).status).toBe(404);
  });
});

describe("per-project agent settings", () => {
  it("starts at the defaults and keeps a partial update per project", async () => {
    const [edited, untouched] = await Promise.all([insertProject(server), insertProject(server)]);

    expect(await (await getRequest(server, settingsPath(edited.id))).json()).toEqual({ maxTurns: 40, budgetUsd: 5 });
    const updated = await sendJson("PUT", settingsPath(edited.id), { maxTurns: 12 });
    expect(await updated.json()).toEqual({ maxTurns: 12, budgetUsd: 5 });
    expect(await (await getRequest(server, settingsPath(edited.id))).json()).toEqual({ maxTurns: 12, budgetUsd: 5 });
    expect(await (await getRequest(server, settingsPath(untouched.id))).json()).toEqual({ maxTurns: 40, budgetUsd: 5 });
  });

  it("refuses an out-of-range limit and an unknown project", async () => {
    const project = await insertProject(server);

    expect((await sendJson("PUT", settingsPath(project.id), { maxTurns: 0 })).status).toBe(400);
    expect((await sendJson("PUT", settingsPath(project.id), { budgetUsd: -1 })).status).toBe(400);
    expect((await sendJson("PUT", settingsPath(project.id), { model: "opus" })).status).toBe(400);
    expect((await getRequest(server, settingsPath(crypto.randomUUID()))).status).toBe(404);
  });
});
