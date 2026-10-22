// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { redactReport, redactSecrets, redactText } from "../src/redact.ts";

const PLANTED_KEY = "sk-ant-api03-AbCdEf0123456789_-AbCdEf0123456789";
const PLANTED_EMAIL = "someone.private@example.org";
const PLANTED_BEARER = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";

describe("redactSecrets (server logs)", () => {
  it("masks Anthropic keys", () => {
    expect(redactSecrets("key sk-ant-api03-AbC_d-123 used")).toBe("key [REDACTED] used");
  });

  it("masks x-api-key and authorization values in header and JSON shapes", () => {
    expect(redactSecrets("x-api-key: abc123")).toBe("x-api-key: [REDACTED]");
    expect(redactSecrets('{"authorization":"Bearer tok.en"}')).toBe('{"authorization":"[REDACTED]"}');
    expect(redactSecrets("Authorization: Bearer tok.en")).toBe("Authorization: [REDACTED]");
    expect(redactSecrets('{"detail":"authorization: Bearer secret"}')).toBe('{"detail":"authorization: [REDACTED]"}');
  });

  it("masks a bearer token outside any header", () => {
    expect(redactSecrets(`upstream said ${PLANTED_BEARER} was rejected`)).toBe("upstream said Bearer [REDACTED] was rejected");
  });

  it("masks email addresses, multi-label domains included", () => {
    expect(redactSecrets("mail me@example.com now")).toBe("mail [REDACTED] now");
    expect(redactSecrets("from a.b@mail.example.co.uk")).toBe("from [REDACTED]");
  });

  it("leaves ordinary text and home paths alone", () => {
    expect(redactSecrets("rendered v6 in 12.5 s")).toBe("rendered v6 in 12.5 s");
    expect(redactSecrets("/home/jdoe/x")).toBe("/home/jdoe/x");
  });
});

describe("redactText (public reports)", () => {
  it("applies every secret rule", () => {
    const headers = `Authorization: ${PLANTED_BEARER}\nx-api-key: secret-value-123\nX-Other: kept\n${PLANTED_KEY} ${PLANTED_EMAIL}`;
    const redacted = redactText(headers);
    for (const secret of ["eyJhbGciOiJIUzI1NiJ9", "secret-value-123", "sk-ant-api03", PLANTED_EMAIL]) expect(redacted).not.toContain(secret);
    expect(redacted).toContain("X-Other: kept");
  });

  it("masks user names inside home and Windows profile paths", () => {
    const redacted = redactText("/home/jdoe/.local/share/x /Users/jdoe/Library C:\\Users\\jdoe\\AppData /mnt/c/Users/jdoe/media");
    expect(redacted).not.toContain("jdoe");
    expect(redacted).toContain(".local/share/x");
  });

  it("replaces ZKS_HOME before the home dir it usually sits in", () => {
    expect(redactText("/srv/u/data/zks/db and /srv/u/x", { zksHome: "/srv/u/data/zks", homeDir: "/srv/u" })).toBe("$ZKS_HOME/db and ~/x");
  });
});

describe("redactReport", () => {
  it("masks secrets in nested strings and object keys named like credentials", () => {
    const report = { checks: [{ detail: `env has ${PLANTED_KEY}`, data: { owner: PLANTED_EMAIL, authorization: "opaque", apiKey: "k1" } }] };
    const serialized = JSON.stringify(redactReport(report));
    for (const secret of [PLANTED_KEY, PLANTED_EMAIL, "opaque", "k1"]) expect(serialized).not.toContain(secret);
  });

  it("leaves numbers and booleans untouched", () => {
    expect(redactReport({ freeGb: 42, ok: true })).toEqual({ freeGb: 42, ok: true });
  });
});
