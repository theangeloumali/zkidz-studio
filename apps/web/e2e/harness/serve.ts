// Created by The Angelo Umali.
// E2E server, built as main.ts builds it: the real app and spec routes behind Kai's createSecurity, the real preview
// service running the engine's preview build, and the real 4318 preview origin. Only /__control/* is test-only: it plays
// the agent's side (tool calls) so a spec can drive the studio without a live Claude.
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Cue, CutSpec, StudioEvent } from "@zks/shared";
import { createCompositionBuilder } from "../../../server/src/preview/composition-builder.ts";
import { createPreviewOrigin } from "../../../server/src/preview/preview-origin.ts";
import { createPreviewService } from "../../../server/src/preview/preview-service.ts";
import { createSecurity } from "../../../server/src/security/index.ts";
import { STUDIO_TOOLS_BY_NAME } from "../../../server/src/tools/catalog.ts";
import type { ToolContext } from "../../../server/src/tools/context.ts";
import { loadProject } from "../../../server/src/tools/project-files.ts";
import { readCurrentSpec, writeAgentSpec } from "../../../server/src/tools/spec-store.ts";
import { createTestServer } from "../../../server/test/support/test-server.ts";
import { createToolFixture, insertCameraAsset, insertTranscript, type ToolFixture } from "../../../server/test/tools/tool-fixtures.ts";
import { CUE_CALL_TEXT, HOSTILE_CUE_TEXT, REPLAY_CALL_COUNT, SEEDED_REMOVALS, STUTTER_WORDS, TIMELINE_ITEM_COUNT, type HarnessProject } from "./script.ts";

const LOOPBACK = "127.0.0.1";
const PREVIEW_WORKER_SCRIPT = fileURLToPath(new URL("../../../../packages/engine/hf/preview/worker.js", import.meta.url));
const SOURCE_DURATION_S = 30;
const BULK_SOURCE_DURATION_S = 600;
const appPort = Number(process.env["ZKS_E2E_PORT"]);
const previewPort = Number(process.env["ZKS_E2E_PREVIEW_PORT"]);

interface ReviewedCandidate {
  readonly id: string;
  readonly at: number;
  readonly end: number;
}

const security = createSecurity({ appPort, previewPort, container: false });
const server = await createTestServer((base) => ({
  security: { middleware: security.middleware, confinePath: security.confinePath },
  webDistDir: join(import.meta.dirname, "../../dist"),
  previewService: createPreviewService({
    database: base.database.db,
    studioHome: base.studioHome,
    eventBus: base.eventBus,
    logger: base.logger,
    previewPort,
    buildComposition: createCompositionBuilder({ workerScriptPath: PREVIEW_WORKER_SCRIPT, studioHome: base.studioHome }),
  }),
}));
const previewOrigin = createPreviewOrigin({ database: server.database.db, studioHome: server.studioHome, appPort, previewPort });

/** A real, decodable proxy (VP9 in MP4, which Chrome for Testing plays) so the player's videos load and play. */
function writeProxyVideo(fixture: ToolFixture, relPath: string, durationS: number): void {
  const ffmpeg = process.env["ZKS_FFMPEG"];
  if (ffmpeg === undefined) throw new Error("ZKS_FFMPEG is not set; playwright.config.ts resolves it");
  const testPattern = `testsrc2=size=180x320:rate=30000/1001:duration=${durationS}`;
  const encode = ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "150k", "-pix_fmt", "yuv420p"];
  execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", testPattern, ...encode, "-movflags", "+faststart", join(fixture.projectRoot, relPath)]);
}

async function createVideoProject(durationS: number) {
  const fixture = await createToolFixture(server);
  const asset = await insertCameraAsset(fixture, durationS);
  if (asset.relPath === null) throw new Error("camera asset has no file");
  writeProxyVideo(fixture, asset.relPath, durationS);
  return { fixture, asset };
}

