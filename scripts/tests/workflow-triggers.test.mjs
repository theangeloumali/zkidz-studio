// Created by The Angelo Umali.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));

/** The event names under a workflow's top-level `on:` block (workflows hold no YAML parser dependency). */
function triggerEvents(/** @type {string} */ workflow) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (start < 0) throw new Error("no block-style `on:` key");
  const events = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const event = /^ {2}([a-z_]+):/.exec(line)?.[1];
    if (event) events.push(event);
  }
  return events;
}

// CI runs locally before every merge (Angelo, 2026-10-23): per-push runs failed often and spammed his email.
describe("GitHub workflows", () => {
  it.each(readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml")))("%s runs only when started by hand", (name) => {
    expect(triggerEvents(readFileSync(join(WORKFLOWS_DIR, name), "utf8"))).toEqual(["workflow_dispatch"]);
  });
});
