// Created by The Angelo Umali.
// Initial JS: runs the build's own size check over dist/ (built by the perf script) and reads its total.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { expectWithinBudget } from "./budgets.ts";

const SIZE_CHECK = fileURLToPath(new URL("../scripts/check-bundle-size.mjs", import.meta.url));
const TOTAL_LINE = /^\s*([\d.]+) kB {2}initial JS \(gzip\)/m;

test("the first visit downloads at most 250 kB of gzipped JS", () => {
  const sizeCheck = spawnSync(process.execPath, [SIZE_CHECK], { encoding: "utf8" });
  const total = TOTAL_LINE.exec(sizeCheck.stdout)?.[1];
  expect(total, `check-bundle-size printed no total:\n${sizeCheck.stdout}${sizeCheck.stderr}`).toBeDefined();
  expectWithinBudget("initialJs", Number(total));
});