function cutSpec(sourceAssetId: string, removals: CutSpec["removals"], durationS = SOURCE_DURATION_S): CutSpec {
  return { schemaVersion: 1, sourceAssetId, durationS, fps: { num: 30000, den: 1001 }, removals };
}

async function callTool(context: ToolContext, name: string, input: unknown) {
  const tool = STUDIO_TOOLS_BY_NAME.get(name);
  if (tool === undefined) throw new Error(`unknown tool ${name}`);
  return tool.run(input, context);
}

const { fixture, asset } = await createVideoProject(SOURCE_DURATION_S);
const { context } = fixture;
await insertTranscript(fixture, asset.id, STUTTER_WORDS);
const { videoId } = await loadProject(context);
for (const removals of SEEDED_REMOVALS) await callTool(context, "set_cuts", { cuts: cutSpec(asset.id, removals) });

const bulk = await createVideoProject(BULK_SOURCE_DURATION_S);
const bulkCueSpacingS = BULK_SOURCE_DURATION_S / TIMELINE_ITEM_COUNT;
const bulkCues: Cue[] = Array.from({ length: TIMELINE_ITEM_COUNT }, (_, index) => ({
  id: `bulk-${index}`,
  kind: "keyword",
  at: index * bulkCueSpacingS,
  end: index * bulkCueSpacingS + bulkCueSpacingS * 0.8,
  text: `Cue ${index}`,
}));
const bulkVideoId = (await loadProject(bulk.fixture.context)).videoId;
await writeAgentSpec(bulk.fixture.context, { videoId: bulkVideoId, kind: "cuts" }, cutSpec(bulk.asset.id, [], BULK_SOURCE_DURATION_S));
await writeAgentSpec(bulk.fixture.context, { videoId: bulkVideoId, kind: "cues" }, bulkCues);

const versionOf = (kind: "cuts" | "cues") =>
  fixture.events.reduce((latest, event) => (event.type === "spec.version" && event.kind === kind ? Math.max(latest, event.version) : latest), 0);

// The agent's side of the replay: even steps cut, odd steps add a cue.
async function replayStep(stepIndex: number) {
  if (stepIndex % 2 === 0) {
    const removalStartS = 15 + (stepIndex % 10);
    const removal = { at: removalStartS, end: removalStartS + 0.5 + stepIndex / 100, reason: `replay ${stepIndex}` };
    await callTool(context, "set_cuts", { cuts: cutSpec(asset.id, [removal]) });
  } else {
    const cues = ((await readCurrentSpec(context, { videoId, kind: "cues" })) as Cue[] | undefined) ?? [];
    const atS = 5 + (stepIndex % 9);
    const cue: Cue = { id: `replay-${stepIndex}`, kind: "comment", at: atS, end: atS + 1, text: `${CUE_CALL_TEXT} ${stepIndex}` };
    await writeAgentSpec(context, { videoId, kind: "cues" }, [...cues, cue]);
  }
  return { cuts: versionOf("cuts"), cues: versionOf("cues") };
}

/** add_cue through the engine's own checks, anchored on "today"; a second call finds the first cue. */
async function addHostileCue() {
  const cues = ((await readCurrentSpec(context, { videoId, kind: "cues" })) as Cue[] | undefined) ?? [];
  if (cues.some((cue) => cue.id === "hostile")) return { cues: versionOf("cues") };
  const cue = { id: "hostile", kind: "comment", at: 1.2, end: 3, text: HOSTILE_CUE_TEXT, anchor: { phrase: "today", wordIndex: 2 } };
  const result = await callTool(context, "add_cue", { sheet: "main", cue });
  if (result.isError === true) throw new Error(`add_cue refused the hostile cue: ${JSON.stringify(result.content)}`);
  return { cues: versionOf("cues") };
}

let pendingProposal: ReturnType<typeof callTool> | undefined;

