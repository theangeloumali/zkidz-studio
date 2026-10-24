// Created by The Angelo Umali.
// A transcribed project and an anchored cue for the cue tool tests; every cue call runs the real engine through uv.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STUDIO_TOOLS_BY_NAME } from "../../src/tools/catalog.ts";
import type { TestServer } from "../support/test-server.ts";
import { createToolFixture, insertCameraAsset, insertTranscript, type ToolFixture } from "./tool-fixtures.ts";

/** uv starts the engine per call, which is slow on a cold cache. */
export const ENGINE_TIMEOUT_MS = 120_000;

const WORDS = [
  { at: 1, end: 1.4, text: "hello" },
  { at: 2, end: 2.4, text: "world" },
  { at: 6, end: 6.4, text: "again" },
];

export function callTool(fixture: ToolFixture, name: string, input: unknown) {
  const studioTool = STUDIO_TOOLS_BY_NAME.get(name);
  if (studioTool === undefined) throw new Error(`no tool ${name}`);
  return studioTool.run(input, fixture.context);
}

/** A keyword landing 0.2 s after "world", its anchor word. */
export function anchoredKeyword(overrides: Record<string, unknown> = {}) {
  return { kind: "keyword", at: 2.2, end: 4, text: "world", anchor: { phrase: "world", wordIndex: 1 }, ...overrides };
}

export async function createTranscribedFixture(server: TestServer): Promise<ToolFixture> {
  const fixture = await createToolFixture(server);
  const asset = await insertCameraAsset(fixture);
  await insertTranscript(fixture, asset.id, WORDS);
  return fixture;
}

export async function readStoredSheet(fixture: ToolFixture, kind = "cues"): Promise<unknown> {
  return JSON.parse(await readFile(join(fixture.projectRoot, "work", kind, "v1.json"), "utf8")) as unknown;
}

export function messageOf(result: { content: unknown }): string {
  return JSON.stringify(result.content);
}
