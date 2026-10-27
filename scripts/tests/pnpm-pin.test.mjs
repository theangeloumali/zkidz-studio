// Created by The Angelo Umali.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readRepoFile = (/** @type {string} */ name) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const rootManifest = JSON.parse(readRepoFile("package.json"));
const lockfile = readRepoFile("pnpm-lock.yaml");

const packageManagerPin = /^pnpm@(\d+\.\d+\.\d+)\+sha512\.([0-9a-f]{128})$/.exec(rootManifest.packageManager);
const pinnedVersion = packageManagerPin?.[1];

describe("pnpm self-switch pin", () => {
  // Corepack checks this hash; without it the switch trusts whatever the registry serves.
  it("packageManager carries the sha512 of the pinned pnpm tarball", () => {
    expect(packageManagerPin).not.toBeNull();
  });

  // pnpm's own switch ignores that hash and installs the lockfile's integrity-checked pnpm. A `^12` range resolves under the
  // release-age floor to an older pnpm, so the checksummed bootstrap would swap itself for a different binary.
  it("devEngines and the lockfile pin the same pnpm", () => {
    expect(rootManifest.devEngines.packageManager.version).toBe(pinnedVersion);
    const lockedPnpm = /packageManagerDependencies:\n\s+pnpm:\n\s+specifier: (\S+)\n\s+version: (\S+)/.exec(lockfile);
    expect(lockedPnpm?.slice(1)).toEqual([pinnedVersion, pinnedVersion]);
    expect(lockfile).toMatch(new RegExp(`\\n  pnpm@${pinnedVersion}:\\n    resolution: \\{integrity: sha512-`));
  });
});
