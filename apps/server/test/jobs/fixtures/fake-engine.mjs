// Created by The Angelo Umali.
// Stands in for zks-engine: `env` reports its environment, `hang` starts a grandchild and waits to be killed,
// `stubborn` ignores SIGTERM, `gate` prints the engine's JSON error, `crash` prints a Python-style traceback.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setInterval } from "node:timers";

const [command, , ...commandArgs] = process.argv.slice(2);
const projectPath = join(process.env.ZKS_HOME ?? "", "projects", "demo");
if (command === "env") {
  process.stdout.write(JSON.stringify({ env: process.env, cwd: process.cwd(), argv: process.argv.slice(2) }));
} else if (command === "hang") {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(commandArgs[0], String(grandchild.pid));
  setInterval(() => {}, 1000);
} else if (command === "stubborn") {
  process.on("SIGTERM", () => undefined);
  writeFileSync(commandArgs[0], String(process.pid));
  setInterval(() => {}, 1000);
} else if (command === "gate") {
  process.stderr.write("progress noise\n");
  process.stdout.write(JSON.stringify({ error: { code: "gate_failed", message: `${projectPath} has no QC report` } }));
  process.exit(7);
} else if (command === "crash") {
  const frames = [`  File "${process.argv[1]}", line 12, in main`, `  File "${projectPath}/work/edl.py", line 3, in load`];
  process.stderr.write(
    ["Traceback (most recent call last):", ...frames, `FileNotFoundError: ${projectPath}/work/edl/v1.json from ${process.argv[1]}`, ""].join("\n"),
  );
  process.exit(1);
} else {
  process.stderr.write(`unknown command ${command}`);
  process.exit(2);
}
