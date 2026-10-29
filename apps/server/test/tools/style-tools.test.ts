// Created by The Angelo Umali.
// set_project_style, and the tools that follow the project's theme once it is set (slice D).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projects } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { anchoredKeyword, callTool, createTranscribedFixture, messageOf } from "./cue-fixtures.ts";
import { argumentAfter, fakeEngine, withEngine } from "./fake-engine.ts";
import { insertReferenceAsset } from "./reference-fixtures.ts";
import { createToolFixture, insertCameraAsset, type ToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

async function storedStyle(fixture: ToolFixture) {
  const [project] = await fixture.context.db.select({ style: projects.style }).from(projects).where(eq(projects.id, fixture.context.projectId));
  return project?.style;
}

async function styleFile(fixture: ToolFixture): Promise<unknown> {
  return JSON.parse(await readFile(join(fixture.projectRoot, "work", "style.json"), "utf8")) as unknown;
}

describe("set_project_style", () => {
  it("stores the style on the project and writes the renderer's look to work/style.json", async () => {
    const fixture = await createToolFixture(server);
    const style = { theme: "zkidz", tokens: { gold: "#ff3366" }, type: { display: "Inter" }, boil: false, sfx: "light", shotLengthS: 2.5 } as const;
    const result = await callTool(fixture, "set_project_style", { style });
    expect(result.isError, messageOf(result)).toBeFalsy();
    expect(result.structuredContent).toEqual({ style, warnings: [] });
    expect(await storedStyle(fixture)).toEqual(style);
    // Only what a page draws with reaches Chrome; pace and sound stay with the agent.
    expect(await styleFile(fixture)).toEqual({ theme: "zkidz", tokens: { gold: "#ff3366" }, type: { display: "Inter" }, boil: false });
  });

  it("drops a token the theme does not have and says so", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_project_style", { style: { theme: "zkidz", tokens: { gold: "#ff3366", sparkle: "#00ff00" } } });
    expect(result.structuredContent).toMatchObject({ style: { theme: "zkidz", tokens: { gold: "#ff3366" } } });
    expect((result.structuredContent as { warnings: string[] }).warnings).toEqual([expect.stringContaining("sparkle")]);
    expect(await storedStyle(fixture)).toEqual({ theme: "zkidz", tokens: { gold: "#ff3366" } });
  });

  it("checks tokens against the chosen theme, minimal included, and project_info then reports it", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_project_style", { style: { theme: "minimal", tokens: { ink: "#101820" } } });
    expect(result.structuredContent).toEqual({ style: { theme: "minimal", tokens: { ink: "#101820" } }, warnings: [] });
    const info = await callTool(fixture, "project_info", {});
    expect(info.structuredContent).toMatchObject({ theme: "minimal" });
  });

  it("refuses a face the renderer does not bundle and stores nothing", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_project_style", { style: { theme: "zkidz", type: { body: "Comic Sans MS" } } });
    expect(result.isError).toBe(true);
    expect(await storedStyle(fixture)).toBeNull();
  });

  it("keeps a reference of this project and drops any other asset id with a warning", async () => {
    const fixture = await createToolFixture(server);
    const reference = await insertReferenceAsset(fixture);
    const kept = await callTool(fixture, "set_project_style", { style: { theme: "zkidz", referenceAssetId: reference.id } });
    expect(kept.structuredContent).toEqual({ style: { theme: "zkidz", referenceAssetId: reference.id }, warnings: [] });

    const footage = await insertCameraAsset(fixture);
    const dropped = await callTool(fixture, "set_project_style", { style: { theme: "zkidz", referenceAssetId: footage.id } });
    expect(dropped.structuredContent).toEqual({ style: { theme: "zkidz" }, warnings: [expect.stringContaining(footage.id)] });
  });
});

describe("the cue tools follow the project's theme", () => {
  const NO_KINDS = { kinds: [] };

  it("list_cue_kinds asks for zkidz with no style and for the style's theme once one is set", async () => {
    const fixture = await createToolFixture(server);
    const { engine, requests } = fakeEngine(() => NO_KINDS);
    const faked = withEngine(fixture, engine);
    await callTool(faked, "list_cue_kinds", {});
    await callTool(faked, "set_project_style", { style: { theme: "minimal" } });
    await callTool(faked, "list_cue_kinds", {});
    expect(requests.map((request) => argumentAfter(request, "--theme"))).toEqual(["zkidz", "minimal"]);
  });

  it("add_cue checks the cue against the style's theme", async () => {
    const fixture = await createTranscribedFixture(server);
    const { engine, requests } = fakeEngine(() => ({ cue: { ...anchoredKeyword(), id: "cue-1" } }));
    const faked = withEngine(fixture, engine);
    await callTool(faked, "set_project_style", { style: { theme: "minimal" } });
    await callTool(faked, "add_cue", { sheet: "main", cue: anchoredKeyword() });
    expect(requests.map((request) => [request.command, argumentAfter(request, "--theme")])).toEqual([["validate-cue", "minimal"]]);
  });
});
