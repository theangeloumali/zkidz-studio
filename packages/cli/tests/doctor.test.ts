// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { doctorExitCode, formatDoctorJson, type CheckResult } from "../src/doctor.ts";
import { probeGpuBackend } from "../src/gpu.ts";
import type { CommandRunner } from "../src/exec.ts";

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

describe("probeGpuBackend", () => {
  it("trusts a test encode, not the encoder list", () => {
    const probe = probeGpuBackend("ffmpeg", ENCODER_LISTING, fakeRunner(["libx265"]));
    expect(probe.backend).toBe("cpu");
    expect(probe.attempts).toContainEqual({ backend: "nvidia", encoder: "hevc_nvenc", ok: false });
  });

  it("picks the first passing backend in probe order", () => {
    expect(probeGpuBackend("ffmpeg", ENCODER_LISTING, fakeRunner(["hevc_nvenc", "hevc_vaapi", "libx265"])).backend).toBe("nvidia");
  });

  it("uploads frames to the render node for VAAPI", () => {
    const calls: string[][] = [];
    probeGpuBackend("ffmpeg", ENCODER_LISTING, fakeRunner(["libx265"], calls));
    const vaapiCall = calls.find((args) => args.includes("hevc_vaapi"));
    expect(vaapiCall).toEqual(expect.arrayContaining(["-vaapi_device", "/dev/dri/renderD128", "format=nv12,hwupload"]));
  });

  it("skips encoders the build does not list", () => {
    const calls: string[][] = [];
    probeGpuBackend("ffmpeg", ENCODER_LISTING, fakeRunner([], calls));
    expect(calls.some((args) => args.includes("hevc_qsv"))).toBe(false);
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
});
