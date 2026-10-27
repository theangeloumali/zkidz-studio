// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.ts";
import { redactSecrets } from "../src/logging/redact.ts";

describe("redactSecrets", () => {
  it("masks Anthropic keys", () => {
    expect(redactSecrets("key sk-ant-api03-AbC_d-123 used")).toBe("key [REDACTED] used");
  });

  it("masks x-api-key and authorization values in header and JSON shapes", () => {
    expect(redactSecrets("x-api-key: abc123")).toBe("x-api-key: [REDACTED]");
    expect(redactSecrets('{"authorization":"Bearer tok.en"}')).toBe('{"authorization":"[REDACTED]"}');
    expect(redactSecrets("Authorization: Bearer tok.en")).toBe("Authorization: [REDACTED]");
  });

  it("masks email addresses", () => {
    expect(redactSecrets("mail me@example.com now")).toBe("mail [REDACTED] now");
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("rendered v6 in 12.5 s")).toBe("rendered v6 in 12.5 s");
  });
});

describe("createLogger", () => {
  it("writes one redacted JSON line per entry", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.error("upload failed", { detail: "authorization: Bearer secret", owner: "a@b.co" });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "error", msg: "upload failed", detail: "authorization: [REDACTED]", owner: "[REDACTED]" });
    expect(lines[0]).not.toContain("secret");
  });
});
