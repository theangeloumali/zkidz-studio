// Created by The Angelo Umali.
// Entry point: open ZKS_HOME and the database, refuse a non-loopback bind, recover dead jobs, then serve.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { serve } from "@hono/node-server";
import { openDatabase } from "@zks/db";
import { LOOPBACK_HOST, PREVIEW_PORT } from "@zks/shared";
import { WebSocketServer } from "ws";
import { createAgentServices } from "./agent-services.ts";
import { createApp } from "./app.ts";
import { createOsKeyringEntry, createSecretStore } from "./auth/secret-store.ts";
import { assertFfprobeInstalled, ensureStudioHome, loadServerConfig } from "./config.ts";
import { createCliDoctorRunner } from "./doctor/runner.ts";
import { EventBus } from "./events/event-bus.ts";
import { JobRunner } from "./jobs/job-runner.ts";
import { createLogger } from "./logging/logger.ts";
import { DEFAULT_UPLOAD_LIMITS, removeStaleParts } from "./media-io/store.ts";
import { createDemoRunner } from "./onboarding/demo-runner.ts";
import { createOnboardingServices } from "./onboarding/onboarding-services.ts";
import { createSecurity } from "./security/index.ts";
import { readClaudeVersion, resolveClaudePath } from "./terminal/claude-binary.ts";
import { clearSessionFiles } from "./terminal/session-files.ts";
import { createCliEngineRunner } from "./tools/index.ts";

const WEB_DIST_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));
const PLUGIN_DIR = fileURLToPath(new URL("../../../plugin", import.meta.url));
const ENGINE_DIR = fileURLToPath(new URL("../../../packages/engine", import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL("../../../packages/cli/src/main.ts", import.meta.url));
const DEMO_SCRIPT = fileURLToPath(new URL("../../../examples/demo/make_demo.py", import.meta.url));
const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);
/** Plan §6.3: a terminal frame is keystrokes or a resize, never bulk data. */
const WS_MAX_PAYLOAD_BYTES = 256 * 1024;
/** Inside the container the port mapping is the loopback boundary (plan §3.4). */
const CONTAINER_BIND_HOST = "0.0.0.0";

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadServerConfig(process.env);
  const security = createSecurity({ appPort: config.port, previewPort: PREVIEW_PORT, container: config.isContainer });
  const bindHost = config.isContainer ? CONTAINER_BIND_HOST : LOOPBACK_HOST;
  security.assertLoopbackBind(bindHost);
  await assertFfprobeInstalled(config.ffprobePath);

  await ensureStudioHome(config.studioHome);
  await removeStaleParts(config.studioHome);
  const database = await openDatabase({ dataDir: join(config.studioHome, "db"), databaseUrl: config.databaseUrl });
  await database.migrate();
  const eventBus = new EventBus(database.db);
  const jobRunner = new JobRunner({ database: database.db, eventBus, logger });
  const interruptedJobs = await jobRunner.recoverInterrupted();
  if (interruptedJobs > 0) logger.warn("marked jobs from a previous run as interrupted", { count: interruptedJobs });

  // ASSUMPTION: ZKS_RUN is <ZKS_HOME>/run. Files left there belong to sessions that died with the last server.
  const runDir = join(config.studioHome, "run");
  await clearSessionFiles(runDir);
  const claudePath = await resolveClaudePath(process.env);
  const agent = createAgentServices({
    database: database.db,
    studioHome: config.studioHome,
    eventBus,
    jobRunner,
    logger,
    appPort: config.port,
    appVersion: await readAppVersion(),
    pluginDir: PLUGIN_DIR,
    runDir,
    claudePath,
    claudeVersion: await readClaudeVersion(claudePath),
    secretStore: createSecretStore({ studioHome: config.studioHome, platform: process.platform, keyring: createOsKeyringEntry() }),
    query,
    engine: createCliEngineRunner({ executable: "uv", prefixArgs: ["run", "--project", ENGINE_DIR, "zks-engine"], studioHome: config.studioHome }),
  });

  const demoRunner = createDemoRunner({ engineDir: ENGINE_DIR, demoScript: DEMO_SCRIPT, studioHome: config.studioHome });
  const onboarding = createOnboardingServices({ database: database.db, studioHome: config.studioHome, eventBus, jobRunner, demoRunner });

  const app = createApp({
    database: database.db,
    studioHome: config.studioHome,
    security,
    eventBus,
    ffprobePath: config.ffprobePath,
    uploadLimits: DEFAULT_UPLOAD_LIMITS,
    webDistDir: WEB_DIST_DIR,
    logger,
    agent,
    runDoctor: createCliDoctorRunner({ cliEntry: CLI_ENTRY, studioHome: config.studioHome }),
    onboarding,
  });
  const websocket = { server: new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES }) };
  const server = serve({ fetch: app.fetch, hostname: bindHost, port: config.port, websocket }, (address) => {
    logger.info("studio server listening", { host: bindHost, port: address.port, backend: database.backend, agentRunner: agent.agentRunner });
  });

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    agent.shutdown();
    server.close(() => {
      void jobRunner
        .idle()
        .then(() => database.close())
        .finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function readAppVersion(): Promise<string> {
  const manifest: unknown = JSON.parse(await readFile(PACKAGE_JSON_URL, "utf8"));
  return typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string" ? manifest.version : "0.0.0";
}

main().catch((error: unknown) => {
  createLogger().error("studio server failed to start", { error });
  process.exitCode = 1;
});
