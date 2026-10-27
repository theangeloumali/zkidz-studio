// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(fileURLToPath(new URL("../../site/index.html", import.meta.url)), "utf8");

describe("launch site CSP", () => {
  // Pages sends no headers, so the meta CSP allows the inline script by hash; an edit to the script changes it.
  it("allows every inline script by its current sha256", () => {
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(PAGE)?.[1] ?? "";
    const scripts = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      const hash = createHash("sha256").update(script).digest("base64");
      expect(policy).toContain(`'sha256-${hash}'`);
    }
  });
});
