// Created by The Angelo Umali.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editGate, editGateKey } from "../../src/jobs/edit-gate.ts";
import type { EngineRequest } from "../../src/tools/engine-jobs.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { callTool, messageOf } from "./cue-fixtures.ts";
import { fakeEngine, insertInPlaceAsset, withEngine } from "./fake-engine.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset, type ToolFixture } from "./tool-fixtures.ts";

const STILL_DIR = "stills/v1+v1-cc.hf";
const pngBytes = (at: number) => Buffer.from(`png at ${at}`);

let server: TestServer;
let originalsDir: string;
beforeAll(async () => {
  server = await createTestServer();
  originalsDir = await mkdtemp(join(tmpdir(), "zks-originals-"));
});
afterAll(async () => {
  await server.close();
  await rm(originalsDir, { recursive: true, force: true });
});

/** Writes one PNG per --at under work/, as render-preview does, and reports their work-relative paths. */
async function renderStills(request: EngineRequest): Promise<unknown> {
  const times = request.args.flatMap((arg, index) => (request.args[index - 1] === "--at" ? [Number(arg)] : []));
  await mkdir(join(request.workDir, STILL_DIR), { recursive: true });
  const stills = await Promise.all(
    (times.length === 0 ? [0] : times).map(async (at) => {
      const path = `${STILL_DIR}/t${at}.png`;
      await writeFile(join(request.workDir, path), pngBytes(at));
      return { at, path };
    }),
  );
  return { stills };
}

async function editedFixture(fixture: ToolFixture, sourceAssetId: string): Promise<void> {
  expect((await callTool(fixture, "set_cuts", { cuts: cutSpecFor(sourceAssetId) })).isError).toBeUndefined();
}

describe("render_preview", () => {
  it("renders stills of the cut spec's source and attaches each as a PNG image block", async () => {
    const { engine, requests } = fakeEngine(renderStills);
    const fixture = withEngine(await createToolFixture(server), engine);
    const asset = await insertCameraAsset(fixture);
    await editedFixture(fixture, asset.id);

    const result = await callTool(fixture, "render_preview", { at: [1.5, 4], guides: true });
    expect(result.structuredContent).toEqual({
      stills: [
        { at: 1.5, path: `work/${STILL_DIR}/t1.5.png` },
        { at: 4, path: `work/${STILL_DIR}/t4.png` },
      ],
    });
    expect(result.content.slice(1)).toEqual([
      { type: "image", data: pngBytes(1.5).toString("base64"), mimeType: "image/png" },
      { type: "image", data: pngBytes(4).toString("base64"), mimeType: "image/png" },
    ]);
    expect(requests[0]).toMatchObject({
      command: "render-preview",
      args: ["--video", "v1", "--source", join(fixture.projectRoot, asset.relPath ?? ""), "--at", "1.5", "--at", "4", "--guides"],
      workDir: join(fixture.projectRoot, "work"),
      inPlacePaths: [],
    });
  });

  it("lets the engine pick the moments when none are asked for, and registers an in-place source", async () => {
    const { engine, requests } = fakeEngine(renderStills);
    const fixture = withEngine(await createToolFixture(server), engine);
    const asset = await insertInPlaceAsset(fixture, originalsDir);
    await editedFixture(fixture, asset.id);
    expect((await callTool(fixture, "render_preview", {})).isError).toBeUndefined();
    expect(requests[0]).toMatchObject({ args: ["--video", "v1", "--source", asset.inPlacePath], inPlacePaths: [asset.inPlacePath] });
  });

  it("refuses before any cut spec exists", async () => {
    const { engine, requests } = fakeEngine(renderStills);
    const fixture = withEngine(await createToolFixture(server), engine);
    const result = await callTool(fixture, "render_preview", {});
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/set_cuts first/);
    expect(requests).toEqual([]);
  });

  // Review (Kai, Codex): the preview's edit stage rewrites work/edl/<v>.json and the edit's audio, which render jobs read.
  it("refuses while a render job reads the edit, before the engine runs", async () => {
    const { engine, requests } = fakeEngine(renderStills);
    const fixture = withEngine(await createToolFixture(server), engine);
    await editedFixture(fixture, (await insertCameraAsset(fixture)).id);
    let finishRender: () => void = () => undefined;
    const rendering = editGate.whileReading(editGateKey(fixture.context.projectId, "v1"), () => new Promise<void>((resolve) => (finishRender = resolve)));
    const result = await callTool(fixture, "render_preview", { at: [1] });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/preview once it finishes/);
    expect(requests).toEqual([]);
    finishRender();
    await rendering;
    expect((await callTool(fixture, "render_preview", { at: [1] })).isError).toBeUndefined();
  });

  it("refuses a still that is a link out of the project", async () => {
    const outside = join(originalsDir, "secret.png");
    await writeFile(outside, "not yours");
    const fixture = withEngine(
      await createToolFixture(server),
      fakeEngine(async (request) => {
        await mkdir(join(request.workDir, STILL_DIR), { recursive: true });
        await symlink(outside, join(request.workDir, STILL_DIR, "t1.png"));
        return { stills: [{ at: 1, path: `${STILL_DIR}/t1.png` }] };
      }).engine,
    );
    await editedFixture(fixture, (await insertCameraAsset(fixture)).id);
    await expect(callTool(fixture, "render_preview", { at: [1] })).rejects.toThrow();
  });

  it("refuses a still the engine reports outside the work folder", async () => {
    const fixture = withEngine(await createToolFixture(server), fakeEngine(() => ({ stills: [{ at: 1, path: "../../escape.png" }] })).engine);
    await editedFixture(fixture, (await insertCameraAsset(fixture)).id);
    await expect(callTool(fixture, "render_preview", { at: [1] })).rejects.toThrow(/outside the project/);
  });
});
