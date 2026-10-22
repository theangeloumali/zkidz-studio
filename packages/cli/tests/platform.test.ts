// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import path from "node:path";
import { defaultZksHome, isWslDrvfsPath, platformKey, uvEnvironment } from "../src/platform.ts";

describe("platformKey", () => {
  it.each([
    ["linux", "x64", "linux-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["win32", "x64", "win-x64"],
    ["win32", "arm64", "win-arm64"],
    ["darwin", "arm64", "mac-arm64"],
  ] as const)("%s/%s maps to %s", (nodePlatform, arch, expected) => {
    expect(platformKey(nodePlatform, arch)).toBe(expected);
  });

  it("rejects an unsupported pair with the supported list", () => {
    expect(() => platformKey("darwin", "x64")).toThrow(/mac-arm64/);
  });
});

describe("defaultZksHome", () => {
  it("prefers ZKS_HOME", () => {
    expect(defaultZksHome({ env: { ZKS_HOME: "/data/zks" }, nodePlatform: "linux", homeDir: "/home/u" })).toBe("/data/zks");
  });

  it("follows XDG on Linux", () => {
    expect(defaultZksHome({ env: {}, nodePlatform: "linux", homeDir: "/home/u" })).toBe("/home/u/.local/share/zkidz-studio");
    expect(defaultZksHome({ env: { XDG_DATA_HOME: "/x" }, nodePlatform: "linux", homeDir: "/home/u" })).toBe("/x/zkidz-studio");
  });

  it("uses Application Support on macOS and LOCALAPPDATA on Windows", () => {
    expect(defaultZksHome({ env: {}, nodePlatform: "darwin", homeDir: "/Users/u" })).toBe("/Users/u/Library/Application Support/zkidz-studio");
    expect(defaultZksHome({ env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, nodePlatform: "win32", homeDir: "C:\\Users\\u" })).toMatch(
      /AppData[\\/]Local[\\/]zkidz-studio$/,
    );
  });
});

describe("isWslDrvfsPath", () => {
  it("flags Windows drives mounted under /mnt only", () => {
    expect(isWslDrvfsPath("/mnt/c/Users/u/media")).toBe(true);
    expect(isWslDrvfsPath("/mnt/wsl/x")).toBe(false);
    expect(isWslDrvfsPath("/home/u/media")).toBe(false);
  });
});

describe("uvEnvironment", () => {
  it("keeps uv's managed Python and cache under ZKS_HOME", () => {
    expect(uvEnvironment("/data/zks", {})).toEqual({
      UV_PYTHON_INSTALL_DIR: path.join("/data/zks", "tools", "python"),
      UV_CACHE_DIR: path.join("/data/zks", "cache", "uv"),
    });
  });

  it("leaves a location the user already chose", () => {
    expect(uvEnvironment("/data/zks", { UV_CACHE_DIR: "/fast/uv" }).UV_CACHE_DIR).toBe("/fast/uv");
  });
});