function proposeCuts() {
  const proposed = new Promise<StudioEvent>((resolve) => {
    const unsubscribe = server.eventBus.subscribe([context.projectId], (event) => {
      if (event.type !== "cuts.proposed") return;
      unsubscribe();
      resolve(event);
    });
  });
  pendingProposal = callTool(context, "propose_cuts", {});
  return proposed;
}

/** A sloppy agent first names every candidate; set_cuts must refuse that, then the approved set is written. */
async function applyReviewedCuts() {
  const review = await pendingProposal;
  const { candidates = [], approved = [] } = (review?.structuredContent ?? {}) as { candidates?: ReviewedCandidate[]; approved?: string[] };
  const removalOf = (candidate: ReviewedCandidate) => ({ at: candidate.at, end: candidate.end, reason: "review", fromCandidate: candidate.id });
  const sloppyAttempt = await callTool(context, "set_cuts", { cuts: cutSpec(asset.id, candidates.map(removalOf)) });
  const reviewedRemovals = candidates.filter((candidate) => approved.includes(candidate.id)).map(removalOf);
  const reviewed = await callTool(context, "set_cuts", { cuts: cutSpec(asset.id, reviewedRemovals) });
  return { isSloppyAttemptRefused: sloppyAttempt.isError === true, isReviewedWritten: reviewed.isError !== true };
}

const harnessProject: HarnessProject = {
  projectId: context.projectId,
  videoId,
  replayCallCount: REPLAY_CALL_COUNT,
  bulkProjectId: bulk.fixture.context.projectId,
};
const CONTROL_ROUTES: Record<string, (url: URL) => Promise<unknown>> = {
  "/__control/project": () => Promise.resolve(harnessProject),
  "/__control/replay": (url) => replayStep(Number(url.searchParams.get("step"))),
  "/__control/hostile-cue": () => addHostileCue(),
  "/__control/propose": () => proposeCuts(),
  "/__control/apply-reviewed": () => applyReviewedCuts(),
};

// @hono/node-server is not a web dependency, so each Hono app gets a minimal node:http bridge carrying getConnInfo's `incoming`.
async function serveHono(fetchApp: typeof server.app.fetch, incoming: IncomingMessage, outgoing: ServerResponse) {
  const headers = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index] ?? "", incoming.rawHeaders[index + 1] ?? "");
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const requestInit: RequestInit & { duplex: "half" } = {
    method: incoming.method ?? "GET",
    headers,
    body: hasBody ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>) : null,
    duplex: "half",
  };
  const response = await fetchApp(new Request(`http://${incoming.headers.host ?? LOOPBACK}${incoming.url ?? "/"}`, requestInit), { incoming });
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body === null) return void outgoing.end();
  const reader = response.body.getReader();
  outgoing.on("close", () => void reader.cancel().catch(() => undefined));
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) outgoing.write(chunk.value);
  outgoing.end();
}

async function serveApp(incoming: IncomingMessage, outgoing: ServerResponse) {
  const url = new URL(incoming.url ?? "/", `http://${LOOPBACK}`);
  const control = CONTROL_ROUTES[url.pathname];
  if (control === undefined) return serveHono(server.app.fetch, incoming, outgoing);
  outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await control(url)));
}

function failRequest(outgoing: ServerResponse, error: unknown) {
  console.error(error);
  if (!outgoing.headersSent) outgoing.writeHead(500);
  outgoing.end();
}

createServer((incoming, outgoing) => void serveApp(incoming, outgoing).catch((error: unknown) => failRequest(outgoing, error))).listen(appPort, LOOPBACK);
createServer((incoming, outgoing) => void serveHono(previewOrigin.fetch, incoming, outgoing).catch((error: unknown) => failRequest(outgoing, error))).listen(
  previewPort,
  LOOPBACK,
);
const shutdown = () => void server.close().finally(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log(`e2e studio on http://${LOOPBACK}:${appPort}, preview origin on http://${LOOPBACK}:${previewPort}`);
