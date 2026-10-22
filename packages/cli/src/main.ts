#!/usr/bin/env node
// Created by The Angelo Umali.
import os from "node:os";
import type { PathRoots } from "@zks/shared";
import { createContext, resolveZksHome } from "./context.ts";
import { doctorExitCode, formatDoctorJson, formatDoctorText, formatFatalError, runDoctor } from "./doctor.ts";
import { fetchModel, listModels } from "./models.ts";
import { runSetup } from "./setup.ts";

const USAGE = "usage: zks setup | zks doctor [--json] [--fetch] | zks models [--json] | zks models fetch <name>";
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
    default:
      console.error(USAGE);
      return EXIT_USAGE;
  }
}

function pathRoots(): PathRoots {
  return { zksHome: resolveZksHome(), homeDir: os.homedir() };
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
