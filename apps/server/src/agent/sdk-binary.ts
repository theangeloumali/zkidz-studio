// Created by The Angelo Umali.
// Whether the SDK's bundled claude binary is installed (plan §6.7). Without it query() throws, so the studio runs `claude -p`.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

export interface BinaryProbe {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Resolves a package subpath from the SDK's own location, as the SDK does; throws when it is not installed. */
  readonly resolve: (specifier: string) => string;
  readonly exists: (path: string) => boolean;
}

export function hasBundledClaudeBinary(probe: BinaryProbe = installedProbe()): boolean {
  const binaryName = probe.platform === "win32" ? "claude.exe" : "claude";
  return binaryPackages(probe).some((packageName) => {
    try {
      return probe.exists(probe.resolve(`${packageName}/${binaryName}`));
    } catch {
      return false;
    }
  });
}

/** The SDK 0.3 candidates. On linux it takes the first that exists, whichever libc, so any match here is what it spawns. */
function binaryPackages({ platform, arch }: BinaryProbe): string[] {
  if (platform === "android") return [`${SDK_PACKAGE}-linux-${arch}-android`];
  if (platform !== "linux") return [`${SDK_PACKAGE}-${platform}-${arch}`];
  return [`${SDK_PACKAGE}-linux-${arch}`, `${SDK_PACKAGE}-linux-${arch}-musl`];
}

function installedProbe(): BinaryProbe {
  const sdkRequire = createRequire(import.meta.resolve(SDK_PACKAGE));
  return { platform: process.platform, arch: process.arch, resolve: (specifier) => sdkRequire.resolve(specifier), exists: existsSync };
}
