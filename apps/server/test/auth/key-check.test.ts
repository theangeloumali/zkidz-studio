// Created by The Angelo Umali.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_MODELS_URL, checkApiKey } from "../../src/auth/key-check.ts";
import { createLogger } from "../../src/logging/logger.ts";

interface RecordedCall {
  readonly url: string;
  readonly headers: Headers;
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchModels = async (input: string | URL | Request, init?: RequestInit) => {
    await Promise.resolve();
    calls.push({ url: input instanceof Request ? input.url : input.toString(), headers: new Headers(init?.headers) });
    return respond();
  };
  return { calls, fetchModels };
}

function captureLogger() {
  const lines: string[] = [];
  return { lines, logger: createLogger((line) => lines.push(line)) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkApiKey", () => {
  it("calls the literal Anthropic models URL even when ANTHROPIC_BASE_URL is set", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://evil");
    const { calls, fetchModels } = fakeFetch(() => new Response("{}", { status: 200 }));
    const { logger } = captureLogger();

    const result = await checkApiKey("test-key-0000abcd", { fetch: fetchModels, logger });

    expect(result).toEqual({ ok: true });
    expect(ANTHROPIC_MODELS_URL).toBe("https://api.anthropic.com/v1/models");
    expect(calls.map((call) => call.url)).toEqual(["https://api.anthropic.com/v1/models"]);
    expect(calls[0]?.headers.get("x-api-key")).toBe("test-key-0000abcd");
    expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("reports a 401 as a rejected key", async () => {
    const { fetchModels } = fakeFetch(() => new Response("{}", { status: 401 }));
    expect(await checkApiKey("bad-key", { fetch: fetchModels, logger: captureLogger().logger })).toEqual({ ok: false, reason: "rejected", status: 401 });
  });

  it("reports other statuses as unexpected", async () => {
    const { fetchModels } = fakeFetch(() => new Response("{}", { status: 529 }));
    expect(await checkApiKey("key", { fetch: fetchModels, logger: captureLogger().logger })).toEqual({ ok: false, reason: "unexpected", status: 529 });
  });

  it("logs a network failure without the key or the headers", async () => {
    const { fetchModels } = fakeFetch(() => {
      throw new TypeError("fetch failed for x-api-key test-key-0000abcd");
    });
    const { lines, logger } = captureLogger();

    const result = await checkApiKey("test-key-0000abcd", { fetch: fetchModels, logger });

    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(lines.join("\n")).not.toContain("test-key-0000abcd");
    expect(lines.join("\n")).toContain("TypeError");
  });
});
