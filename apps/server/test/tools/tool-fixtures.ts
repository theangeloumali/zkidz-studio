// Created by The Angelo Umali.
// A migrated test server, a project with its folders and a ToolContext over them.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaAssets, transcripts } from "@zks/db/schema";
import type { StudioEvent } from "@zks/shared";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createEngineProcessRunner } from "../../src/jobs/engine-process.ts";
import type { ApprovalCard, AskedQuestions, QuestionAnswers, ToolContext } from "../../src/tools/context.ts";
import type { TranscriptWord } from "../../src/tools/transcript-store.ts";
import { insertProject, type TestServer } from "../support/test-server.ts";

const ENGINE_DIR = fileURLToPath(new URL("../../../../packages/engine", import.meta.url));
// Cue checks spawn neither ffmpeg nor Chrome; absent paths make any step that would fail loudly, never fall back to PATH.
const NO_RENDER_TOOLS = { ffmpegPath: join(ENGINE_DIR, "no-ffmpeg-in-tool-tests"), chromePath: join(ENGINE_DIR, "no-chrome-in-tool-tests") };

export interface ToolFixture {
  readonly context: ToolContext;
  readonly projectRoot: string;
  readonly events: StudioEvent[];
  readonly approvalCards: ApprovalCard[];
  readonly approvalSignals: (AbortSignal | undefined)[];
  readonly askedQuestions: AskedQuestions[];
}

export async function createToolFixture(
  server: TestServer,
  decide: (card: ApprovalCard, signal?: AbortSignal) => Promise<"allow" | "deny"> = () => Promise.resolve("deny"),
  answer: (questions: AskedQuestions) => Promise<QuestionAnswers | null> = () => Promise.resolve(null),
) {
  const project = await insertProject(server);
  await createProjectDirs(server.studioHome, project.slug);
  const events: StudioEvent[] = [];
  server.eventBus.subscribe([project.id], (event) => events.push(event));
  const approvalCards: ApprovalCard[] = [];
  const approvalSignals: (AbortSignal | undefined)[] = [];
  const askedQuestions: AskedQuestions[] = [];
  const context: ToolContext = {
    projectId: project.id,
    studioHome: server.studioHome,
    db: server.database.db,
    events: server.eventBus,
    jobs: server.jobRunner,
    // The real engine, as main.ts runs it, so cue checks are the engine's own (plan §7.7).
    engine: createEngineProcessRunner({
      executable: "uv",
      prefixArgs: ["run", "--project", ENGINE_DIR, "zks-engine"],
      studioHome: server.studioHome,
      tools: NO_RENDER_TOOLS,
    }),
    requestApproval: (card, signal) => {
      approvalCards.push(card);
      approvalSignals.push(signal);
      return decide(card, signal);
    },
    askQuestions: (questions) => {
      askedQuestions.push(questions);
      return answer(questions);
    },
  };
  return { context, projectRoot: projectDir(server.studioHome, project.slug), events, approvalCards, approvalSignals, askedQuestions } satisfies ToolFixture;
}

export async function insertCameraAsset(fixture: ToolFixture, durationS = 30) {
  const relPath = `media/raw/${crypto.randomUUID()}.mp4`;
  await mkdir(dirname(join(fixture.projectRoot, relPath)), { recursive: true });
  await writeFile(join(fixture.projectRoot, relPath), "not really video");
  const [asset] = await fixture.context.db
    .insert(mediaAssets)
    .values({ projectId: fixture.context.projectId, kind: "camera", name: "clip.mp4", relPath, bytes: 16, mtimeMs: 0, durationS, fpsNum: 30000, fpsDen: 1001 })
    .returning();
  if (asset === undefined) throw new Error("asset insert returned no row");
  return asset;
}

export async function insertTranscript(fixture: ToolFixture, mediaAssetId: string, words: readonly TranscriptWord[]) {
  const wordsRelPath = "work/transcripts/v1.words.json";
  await mkdir(dirname(join(fixture.projectRoot, wordsRelPath)), { recursive: true });
  await writeFile(join(fixture.projectRoot, wordsRelPath), JSON.stringify(words));
  await fixture.context.db
    .insert(transcripts)
    .values({ projectId: fixture.context.projectId, mediaAssetId, model: "base", language: "en", wordsRelPath, wordCount: words.length });
}

export function cutSpecFor(sourceAssetId: string, removals: readonly Record<string, unknown>[] = []) {
  return { schemaVersion: 1, sourceAssetId, durationS: 30, fps: { num: 30000, den: 1001 }, removals };
}

// What ffprobe reports for the joined source the fake engine writes.
export const JOINED_SOURCE_PROBE = {
  formatName: "matroska,webm",
  kind: "camera" as const,
  durationS: 30,
  width: 2160,
  height: 3840,
  fps: { num: 30, den: 1 },
  rotation: 0,
  isHdr: false,
  colorTransfer: "bt709",
  videoCodec: "hevc",
  audioCodec: "flac",
};
