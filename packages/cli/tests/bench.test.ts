// Created by The Angelo Umali.
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { benchServer, bundleIsStale, parseRssKb, type ServerBench } from "../src/bench-server.ts";
import { benchEncoders, budgetStatus, buildBenchReport, formatBenchJson, formatBenchText } from "../src/bench.ts";
import { reportRoots } from "../src/doctor.ts";
import type { CommandRunner } from "../src/exec.ts";

const ENCODER_LISTING = [
  " V....D hevc_nvenc  NVIDIA NVENC hevc encoder",
  " V....D hevc_qsv  HEVC (Intel Quick Sync Video)",
  " V....D libx264  libx264 H.264",
].join("\n");

describe("parseRssKb", () => {
  it("reads VmRSS from /proc/<pid>/status on Linux", () => {
    expect(parseRssKb("linux", "Name:\tnode\nVmPeak:\t  900000 kB\nVmRSS:\t  204800 kB\nThreads:\t11\n")).toBe(204_800);
  });

  it("reads the kilobyte column ps prints on macOS", () => {
    expect(parseRssKb("darwin", "  51200\n")).toBe(51_200);
  });

  it("reads the memory column of tasklist CSV on Windows, thousands separators included", () => {
    expect(parseRssKb("win32", '"node.exe","4242","Console","1","153,600 K"\r\n')).toBe(153_600);
  });

  it("returns undefined for output it cannot read", () => {
    expect(parseRssKb("linux", "")).toBeUndefined();
    expect(parseRssKb("win32", "INFO: No tasks are running which match the specified criteria.")).toBeUndefined();
  });
});

describe("bundleIsStale", () => {
  it("rebuilds when the bundle is missing or older than any input, and reuses it otherwise", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "zks-bundle-"));
    try {
      const bundle = path.join(root, "dist", "main.mjs");
      const source = path.join(root, "src", "nested", "a.ts");
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, "");
      const inputs = [path.join(root, "src"), path.join(root, "missing.lock")];
      expect(bundleIsStale(bundle, inputs)).toBe(true);
      mkdirSync(path.dirname(bundle));
      writeFileSync(bundle, "");
      utimesSync(source, new Date(1_000_000), new Date(1_000_000));
      expect(bundleIsStale(bundle, inputs)).toBe(false);
      utimesSync(source, new Date(), new Date(Date.now() + 60_000));
      expect(bundleIsStale(bundle, inputs)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("budgetStatus", () => {
  it("passes at or under the budget and warns over it", () => {
    expect(budgetStatus(600, 600)).toBe("pass");
    expect(budgetStatus(601, 600)).toBe("warn");
    expect(budgetStatus(undefined, 600)).toBe("warn");
  });
});

describe("benchEncoders", () => {
  it("times only the encoders that pass a test encode, as frames per second", () => {
    const calls: string[][] = [];
    const run: CommandRunner = (_command, args) => {
      calls.push(args);
      const encoder = args[args.indexOf("-c:v") + 1] ?? "";
      return { code: encoder === "hevc_qsv" ? 1 : 0, stdout: "", stderr: "" };
    };
    let tick = 0;
    const results = benchEncoders("ffmpeg", ENCODER_LISTING, run, () => (tick += 500));
    expect(results.map(({ encoder }) => encoder)).toEqual(["hevc_nvenc", "libx264"]);
    expect(results[0]).toMatchObject({ backend: "nvidia", frames: 120, fps: 240 });
    const timed = calls.filter((args) => args.includes("-frames:v"));
    expect(timed).toHaveLength(2);
    expect(timed[0]).toEqual(expect.arrayContaining(["testsrc2=size=1920x1080:rate=30", "-frames:v", "120"]));
  });
});

describe("bench report", () => {
  const server: ServerBench = { status: "ok", firstStartMs: 4300, readyMs: 850, idleRssMb: 212, peakRssMb: 480 };
  const encoders = [{ backend: "nvidia" as const, encoder: "hevc_nvenc", frames: 120, seconds: 0.4, fps: 300 }];

  it("compares the server against the plan §9.5 budgets", () => {
    const report = buildBenchReport(server, encoders);
    expect(report.server).toMatchObject({
      firstStartMs: 4300,
      readyMs: 850,
      readyBudgetMs: 2000,
      ready: "pass",
      idleRssMb: 212,
      idleRssBudgetMb: 600,
      idleRss: "pass",
      peakRssMb: 480,
    });
    expect(buildBenchReport({ status: "ok", readyMs: 2600, idleRssMb: 700 }, encoders).server).toMatchObject({ ready: "warn", idleRss: "warn" });
    expect(report).toMatchObject({ schema: 1, ok: true, encoders: [{ encoder: "hevc_nvenc", fps: 300 }] });
  });

  it("is not ok when the server never became ready", () => {
    const report = buildBenchReport({ status: "fail", error: "exited with code 1" }, encoders);
    expect(report.ok).toBe(false);
    expect(report.server).toMatchObject({ status: "fail", ready: "warn", idleRss: "warn" });
  });

  // Hardware reports are posted publicly: nothing in them may name the machine or the person.
  it("leaves no hostname, username, home path, scratch path or IP address in --json output", () => {
    const { username } = os.userInfo();
    const scratch = `${os.tmpdir()}/zks-bench-AbC123`;
    const leaky: ServerBench = {
      status: "fail",
      error: `listen EADDRINUSE 203.0.113.7:4318 on ${os.hostname()} by ${username} in ${scratch}/db and ${os.homedir()}/repo`,
    };
    const json = formatBenchJson(buildBenchReport(leaky, encoders), reportRoots(scratch));
    for (const identifying of [os.hostname(), username, os.homedir(), scratch, "203.0.113.7"]) expect(json).not.toContain(identifying);
    const parsed = JSON.parse(json) as { machine: { os: string }; server: { error: string } };
    expect(parsed.server.error).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    // The kernel release is a version by key, even when it looks like an address (WSL's 6.18.33.2).
    expect(parsed).toMatchObject({ schema: 1, machine: { platform: process.platform, arch: process.arch, os: os.release() } });
  });

  it("prints each measurement next to its budget in text mode", () => {
    const text = formatBenchText(buildBenchReport(server, encoders));
    expect(text).toMatch(/first start\s+4300 ms \(creates the home, no budget\)/);
    expect(text).toMatch(/ready\s+850 ms \(budget 2000 ms\) pass/);
    expect(text).toMatch(/idle RSS\s+212 MB \(budget 600 MB\) pass, startup peak 480 MB/);
    expect(text).toMatch(/hevc_nvenc\s+300 fps/);
  });
});

// The server's startup check needs ffprobe beside a real ffmpeg, so this runs only when one is handed in.
const BENCH_FFMPEG = process.env.ZKS_BENCH_FFMPEG;
describe.skipIf(!BENCH_FFMPEG || !existsSync(BENCH_FFMPEG))("benchServer", () => {
  it("boots the server twice on a scratch ZKS_HOME, measures the warm start and removes the scratch home", { timeout: 240_000 }, async () => {
    const result = await benchServer({ ffmpegPath: BENCH_FFMPEG ?? "", settleMs: 1500 });
    expect(result, result.error).toMatchObject({ status: "ok" });
    expect(result.firstStartMs).toBeGreaterThan(0);
    expect(result.readyMs).toBeGreaterThan(0);
    expect(result.idleRssMb).toBeGreaterThan(10);
    expect(result.peakRssMb).toBeGreaterThanOrEqual(result.idleRssMb ?? Infinity);
    expect(existsSync(result.scratchHome ?? "")).toBe(false);
  });
});
