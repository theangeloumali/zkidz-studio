// Created by The Angelo Umali.
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "../src/api/client.ts";

function stubErrorResponse(status: number, body: unknown): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function caughtError(): Promise<unknown> {
  return requestJson(z.unknown(), "/api/connect").then(
    () => null,
    (error: unknown) => error,
  );
}

describe("ApiError", () => {
  it("carries the server's error code from a 400 body", async () => {
    stubErrorResponse(400, { error: "Anthropic rejected this key", code: "key_rejected" });
    const error = await caughtError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "key_rejected", message: "Anthropic rejected this key" });
  });

  it("leaves the code out when the body has none", async () => {
    stubErrorResponse(500, { error: "boom" });
    expect(await caughtError()).toMatchObject({ status: 500, code: undefined });
  });

  it("drops a code this build does not know but keeps the message", async () => {
    stubErrorResponse(400, { error: "Something new", code: "from_a_newer_server" });
    expect(await caughtError()).toMatchObject({ status: 400, code: undefined, message: "Something new" });
  });
});
