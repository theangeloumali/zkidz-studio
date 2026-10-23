#!/usr/bin/env node
// Created by The Angelo Umali.
import { existsSync } from "node:fs";
import os from "node:os";
import type { PathRoots } from "@zks/shared";
import type { ToolName } from "@zks/shared/node";
import { createContext, resolveZksHome } from "./context.ts";
import { doctorExitCode, formatDoctorJson, formatDoctorText, formatFatalError, runDoctor } from "./doctor.ts";
import { fetchModel, listModels } from "./models.ts";
import { runSetup } from "./setup.ts";
import { toolExecutablePath } from "./tools.ts";

const USAGE = "usage: zks setup | zks doctor [--json] [--fetch] | zks models [--json] | zks models fetch <name> | zks tools path <tool>";
const EXIT_USAGE = 2;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((arg) => arg.startsWith("--")));
  const context = createContext();
  switch (command) {
    case "setup":
      await runSetup(context);
      return 0;
    case "doctor": {
      // --fetch repairs what setup would install, then diagnoses; logs go to stderr so --json stays parseable.
      if (flags.has("--fetch")) await runSetup(context, (line) => console.error(line));
      const checks = await runDoctor(context);
      const roots = pathRoots();
      console.log(flags.has("--json") ? formatDoctorJson(checks, roots) : formatDoctorText(checks, roots));
      return doctorExitCode(checks);
    }
    case "models":
      return runModels(context, rest, flags.has("--json"));
    case "tools":
      return printToolPath(context, rest);
    default:
      console.error(USAGE);
      return EXIT_USAGE;
  }
}

function pathRoots(): PathRoots {
  return { zksHome: resolveZksHome(), homeDir: os.homedir() };
}

/** For CI and the server to hand the engine the pinned build (ZKS_FFMPEG, ZKS_CHROME) instead of one found on PATH. */
function printToolPath(context: ReturnType<typeof createContext>, args: string[]): number {
  const [action, name] = args;
  if (action !== "path" || !name || !isToolName(context, name)) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const executable = toolExecutablePath(context, name);
  if (!executable || !existsSync(executable)) {
    console.error(`${name} is not installed at ${executable ?? "its pinned location"}. Run: pnpm zks setup`);
    return 1;
  }
  console.log(executable);
  return 0;
}

function isToolName(context: ReturnType<typeof createContext>, name: string): name is ToolName {
  return Object.hasOwn(context.lock.tools, name);
}

async function runModels(context: ReturnType<typeof createContext>, args: string[], asJson: boolean): Promise<number> {
  const [action, name] = args.filter((arg) => !arg.startsWith("--"));
  if (action === "fetch") {
    if (!name) throw new Error(USAGE);
    const { downloaded } = await fetchModel(context, name);
    console.log(`${name} ${downloaded ? "installed" : "present"}`);
    return 0;
  }
  const models = listModels(context);
  if (asJson) console.log(JSON.stringify(models, null, 2));
  else for (const model of models) console.log(`${model.installed ? "installed" : "missing  "} ${model.name.padEnd(22)} ${model.sizeMb} MB`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const asJson = process.argv.includes("--json");
  (asJson ? console.log : console.error)(formatFatalError(error, { asJson, roots: pathRoots() }));
  process.exitCode = 1;
}
