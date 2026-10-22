// Created by The Angelo Umali.
import os from "node:os";
import { redactText } from "@zks/shared";
import type { ToolName } from "@zks/shared/node";
import { ensureHomeLayout, type ZksContext } from "./context.ts";
import { fetchModel } from "./models.ts";
import { installTool } from "./tools.ts";

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
  log(`setup done: ${downloadCount} download(s)`);
  return downloadCount;
}
