// Created by The Angelo Umali.
// The style the user picks through PUT /api/style is the one the next session's prompt carries, in both agent modes.
import { API_ROUTES } from "@zks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UPLOAD_LIMITS } from "../../src/media-io/store.ts";
import { createOnboardingServices } from "../../src/onboarding/onboarding-services.ts";
import { DEFAULT_PRESETS_DIR, loadPresets } from "../../src/onboarding/presets.ts";
import { loadRulesPromptBlock, loadSessionSetup } from "../../src/rules/session-setup.ts";
import { connectionFrom, createTestServer, insertProject, TEST_HOST, type TestServer } from "../support/test-server.ts";

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer((base) => ({
    onboarding: createOnboardingServices({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      jobRunner: base.jobRunner,
      demoRunner: { run: () => Promise.reject(new Error("no demo in this test")) },
      ffprobePath: "ffprobe",
      uploadLimits: DEFAULT_UPLOAD_LIMITS,
    }),
  }));
});
afterEach(async () => {
  await server.close();
});

async function shippedGuidance(styleId: string) {
  const style = (await loadPresets(DEFAULT_PRESETS_DIR)).styles.find((candidate) => candidate.id === styleId);
  if (style === undefined) throw new Error(`no shipped style ${styleId}`);
  return `Style preset (${style.name}): ${style.guidance}`;
}

describe("house style in the session prompt", () => {
  it("carries the ZKidz guidance before the user picks a style", async () => {
    const project = await insertProject(server);
    const setup = await loadSessionSetup(server.database.db, project.id);

    expect(setup.systemPromptAppend).toContain(await shippedGuidance("zkidz"));
  });

  it("carries the style saved through the style route, the same text in terminal mode", async () => {
    const project = await insertProject(server);
    const init = { method: "PUT", headers: { host: TEST_HOST, "content-type": "application/json" }, body: JSON.stringify({ styleId: "plain" }) };
    expect((await server.app.request(API_ROUTES.setStyle.path, init, connectionFrom("127.0.0.1"))).status).toBe(200);

    const setup = await loadSessionSetup(server.database.db, project.id);
    expect(setup.systemPromptAppend).toContain(await shippedGuidance("plain"));
    expect(setup.systemPromptAppend).not.toContain("Style preset (ZKidz)");
    expect(await loadRulesPromptBlock(server.database.db)).toBe(setup.systemPromptAppend);
  });
});
