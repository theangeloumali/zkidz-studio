// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { checkUserPath, isWithinDir, UserPathError } from "../src/fs/path-policy.ts";

describe("checkUserPath", () => {
  it("accepts absolute POSIX and drive paths", () => {
    expect(checkUserPath("/home/u/clips/a.mp4")).toBe("/home/u/clips/a.mp4");
    expect(checkUserPath("D:\\Footage\\a.mp4")).toBe("D:\\Footage\\a.mp4");
  });

  it.each([
    ["relative", "clips/a.mp4"],
    ["dot-dot traversal", "/home/u/../etc/passwd"],
    ["URL-decoded traversal", decodeURIComponent("/home/u/%2e%2e/etc")],
    ["still-encoded traversal", "/home/u/%2e%2E/etc"],
    ["half-encoded traversal", "/home/u/.%2e/etc"],
    ["UNC share", "\\\\server\\share\\a.mp4"],
    ["forward-slash UNC", "//server/share/a.mp4"],
    ["device namespace", "\\\\.\\PhysicalDrive0"],
    ["long-path prefix", "\\\\?\\C:\\a.mp4"],
    ["alternate data stream", "C:\\clips\\a.mp4:hidden"],
    ["POSIX colon stream", "/clips/a.mp4:secret"],
    ["reserved CON", "C:\\clips\\CON"],
    ["reserved NUL with extension", "/clips/nul.mp4"],
    ["reserved COM1", "D:\\com1.txt"],
    ["trailing dot", "C:\\clips\\a.mp4."],
    ["trailing space", "/clips/folder /a.mp4"],
    ["NUL byte", "/clips/a\0.mp4"],
    ["empty", ""],
  ])("rejects a %s path", (_label, candidatePath) => {
    expect(() => checkUserPath(candidatePath)).toThrow(UserPathError);
  });
});

describe("isWithinDir", () => {
  it("treats the dir itself and descendants as inside, siblings as outside", () => {
    expect(isWithinDir("/a/b", "/a/b")).toBe(true);
    expect(isWithinDir("/a/b/c", "/a/b")).toBe(true);
    expect(isWithinDir("/a/bc", "/a/b")).toBe(false);
    expect(isWithinDir("/a", "/a/b")).toBe(false);
  });
});
