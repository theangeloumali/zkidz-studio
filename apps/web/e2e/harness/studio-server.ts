// Created by The Angelo Umali.
// The studio server as main.ts builds it (onboarding, preview service and preview origin included), on a scratch ZKS_HOME,
// with FakeAgent driving real tools. Run with `node`.
import { rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { defaultZksHome } from "@zks/shared/node";
import { createAgentServices } from "../../../server/src/agent-services.ts";
import { writeConnection } from "../../../server/src/auth/connection-store.ts";
import { createSecretStore } from "../../../server/src/auth/secret-store.ts";
import { createEngineProcessRunner, pinnedEngineTools } from "../../../server/src/jobs/engine-process.ts";
import { DEFAULT_UPLOAD_LIMITS } from "../../../server/src/media-io/store.ts";
import { createDemoRunner } from "../../../server/src/onboarding/demo-runner.ts";
import { createOnboardingServices } from "../../../server/src/onboarding/onboarding-services.ts";
import { createCompositionBuilder, type CompositionBuilder } from "../../../server/src/preview/composition-builder.ts";
import { createPreviewOrigin } from "../../../server/src/preview/preview-origin.ts";
import { createPreviewService } from "../../../server/src/preview/preview-service.ts";
import { createSecurity } from "../../../server/src/security/index.ts";
import { memoryKeyring } from "../../../server/test/auth/memory-keyring.ts";
import { createTestServer } from "../../../server/test/support/test-server.ts";
import { withFrozenMasters } from "./frozen-master-engine.ts";
import { createLiveToolsQuery } from "./live-tools-agent.ts";
import { SERVER_READY_PREFIX } from "../support/ready-line.ts";

const BIND_HOST = "127.0.0.1";
const repoPath = (relativePath: string) => fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url));

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set; playwright.config.ts passes it`);
  return value;
}

/** The engine runs whisper-cli and its models from ZKS_HOME, so the scratch home borrows this machine's `zks setup` install. */
async function linkInstalledTools(studioHome: string): Promise<void> {
  const machineHome = defaultZksHome({ env: process.env, platform: process.platform, homeDir: homedir() });
  for (const dirName of ["tools", "models"]) {
    await rm(join(studioHome, dirName), { recursive: true, force: true });
    await symlink(join(machineHome, dirName), join(studioHome, dirName), "dir");
  }
}

async function startStudioServer(): Promise<void> {
  const port = Number(requiredEnv("ZKS_E2E_PORT"));
  const previewPort = Number(requiredEnv("ZKS_E2E_PREVIEW_PORT"));
  const ffmpegPath = requiredEnv("ZKS_FFMPEG");
  const ffprobePath = join(dirname(ffmpegPath), "ffprobe");
  const frozenMaster = process.env.ZKS_E2E_FROZEN_MASTER === "1";
  const security = createSecurity({ appPort: port, previewPort, container: false });
  let shutdownAgent: (() => void) | undefined;
  let previewBuilder: CompositionBuilder | undefined;
  const server = await createTestServer((base) => {
    const engine = createEngineProcessRunner({
      executable: "uv",
      prefixArgs: ["run", "--project", repoPath("packages/engine"), "zks-engine"],
      studioHome: base.studioHome,
      tools: pinnedEngineTools(process.env, base.studioHome),
    });
    const agent = createAgentServices({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      jobRunner: base.jobRunner,
      logger: base.logger,
      appPort: port,
      appVersion: "0.0.0-e2e",
      pluginDir: repoPath("plugin"),
      runDir: join(base.studioHome, "run"),
      claudePath: null,
      claudeVersion: null,
      // The key never leaves this process: FakeAgent stands in for the SDK.
      secretStore: createSecretStore({
        studioHome: base.studioHome,
        platform: "linux",
        keyring: memoryKeyring("e2e-not-a-key-abcd"),
        readMounts: () => Promise.resolve(""),
      }),
      query: createLiveToolsQuery(frozenMaster ? "render-frozen" : "render-flow"),
      hasSdkBinary: () => true,
      engine: frozenMaster ? withFrozenMasters(engine, ffmpegPath) : engine,
      ffprobePath,
    });
    shutdownAgent = agent.shutdown;
    const onboarding = createOnboardingServices({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      jobRunner: base.jobRunner,
      engine,
      demoRunner: createDemoRunner({ engineDir: repoPath("packages/engine"), demoScript: repoPath("examples/demo/make_demo.py"), studioHome: base.studioHome }),
      ffprobePath,
      uploadLimits: DEFAULT_UPLOAD_LIMITS,
    });
    previewBuilder = createCompositionBuilder({ workerScriptPath: repoPath("packages/engine/hf/preview/worker.js"), studioHome: base.studioHome });
    const previewService = createPreviewService({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      logger: base.logger,
      previewPort,
      buildComposition: previewBuilder,
    });
    return { security, agent, onboarding, previewService, ffprobePath, webDistDir: repoPath("apps/web/dist") };
  });
  await linkInstalledTools(server.studioHome);
  await writeConnection(server.database.db, { mode: "api_key", keyLast4: "abcd" });

  const previewOrigin = createPreviewOrigin({ database: server.database.db, studioHome: server.studioHome, appPort: port, previewPort });
  const previewServer = serve({ fetch: previewOrigin.fetch, hostname: BIND_HOST, port: previewPort });
  const httpServer = serve({ fetch: server.app.fetch, hostname: BIND_HOST, port }, () => {
    process.stdout.write(`${SERVER_READY_PREFIX}${JSON.stringify({ studioHome: server.studioHome })}\n`);
  });
  process.once("SIGTERM", () => {
    shutdownAgent?.();
    previewBuilder?.close();
    previewServer.close();
    httpServer.close(() => void server.close().finally(() => process.exit(0)));
  });
}

await startStudioServer();
