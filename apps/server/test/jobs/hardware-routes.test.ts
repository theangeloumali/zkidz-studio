// Created by The Angelo Umali.
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTES, HardwareSchema } from "@zks/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeHardware } from "../../src/jobs/hardware.ts";
import { createTestServer, getRequest, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await rm(join(server.studioHome, "capabilities.json"), { force: true });
});

async function probeAs(profile: "nvidia" | "cpu") {
  const capabilities = { profile, features: { uhd: profile === "nvidia", intro: true, zoomExpr: true, matte: true }, transcribe: "whisper.cpp" };
  await writeFile(join(server.studioHome, "capabilities.json"), JSON.stringify(capabilities));
}

const idleMeters = { readCpuPercent: () => Promise.resolve(12), readNvidiaUtilization: () => Promise.resolve({ gpu: 87, encoder: 64 }) };

describe("hardware route", () => {
  it("reports the probed profile's encoder, chunk count and a live CPU meter", async () => {
    await probeAs("cpu");

    const response = await getRequest(server, "/api/hardware");

    expect(response.status).toBe(200);
    const hardware = HardwareSchema.parse(await response.json());
    expect(hardware).toMatchObject({ profile: "cpu", encoder: "libx265", meters: [{ label: "CPU" }, { label: "GPU", pct: null }] });
    expect(hardware.chunks).toBeGreaterThanOrEqual(1);
    expect(hardware.meters[0]?.pct).toEqual(expect.any(Number));
  });

  it("answers null until the hardware is probed, since an unprobed machine is not an error", async () => {
    const response = await getRequest(server, "/api/hardware");

    expect(response.status).toBe(200);
    expect(API_ROUTES.getHardware.response.parse(await response.json())).toBeNull();
  });
});

describe("describeHardware", () => {
  it("meters the GPU, NVENC and CPU on an NVIDIA render, with 4 chunks", async () => {
    expect(await describeHardware("nvidia", idleMeters)).toEqual({
      profile: "nvidia",
      encoder: "hevc_nvenc",
      chunks: 4,
      meters: [
        { label: "GPU", pct: 87 },
        { label: "Encoder", pct: 64 },
        { label: "CPU", pct: 12 },
      ],
    });
  });

  it("leaves a meter out when nvidia-smi cannot be read", async () => {
    const hardware = await describeHardware("nvidia", { ...idleMeters, readNvidiaUtilization: () => Promise.resolve(undefined) });
    expect(hardware.meters).toEqual([{ label: "CPU", pct: 12 }]);
  });

  it("meters only the CPU on a GPU it cannot read, with that backend's encoder", async () => {
    expect(await describeHardware("qsv", idleMeters)).toEqual({ profile: "qsv", encoder: "hevc_qsv", chunks: 2, meters: [{ label: "CPU", pct: 12 }] });
  });
});
