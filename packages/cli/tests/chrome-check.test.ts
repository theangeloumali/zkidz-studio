// Created by The Angelo Umali.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadToolsLock } from "@zks/shared/node";
import { afterEach, describe, expect, it } from "vitest";
import { checkChromeRender } from "../src/checks.ts";
import type { ZksContext } from "../src/context.ts";

// Behaves like Chrome on Ubuntu 23.10+, where AppArmor blocks the sandbox: it only draws with --no-sandbox.
const SANDBOX_BLOCKED_CHROME = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes("--no-sandbox")) { console.error("FATAL: No usable sandbox!"); process.exit(1); }
const target = args.find((arg) => arg.startsWith("--screenshot=")).slice("--screenshot=".length);
require("node:fs").writeFileSync(target, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
`;

let scratchDir = "";
afterEach(() => {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  scratchDir = "";
});

describe("checkChromeRender", () => {
  it.skipIf(process.platform === "win32")("launches Chrome with the renderer's flags, so a host without a usable sandbox still passes", () => {
    scratchDir = mkdtempSync(path.join(tmpdir(), "zks-chrome-"));
    const chromePath = path.join(scratchDir, "chrome-headless-shell");
    writeFileSync(chromePath, SANDBOX_BLOCKED_CHROME);
    chmodSync(chromePath, 0o755);
    const context: ZksContext = { home: scratchDir, toolsDir: scratchDir, modelsDir: scratchDir, platform: "linux-x64", lock: loadToolsLock() };

    expect(checkChromeRender(context, chromePath)).toMatchObject({ id: "chrome", status: "ok" });
  });
});
