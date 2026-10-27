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

  it("masks the password in a connection URL, encoded or not, and keeps the rest readable", () => {
    // Every credential slot is a ${placeholder}: a literal one would read as a leaked credential to gitleaks.
    const password = ["S3cret", "Pw"].join("");
    const encodedPassword = `${password}%40x`;
    const masked = "[REDACTED]";
    expect(redactSecrets(`DATABASE_URL=postgres://admin:${password}@127.0.0.1:45322/postgres failed`)).toBe(
      `DATABASE_URL=postgres://admin:${masked}@127.0.0.1:45322/postgres failed`,
    );
    expect(redactSecrets(`postgresql://u:${encodedPassword}@db.internal/app`)).toBe(`postgresql://u:${masked}@db.internal/app`);
    expect(redactSecrets("open https://example.com/docs:setup")).toBe("open https://example.com/docs:setup");
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

describe("identity masking (public reports)", () => {
  const identity = { hostName: "jdoe-laptop", userName: "jdoe" };

  it("masks the hostname and username as whole names only", () => {
    const redacted = redactText("JDOE-LAPTOP refused jdoe; jdoerr and notjdoe stay", identity);
    expect(redacted).toBe("<host> refused <user>; jdoerr and notjdoe stay");
  });

  it("masks dotted-quad IPv4 addresses with valid octets, port and CIDR included", () => {
    expect(redactText("listen 203.0.113.7:4318, peer 10.0.0.2/24 via 255.255.255.0")).toBe("listen <ip>:4318, peer <ip>/24 via <ip>");
  });

  it("leaves dotted numbers that cannot be IPv4 addresses", () => {
    expect(redactText("999.1.1.1 1.2.3 1.2.3.4.5 01.2.3.4")).toBe("999.1.1.1 1.2.3 1.2.3.4.5 01.2.3.4");
  });

  it("keeps a version with a suffix, like a WSL kernel release, in free text", () => {
    expect(redactText("Linux 6.18.33.2-microsoft-standard-WSL2")).toBe("Linux 6.18.33.2-microsoft-standard-WSL2");
  });

  it("keeps a check's id and label when the username matches them, as the node user does in the container image", () => {
    const report = { checks: [{ id: "node", label: "Node", status: "pass", detail: "/home/node/.local v24" }] };
    expect(redactReport(report, { userName: "node" })).toEqual({ checks: [{ id: "node", label: "Node", status: "pass", detail: "/home/<user>/.local v24" }] });
  });

  it("keeps an IPv4-shaped version in an os or version field and masks the same digits elsewhere", () => {
    const report = { machine: { os: "6.18.33.2", nodeVersion: "26.1.0.1", kernelRelease: "6.18.33.2" }, detail: "bound 6.18.33.2" };
    expect(redactReport(report, identity)).toEqual({ machine: { os: "6.18.33.2", nodeVersion: "26.1.0.1", kernelRelease: "6.18.33.2" }, detail: "bound <ip>" });
  });
});
