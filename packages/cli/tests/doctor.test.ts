// Created by The Angelo Umali.
import os, { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDisk, encodersCheck } from "../src/checks.ts";
import { doctorExitCode, formatDoctorJson, formatFatalError, reportRoots, type CheckResult } from "../src/doctor.ts";
import type { CommandRunner } from "../src/exec.ts";
import { listsEncoder, probeEveryEncoder } from "../src/gpu.ts";

const ENCODER_LISTING = [
  " V....D hevc_nvenc  NVIDIA NVENC hevc encoder",
  " V....D hevc_vaapi  H.265/HEVC (VAAPI)",
  " V....D libx265  libx265 H.265 / HEVC",
].join("\n");

function fakeRunner(passingEncoders: string[], calls: string[][] = []): CommandRunner {
  return (_command, args) => {
    calls.push(args);
    const encoder = args[args.indexOf("-c:v") + 1] ?? "";
    return { code: passingEncoders.includes(encoder) ? 0 : 1, stdout: "", stderr: "" };
  };
}

describe("listsEncoder", () => {
  it("matches a whole encoder name in ffmpeg -encoders, not a prefix", () => {
    const listing = " V....D hevc_nvenc  NVIDIA NVENC H.265 encoder\n V....D libx265  libx265 H.265 / HEVC";
    expect(listsEncoder(listing, "hevc_nvenc")).toBe(true);
    expect(listsEncoder(listing, "hevc")).toBe(false);
    expect(listsEncoder(listing, "hevc_qsv")).toBe(false);
  });
});

describe("probeEveryEncoder", () => {
  // --render: a renderer may pick any listed encoder, so each one gets its own test encode.
  it("test-encodes every listed encoder instead of stopping at the first pass", () => {
    const attempts = probeEveryEncoder("ffmpeg", ENCODER_LISTING, fakeRunner(["hevc_nvenc", "libx265"]));
    expect(attempts).toEqual([
      { backend: "nvidia", encoder: "hevc_nvenc", ok: true },
      { backend: "vaapi", encoder: "hevc_vaapi", ok: false },
      { backend: "cpu", encoder: "libx265", ok: true },
    ]);
  });

  it("uploads frames to the render node for VAAPI", () => {
    const calls: string[][] = [];
    probeEveryEncoder("ffmpeg", ENCODER_LISTING, fakeRunner([], calls));
    const vaapiCall = calls.find((args) => args.includes("hevc_vaapi"));
    expect(vaapiCall).toEqual(expect.arrayContaining(["-vaapi_device", "/dev/dri/renderD128", "format=nv12,hwupload"]));
  });

  it("skips encoders the build does not list", () => {
    const calls: string[][] = [];
    probeEveryEncoder("ffmpeg", ENCODER_LISTING, fakeRunner([], calls));
    expect(calls.some((args) => args.includes("hevc_qsv"))).toBe(false);
  });
});

describe("encodersCheck", () => {
  it("passes when any encoder works and lists the ones that do", () => {
    const check = encodersCheck([
      { backend: "nvidia", encoder: "hevc_nvenc", ok: true },
      { backend: "qsv", encoder: "hevc_qsv", ok: false },
    ]);
    expect(check).toMatchObject({ id: "encoders", status: "ok", required: false, detail: "1 of 2 listed encoders work: hevc_nvenc" });
  });

  it("fails, without failing doctor, when no listed encoder works", () => {
    expect(encodersCheck([{ backend: "cpu", encoder: "libx264", ok: false }])).toMatchObject({ status: "fail", required: false });
  });
});

describe("doctor report", () => {
  const ok: CheckResult = { id: "node", status: "ok", required: true, detail: "v24.11.0" };

  it("exits 1 only when a required check fails", () => {
    expect(doctorExitCode([ok, { id: "disk", status: "warn", required: false, detail: "12 GB free" }])).toBe(0);
    expect(doctorExitCode([ok, { id: "claude", status: "fail", required: false, detail: "not found" }])).toBe(0);
    expect(doctorExitCode([ok, { id: "ffmpeg", status: "fail", required: true, detail: "missing", fix: "run: pnpm zks setup" }])).toBe(1);
  });

  it("masks a planted key, email and authorization header in --json output", () => {
    const planted: CheckResult = {
      id: "claude",
      status: "warn",
      required: false,
      detail: "sk-ant-api03-PLANTEDKEY0123456789 for someone@example.org",
      data: { headers: "Authorization: Bearer PLANTEDTOKEN.abc" },
    };
    const json = formatDoctorJson([ok, planted]);
    for (const secret of ["PLANTEDKEY0123456789", "someone@example.org", "PLANTEDTOKEN"]) expect(json).not.toContain(secret);
    expect(JSON.parse(json)).toMatchObject({ ok: true, checks: [{ id: "node" }, { id: "claude" }] });
  });

  it("rewrites ZKS_HOME and the home directory to placeholders, whatever their names", () => {
    const toolCheck: CheckResult = {
      id: "ffmpeg",
      status: "ok",
      required: true,
      detail: "x",
      data: { path: "/srv/jdoe-data/zks/tools/ffmpeg", cache: "/u/jdoe/.cache" },
    };
    const json = formatDoctorJson([toolCheck], { zksHome: "/srv/jdoe-data/zks", homeDir: "/u/jdoe" });
    expect(json).not.toContain("jdoe");
    expect(json).toContain("$ZKS_HOME/tools/ffmpeg");
    expect(json).toContain("~/.cache");
  });

  it("masks this machine's hostname, username and IPv4 addresses by default", () => {
    const { username } = os.userInfo();
    const detail = `bound 203.0.113.7 on ${os.hostname()} as ${username}`;
    const json = formatDoctorJson([{ id: "port", status: "warn", required: false, detail }], reportRoots());
    for (const identifying of [os.hostname(), username, "203.0.113.7"]) expect(json).not.toContain(identifying);
  });
});

describe("checkDisk", () => {
  it("measures the nearest existing parent when ZKS_HOME does not exist yet", () => {
    const disk = checkDisk({ home: path.join(tmpdir(), "zks-never-created", "nested") });
    expect(disk.id).toBe("disk");
    expect(disk.detail).toMatch(/^\d+ GB free$/);
  });
});

describe("formatFatalError", () => {
  const roots = { zksHome: "/srv/jdoe-data/zks", homeDir: "/u/jdoe" };
  const crash = new Error("ENOENT: no such file or directory, statfs '/srv/jdoe-data/zks' for jdoe@example.org");

  it("emits a parseable JSON error object under --json", () => {
    const output = formatFatalError(crash, { asJson: true, roots });
    const parsed = JSON.parse(output) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("statfs '$ZKS_HOME'");
  });

  it("redacts paths and emails in plain text", () => {
    const output = formatFatalError(crash, { asJson: false, roots });
    expect(output).not.toContain("jdoe");
  });
});
