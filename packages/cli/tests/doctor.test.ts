// Created by The Angelo Umali.
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDisk, listsEncoder } from "../src/checks.ts";
import { doctorExitCode, formatDoctorJson, formatFatalError, type CheckResult } from "../src/doctor.ts";

describe("listsEncoder", () => {
  it("matches a whole encoder name in ffmpeg -encoders, not a prefix", () => {
    const listing = " V....D hevc_nvenc  NVIDIA NVENC H.265 encoder\n V....D libx265  libx265 H.265 / HEVC";
    expect(listsEncoder(listing, "hevc_nvenc")).toBe(true);
    expect(listsEncoder(listing, "hevc")).toBe(false);
    expect(listsEncoder(listing, "hevc_qsv")).toBe(false);
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
