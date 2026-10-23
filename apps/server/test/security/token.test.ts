// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { createSessionToken, tokensMatch } from "../../src/security/token.ts";

describe("createSessionToken", () => {
  it("returns at least 32 random bytes as base64url", () => {
    const sessionToken = createSessionToken();
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(sessionToken, "base64url").length).toBeGreaterThanOrEqual(32);
  });

  it("never repeats", () => {
    const issuedTokens = new Set(Array.from({ length: 100 }, () => createSessionToken()));
    expect(issuedTokens.size).toBe(100);
  });
});

describe("tokensMatch", () => {
  const expectedToken = createSessionToken();

  it("accepts the exact token", () => {
    expect(tokensMatch(expectedToken, expectedToken)).toBe(true);
  });

  it.each<[string, string | undefined]>([
    ["undefined", undefined],
    ["an empty string", ""],
    ["a shorter token", expectedToken.slice(0, -1)],
    ["a longer token", `${expectedToken}A`],
    ["a different token of the same length", createSessionToken()],
    ["a case-changed token", expectedToken.toUpperCase() === expectedToken ? expectedToken.toLowerCase() : expectedToken.toUpperCase()],
  ])("rejects %s", (_label, presentedToken) => {
    expect(tokensMatch(expectedToken, presentedToken)).toBe(false);
  });

  it("never matches when the expected token is empty", () => {
    expect(tokensMatch("", "")).toBe(false);
  });
});
