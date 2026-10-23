// Created by The Angelo Umali.
// Per-session bearer tokens for the mode T hooks bridge and the stdio MCP twin (plan §6.3, §11).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function tokensMatch(expected: string, presented: string | undefined): boolean {
  // An unset expected token is a wiring bug; it must never authenticate an empty bearer.
  if (presented === undefined || expected === "") return false;
  // Equal-length digests let timingSafeEqual run without leaking the presented token's length.
  return timingSafeEqual(sha256(expected), sha256(presented));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
