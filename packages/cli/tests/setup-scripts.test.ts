// Created by The Angelo Umali.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readRepoFile = (name: string) => readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");
const setupSh = readRepoFile("setup.sh");
const setupPs1 = readRepoFile("setup.ps1");
const setupCmd = readRepoFile("setup.cmd");
const packageManager = (JSON.parse(readRepoFile("package.json")) as { packageManager: string }).packageManager;

describe("setup bootstrap scripts", () => {
  // devEngines downloads the packageManager pnpm when the bootstrap differs, bypassing the checksum.
  it("bootstrap the exact pnpm that packageManager pins", () => {
    const pinnedVersion = /^pnpm@([^+]+)/.exec(packageManager)?.[1];
    expect(/^PNPM_VERSION=(\S+)$/m.exec(setupSh)?.[1]).toBe(pinnedVersion);
    expect(/^\$PnpmVersion = '([^']+)'$/m.exec(setupPs1)?.[1]).toBe(pinnedVersion);
  });

  it("install the engine from the lock, failing on drift", () => {
    for (const script of [setupSh, setupPs1]) expect(script).toContain("uv sync --locked --project packages/engine");
  });

  it("keep uv's managed Python and cache under ZKS_HOME", () => {
    expect(setupSh).toMatch(/export UV_PYTHON_INSTALL_DIR="\$\{UV_PYTHON_INSTALL_DIR:-\$ZKS_HOME\/tools\/python\}"/);
    expect(setupSh).toMatch(/export UV_CACHE_DIR="\$\{UV_CACHE_DIR:-\$ZKS_HOME\/cache\/uv\}"/);
    expect(setupPs1).toMatch(/\$env:UV_PYTHON_INSTALL_DIR = Join-Path \$env:ZKS_HOME 'tools\\python'/);
    expect(setupPs1).toMatch(/\$env:UV_CACHE_DIR = Join-Path \$env:ZKS_HOME 'cache\\uv'/);
  });

  // Started from PowerShell 7, powershell.exe inherits its module path and cannot load Get-FileHash (setup-e2e, windows-2025).
  it("start Windows PowerShell with its own module path, scoped to setup.cmd", () => {
    const lines = setupCmd.split(/\r?\n/).filter((line) => !/^@?REM /i.test(line) && line.trim() !== "");
    expect(lines.slice(0, 3)).toEqual(["@setlocal", '@set "PSModulePath="', expect.stringMatching(/^@powershell\.exe /)]);
  });
});
