// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import path from "node:path";
import { isWslDrvfsPath, uvEnvironment } from "../src/platform.ts";

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
