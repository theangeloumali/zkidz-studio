// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { redactReport, redactText } from "../src/redact.ts";

const PLANTED_KEY = "sk-ant-api03-AbCdEf0123456789_-AbCdEf0123456789";
const PLANTED_EMAIL = "someone.private@example.org";
const PLANTED_BEARER = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";

describe("redactText", () => {
  it("masks an Anthropic key wherever it appears", () => {
    const redacted = redactText(`key=${PLANTED_KEY} trailing`);
    expect(redacted).not.toContain("sk-ant-api03");
    expect(redacted).toContain("trailing");
  });

  it("masks email addresses", () => {
    expect(redactText(`logged in as ${PLANTED_EMAIL}`)).not.toContain(PLANTED_EMAIL);
  });

  it("masks authorization and x-api-key header values in any case", () => {
    const headers = `Authorization: ${PLANTED_BEARER}\nx-api-key: secret-value-123\nX-Other: kept`;
    const redacted = redactText(headers);
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).not.toContain("secret-value-123");
    expect(redacted).toContain("X-Other: kept");
  });

  it("masks user names inside home and Windows profile paths", () => {
    const redacted = redactText("/home/jdoe/.local/share/x /Users/jdoe/Library C:\\Users\\jdoe\\AppData /mnt/c/Users/jdoe/media");
    expect(redacted).not.toContain("jdoe");
    expect(redacted).toContain(".local/share/x");
  });

  it("masks JSON-shaped authorization values", () => {
    const redacted = redactText(JSON.stringify({ authorization: PLANTED_BEARER }));
    expect(redacted).not.toContain("payload.signature");
  });
});

describe("redactReport", () => {
  it("masks secrets in nested strings and object keys named like credentials", () => {
    const report = { checks: [{ detail: `env has ${PLANTED_KEY}`, data: { owner: PLANTED_EMAIL, authorization: "opaque" } }] };
    const serialized = JSON.stringify(redactReport(report));
    for (const secret of [PLANTED_KEY, PLANTED_EMAIL, "opaque"]) expect(serialized).not.toContain(secret);
  });

  it("leaves numbers and booleans untouched", () => {
    expect(redactReport({ freeGb: 42, ok: true })).toEqual({ freeGb: 42, ok: true });
  });
});
