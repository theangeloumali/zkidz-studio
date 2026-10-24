// Created by The Angelo Umali.
import os from "node:os";
import { redactText } from "@zks/shared";
import type { ToolName } from "@zks/shared/node";
import { writeCapabilities } from "./capabilities.ts";
import { ensureHomeLayout, type ZksContext } from "./context.ts";
import { runCommand, type CommandRunner } from "./exec.ts";
import { fetchModel } from "./models.ts";
import { installTool, toolExecutablePath } from "./tools.ts";

const SETUP_TOOLS: readonly ToolName[] = ["ffmpeg", "whisper-cpp", "chrome-headless-shell"];

/** Idempotent: a second run verifies what is there and downloads nothing. Returns the number of downloads. */
export async function runSetup(context: ZksContext, log: (line: string) => void = console.log): Promise<number> {
  ensureHomeLayout(context);
  log(redactText(`ZKS_HOME ${context.home} (${context.platform})`, { homeDir: os.homedir() }));
  let downloadCount = 0;
  for (const name of SETUP_TOOLS) {
    const status = await installTool(context, name);
    if (status === "installed") downloadCount += 1;
    log(`${name.padEnd(22)} ${status}`);
  }
  for (const [name, model] of Object.entries(context.lock.models).filter(([, pin]) => pin.fetchOnSetup)) {
    const { downloaded } = await fetchModel(context, name);
    if (downloaded) downloadCount += 1;
    log(`${`model ${name}`.padEnd(22)} ${downloaded ? "installed" : "present"} (${model.file})`);
  }
  recordCapabilities(context, log);
  log(`setup done: ${downloadCount} download(s)`);
  return downloadCount;
}

/** Last, after the tools and the engine venv (setup.sh syncs it first): get_capabilities works from the first start. */
export function recordCapabilities(context: ZksContext, log: (line: string) => void, run: CommandRunner = runCommand, uv?: string): void {
  const ffmpegPath = toolExecutablePath(context, "ffmpeg");
  if (!ffmpegPath) throw new Error("ffmpeg has no pinned build for this platform");
  const check = writeCapabilities(context, ffmpegPath, run, uv);
  if (check.status === "fail") throw new Error(`${check.detail}${check.fix ? ` (${check.fix})` : ""}`);
  log(`${"capabilities".padEnd(22)} ${check.detail}`);
}
