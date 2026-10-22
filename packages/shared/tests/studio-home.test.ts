// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { defaultZksHome, ZKS_HOME_DIRS } from "../src/studio-home.ts";

describe("defaultZksHome", () => {
  it("prefers ZKS_HOME", () => {
    expect(defaultZksHome({ env: { ZKS_HOME: "/data/zks" }, platform: "linux", homeDir: "/home/u" })).toBe("/data/zks");
  });

  it("follows each platform's per-user data folder (plan §3.3)", () => {
    expect(defaultZksHome({ env: {}, platform: "linux", homeDir: "/home/u" })).toBe("/home/u/.local/share/zkidz-studio");
    expect(defaultZksHome({ env: { XDG_DATA_HOME: "/x" }, platform: "linux", homeDir: "/home/u" })).toBe("/x/zkidz-studio");
    expect(defaultZksHome({ env: {}, platform: "darwin", homeDir: "/Users/u" })).toBe("/Users/u/Library/Application Support/zkidz-studio");
    expect(defaultZksHome({ env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, platform: "win32", homeDir: "C:\\Users\\u" })).toBe(
      "C:\\Users\\u\\AppData\\Local\\zkidz-studio",
    );
    expect(defaultZksHome({ env: {}, platform: "win32", homeDir: "C:\\Users\\u" })).toBe("C:\\Users\\u\\AppData\\Local\\zkidz-studio");
  });

  it("lists the one home layout both the CLI and the server create", () => {
    expect(ZKS_HOME_DIRS).toEqual(["db", "backups", "tools", "models", "locks", "projects"]);
  });
});
