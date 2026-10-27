// Created by The Angelo Umali.
// A recording EngineRunner for tool tests that check the argv a handler builds and how it reads the report.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaAssets } from "@zks/db/schema";
import type { EngineRequest, EngineRunner } from "../../src/tools/engine-jobs.ts";
import type { ToolFixture } from "./tool-fixtures.ts";

export interface FakeEngine {
  readonly engine: EngineRunner;
  readonly requests: EngineRequest[];
}

export function fakeEngine(reply: (request: EngineRequest) => unknown): FakeEngine {
  const requests: EngineRequest[] = [];
  const engine: EngineRunner = {
    run: async (request) => {
      requests.push(request);
      return await reply(request);
    },
  };
  return { engine, requests };
}

/** The fixture with its engine swapped, so a handler's engine call is recorded instead of spawned. */
export function withEngine(fixture: ToolFixture, engine: EngineRunner): ToolFixture {
  return { ...fixture, context: { ...fixture.context, engine } };
}

export function argumentAfter(request: EngineRequest | undefined, flag: string): string | undefined {
  if (request === undefined) return undefined;
  const index = request.args.indexOf(flag);
  return index === -1 ? undefined : request.args[index + 1];
}

/** A clip registered in place: the user's own file, outside the project folder. */
export async function insertInPlaceAsset(fixture: ToolFixture, originalDir: string) {
  await mkdir(originalDir, { recursive: true });
  const inPlacePath = join(originalDir, `${crypto.randomUUID()}.mp4`);
  await writeFile(inPlacePath, "the user's original");
  const [asset] = await fixture.context.db
    .insert(mediaAssets)
    .values({
      projectId: fixture.context.projectId,
      kind: "camera",
      name: "original.mp4",
      inPlacePath,
      bytes: 19,
      mtimeMs: 0,
      durationS: 30,
      fpsNum: 30,
      fpsDen: 1,
    })
    .returning();
  if (asset === undefined) throw new Error("in-place asset insert returned no row");
  return { ...asset, inPlacePath };
}
