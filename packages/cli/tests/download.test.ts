// Created by The Angelo Umali.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ChecksumMismatchError, downloadVerified, sha256File } from "../src/download.ts";

const PAYLOAD = randomBytes(256 * 1024);
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");
const requestHeaders: IncomingHttpHeaders[] = [];
let server: Server;
let baseUrl: string;
let workDir: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    requestHeaders.push(request.headers);
    const rangeStart = Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? "")?.[1] ?? 0);
    response.writeHead(rangeStart > 0 ? 206 : 200, { "content-length": PAYLOAD.length - rangeStart });
    response.end(PAYLOAD.subarray(rangeStart));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  requestHeaders.length = 0;
  workDir = mkdtempSync(path.join(tmpdir(), "zks-dl-"));
});

describe("downloadVerified", () => {
  it("downloads, verifies and renames into place", async () => {
    const destination = path.join(workDir, "tool.bin");
    const outcome = await downloadVerified({ url: `${baseUrl}/tool.bin`, sha256: PAYLOAD_SHA256, destination });
    expect(outcome.downloaded).toBe(true);
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true);
    expect(existsSync(`${destination}.part`)).toBe(false);
  });

  it("rejects a hash mismatch and leaves nothing behind", async () => {
    const destination = path.join(workDir, "tool.bin");
    await expect(downloadVerified({ url: `${baseUrl}/tool.bin`, sha256: "0".repeat(64), destination })).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(`${destination}.part`)).toBe(false);
  });

  it("skips the network when the verified file is already present", async () => {
    const destination = path.join(workDir, "tool.bin");
    writeFileSync(destination, PAYLOAD);
    const outcome = await downloadVerified({ url: `${baseUrl}/tool.bin`, sha256: PAYLOAD_SHA256, destination });
    expect(outcome.downloaded).toBe(false);
    expect(requestHeaders).toHaveLength(0);
  });

  it("resumes a partial download with an HTTP Range request", async () => {
    const destination = path.join(workDir, "tool.bin");
    writeFileSync(`${destination}.part`, PAYLOAD.subarray(0, 1000));
    await downloadVerified({ url: `${baseUrl}/tool.bin`, sha256: PAYLOAD_SHA256, destination });
    expect(requestHeaders[0]?.range).toBe("bytes=1000-");
    expect(await sha256File(destination)).toBe(PAYLOAD_SHA256);
  });
});
