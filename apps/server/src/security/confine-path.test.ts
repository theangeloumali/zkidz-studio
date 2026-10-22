// Created by The Angelo Umali.
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecurity, PathEscapeError, type PathEscapeReason } from "./index.ts";

const { confinePath } = createSecurity({ appPort: 4317, previewPort: 4318, container: false });
const isWindows = process.platform === "win32";

let sandboxDir = "";
let rootDir = "";
let siblingDir = "";

beforeAll(async () => {
  sandboxDir = await realpath(await mkdtemp(join(tmpdir(), "zks-confine-")));
  rootDir = join(sandboxDir, "projects", "a");
  // Shares the root's name as a prefix: a bare startsWith check would let it through.
  siblingDir = join(sandboxDir, "projects", "a-evil");
  await mkdir(join(rootDir, "media"), { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await writeFile(join(rootDir, "media", "clip.mp4"), "clip");
  await writeFile(join(siblingDir, "secret.txt"), "secret");
  await writeFile(join(sandboxDir, "outside.txt"), "outside");
  await symlink(join(sandboxDir, "outside.txt"), join(rootDir, "media", "escape-file"));
  await symlink(siblingDir, join(rootDir, "escape-dir"), isWindows ? "junction" : "dir");
  await symlink(join(rootDir, "media", "clip.mp4"), join(rootDir, "inside-link"));
});

afterAll(async () => {
  await rm(sandboxDir, { recursive: true, force: true });
});

async function expectEscape(candidatePath: string, reason: PathEscapeReason) {
  const rejection: unknown = await confinePath(rootDir, candidatePath).catch((error: unknown) => error);
  expect(rejection).toBeInstanceOf(PathEscapeError);
  expect((rejection as PathEscapeError).reason).toBe(reason);
}

describe("confinePath accepts paths inside the root", () => {
  it("resolves a relative path to its realpath", async () => {
    expect(await confinePath(rootDir, "media/clip.mp4")).toBe(join(rootDir, "media", "clip.mp4"));
  });

  it("resolves an absolute path inside the root", async () => {
    expect(await confinePath(rootDir, join(rootDir, "media", "clip.mp4"))).toBe(join(rootDir, "media", "clip.mp4"));
  });

  it("returns the root itself", async () => {
    expect(await confinePath(rootDir, ".")).toBe(rootDir);
  });

  it("follows a symlink that stays inside the root", async () => {
    expect(await confinePath(rootDir, "inside-link")).toBe(join(rootDir, "media", "clip.mp4"));
  });

  it("accepts a root given through a symlinked or unnormalised path", async () => {
    expect(await confinePath(join(rootDir, "media", ".."), "media/clip.mp4")).toBe(join(rootDir, "media", "clip.mp4"));
  });
});

describe("confinePath rejects traversal (plan §9.4)", () => {
  it.each<[string, string, PathEscapeReason]>([
    ["a parent segment", "../a-evil/secret.txt", "parent-segment"],
    ["a parent segment that lands back inside", "media/../media/clip.mp4", "parent-segment"],
    ["a backslash parent segment", "..\\a-evil\\secret.txt", "parent-segment"],
    ["a URL-encoded parent segment", "%2e%2e/a-evil/secret.txt", "encoded-sequence"],
    ["a URL-encoded upper-case separator", "..%2Fa-evil%2Fsecret.txt", "encoded-sequence"],
    ["a URL-encoded backslash", "..%5ca-evil%5csecret.txt", "encoded-sequence"],
    ["a double-encoded parent segment", "%252e%252e/a-evil/secret.txt", "encoded-sequence"],
    ["a NUL byte", "media/clip.mp4\0.txt", "nul-byte"],
    ["an encoded NUL byte", "media/clip.mp4%00.txt", "encoded-sequence"],
  ])("rejects %s", async (_label, candidatePath, reason) => {
    await expectEscape(candidatePath, reason);
  });

  it("rejects an absolute path in a sibling that shares the root's prefix", async () => {
    await expectEscape(join(siblingDir, "secret.txt"), "outside-root");
  });

  it("rejects an absolute path outside the root", async () => {
    await expectEscape(join(sandboxDir, "outside.txt"), "outside-root");
  });

  it("rejects a symlinked file that points outside the root", async () => {
    await expectEscape("media/escape-file", "outside-root");
  });

  it("rejects a symlinked directory or junction that points outside the root", async () => {
    await expectEscape("escape-dir/secret.txt", "outside-root");
  });

  it("rejects a sibling whose name differs from the root only in case", async () => {
    const mixedCaseRoot = join(sandboxDir, "CaseRoot");
    const lowerCaseSibling = join(sandboxDir, "caseroot");
    await mkdir(mixedCaseRoot);
    // Case-insensitive volumes cannot hold both names; there the two are one directory and nothing can escape.
    const hasDistinctSibling = await mkdir(lowerCaseSibling).then(
      () => true,
      () => false,
    );
    if (!hasDistinctSibling) return;
    await writeFile(join(lowerCaseSibling, "secret.txt"), "secret");
    await expect(confinePath(mixedCaseRoot, join(lowerCaseSibling, "secret.txt"))).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("rejects a path that does not exist, since its realpath cannot be proven", async () => {
    await expectEscape("media/missing.mp4", "unresolvable");
  });
});

describe("confinePath rejects Windows path forms on every OS", () => {
  it.each<[string, string, PathEscapeReason]>([
    ["a UNC path", "\\\\attacker\\share\\clip.mp4", "windows-path-form"],
    ["a forward-slash UNC path", "//attacker/share/clip.mp4", "windows-path-form"],
    ["a device path", "\\\\.\\PhysicalDrive0", "windows-path-form"],
    ["a long-path prefix", "\\\\?\\C:\\Windows\\win.ini", "windows-path-form"],
    ["a foreign drive letter", "C:\\Windows\\win.ini", isWindows ? "outside-root" : "windows-path-form"],
    ["a drive-relative path", "C:secret.txt", "windows-path-form"],
    ["an alternate data stream", "media/clip.mp4:hidden", "windows-path-form"],
    ["an alternate data stream with a type", "media/clip.mp4::$DATA", "windows-path-form"],
    ["the reserved name CON", "CON", "reserved-name"],
    ["the reserved name NUL with an extension", "media/nul.mp4", "reserved-name"],
    ["the reserved name COM1 in lower case", "com1", "reserved-name"],
    ["the reserved name LPT9", "media/LPT9.txt", "reserved-name"],
    ["the reserved name AUX before a trailing space", "AUX .txt", "reserved-name"],
    ["a trailing dot", "media/clip.mp4.", "trailing-dot-or-space"],
    ["a trailing space", "media/clip.mp4 ", "trailing-dot-or-space"],
    ["a directory segment with a trailing dot", "media./clip.mp4", "trailing-dot-or-space"],
  ])("rejects %s", async (_label, candidatePath, reason) => {
    await expectEscape(candidatePath, reason);
  });

  it("keeps a drive-letter root allowed when the root itself is on that drive", async () => {
    // Only meaningful on Windows, where rootDir starts with a drive letter.
    if (!isWindows) return;
    expect(await confinePath(rootDir, join(rootDir, "media", "clip.mp4"))).toBe(join(rootDir, "media", "clip.mp4"));
  });
});

describe("PathEscapeError", () => {
  it("never echoes either path in its message", async () => {
    const rejection: unknown = await confinePath(rootDir, join(siblingDir, "secret.txt")).catch((error: unknown) => error);
    expect((rejection as PathEscapeError).message).not.toContain(sandboxDir);
  });
});
