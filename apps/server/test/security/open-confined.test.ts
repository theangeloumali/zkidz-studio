// Created by The Angelo Umali.
import type { FileHandle } from "node:fs/promises";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Runs inside openConfined's open(), i.e. after the realpath check: the window an attacker races.
let swapBeforeOpen: (() => Promise<void>) | null = null;
let swapAfterOpen: (() => Promise<void>) | null = null;
const openedHandles: FileHandle[] = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const realFs = await importOriginal<typeof import("node:fs/promises")>();
  const racingOpen: typeof realFs.open = async (...openArgs) => {
    await swapBeforeOpen?.();
    const handle = await realFs.open(...openArgs);
    openedHandles.push(handle);
    await swapAfterOpen?.();
    return handle;
  };
  return { ...realFs, open: racingOpen };
});

const { createSecurity, PathEscapeError } = await import("../../src/security/index.ts");
const { openConfined } = createSecurity({ appPort: 4317, previewPort: 4318, container: false });
const isWindows = process.platform === "win32";

let sandboxDir = "";
let rootDir = "";
let outsideDir = "";

beforeEach(async () => {
  sandboxDir = await realpath(await mkdtemp(join(tmpdir(), "zks-open-confined-")));
  rootDir = join(sandboxDir, "root");
  outsideDir = join(sandboxDir, "outside");
  await mkdir(join(rootDir, "media"), { recursive: true });
  await mkdir(outsideDir);
  await writeFile(join(rootDir, "media", "clip.mp4"), "inside");
  await writeFile(join(outsideDir, "clip.mp4"), "secret");
});

afterEach(async () => {
  swapBeforeOpen = null;
  swapAfterOpen = null;
  openedHandles.length = 0;
  await rm(sandboxDir, { recursive: true, force: true });
});

async function swapMediaDirForOutsideLink() {
  await rename(join(rootDir, "media"), join(rootDir, "media-original"));
  await symlink(outsideDir, join(rootDir, "media"), isWindows ? "junction" : "dir");
}

async function restoreMediaDir() {
  await rm(join(rootDir, "media"), { recursive: true, force: true });
  await rename(join(rootDir, "media-original"), join(rootDir, "media"));
}

async function rejectionOf(candidatePath: string): Promise<InstanceType<typeof PathEscapeError>> {
  const rejection: unknown = await openConfined(rootDir, candidatePath).catch((error: unknown) => error);
  expect(rejection).toBeInstanceOf(PathEscapeError);
  // A rejected open must not leak the descriptor it raced onto.
  expect(openedHandles.every((handle) => handle.fd === -1)).toBe(true);
  return rejection as InstanceType<typeof PathEscapeError>;
}

describe("openConfined", () => {
  it("opens a file inside the root and returns its realpath", async () => {
    const confined = await openConfined(rootDir, "media/clip.mp4");
    try {
      expect(confined.realPath).toBe(join(rootDir, "media", "clip.mp4"));
      expect(await confined.handle.readFile("utf8")).toBe("inside");
    } finally {
      await confined.handle.close();
    }
  });

  it("rejects a directory swapped for an outside symlink between check and open", async () => {
    swapBeforeOpen = swapMediaDirForOutsideLink;
    expect((await rejectionOf("media/clip.mp4")).reason).toBe("outside-root");
  });

  it("rejects a swap that is put back before the post-open check", async () => {
    swapBeforeOpen = swapMediaDirForOutsideLink;
    swapAfterOpen = restoreMediaDir;
    expect((await rejectionOf("media/clip.mp4")).reason).toBe("changed-during-open");
    expect(await readFile(join(rootDir, "media", "clip.mp4"), "utf8")).toBe("inside");
  });

  it("rejects the file itself swapped for an outside symlink between check and open", async () => {
    swapBeforeOpen = async () => {
      await rm(join(rootDir, "media", "clip.mp4"));
      await symlink(join(outsideDir, "clip.mp4"), join(rootDir, "media", "clip.mp4"));
    };
    // O_NOFOLLOW refuses the link where the OS has it; elsewhere the post-open realpath lands outside.
    await rejectionOf("media/clip.mp4");
  });

  it("rejects a directory, since only regular files are served", async () => {
    expect((await rejectionOf("media")).reason).toBe("not-a-file");
  });

  it("keeps every lexical and containment check of confinePath", async () => {
    expect((await rejectionOf("../outside/clip.mp4")).reason).toBe("parent-segment");
    expect((await rejectionOf(join(outsideDir, "clip.mp4"))).reason).toBe("outside-root");
    expect(openedHandles).toHaveLength(0);
  });
});
