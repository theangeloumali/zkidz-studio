// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENTRYPOINT = fileURLToPath(new URL("../entrypoint.sh", import.meta.url));
const IMAGE_STORE_LINE = "IMAGE_STORE=/opt/zks";
const shellInstalled = process.platform !== "win32" && spawnSync("sh", ["-c", "true"]).status === 0;

describe.skipIf(!shellInstalled)("docker/entrypoint.sh", () => {
  let fixtureDir = "";
  let imageStore = "";
  let zksHome = "";

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "zks-entrypoint-"));
    imageStore = join(fixtureDir, "image");
    zksHome = join(fixtureDir, "home");
    mkdirSync(join(imageStore, "tools"), { recursive: true });
    mkdirSync(join(imageStore, "models"), { recursive: true });
    mkdirSync(zksHome);
  });
  afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));

  /** Runs the real script against the fixture store; `exec node` becomes `exit 0` so only the linking runs. */
  function runEntrypoint() {
    const source = readFileSync(ENTRYPOINT, "utf8");
    expect(source).toContain(IMAGE_STORE_LINE);
    const script = source.replace(IMAGE_STORE_LINE, `IMAGE_STORE='${imageStore}'`).replace(/^exec node .*$/m, "exit 0");
    return spawnSync("sh", ["-c", script], { encoding: "utf8", env: { ...process.env, ZKS_HOME: zksHome } });
  }

  it("refuses to start and keeps a real tools directory, such as a bind-mounted host ZKS_HOME", () => {
    const sentinel = join(zksHome, "tools", "ffmpeg", "sentinel");
    mkdirSync(join(zksHome, "tools", "ffmpeg"), { recursive: true });
    writeFileSync(sentinel, "host download");
    const result = runEntrypoint();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/is a real directory/);
    expect(readFileSync(sentinel, "utf8")).toBe("host download");
  });

  it("links the image's tools when the volume has none", () => {
    expect(runEntrypoint().status).toBe(0);
    expect(readlinkSync(join(zksHome, "tools"))).toBe(join(imageStore, "tools"));
  });

  it("repoints an older image's tools link at the current image", () => {
    symlinkSync(join(fixtureDir, "old-image-tools"), join(zksHome, "tools"));
    expect(runEntrypoint().status).toBe(0);
    expect(lstatSync(join(zksHome, "tools")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(zksHome, "tools"))).toBe(join(imageStore, "tools"));
  });

  it("links setup models without replacing a model already in the volume", () => {
    writeFileSync(join(imageStore, "models", "tiny.bin"), "image tiny");
    writeFileSync(join(imageStore, "models", "base.bin"), "image base");
    mkdirSync(join(zksHome, "models"));
    writeFileSync(join(zksHome, "models", "base.bin"), "volume base");
    expect(runEntrypoint().status).toBe(0);
    expect(readlinkSync(join(zksHome, "models", "tiny.bin"))).toBe(join(imageStore, "models", "tiny.bin"));
    expect(readFileSync(join(zksHome, "models", "base.bin"), "utf8")).toBe("volume base");
  });
});
