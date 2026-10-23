// Created by The Angelo Umali.
// Fails the build when the JS a first visit downloads (the entry script plus its modulepreloads) passes the plan's
// 250 KB gzip budget. Lazy route chunks are not counted: a visit only pays for them on navigation.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const INITIAL_JS_BUDGET_BYTES = 250_000;
const DIST_DIR = join(import.meta.dirname, "..", "dist");
const INITIAL_SCRIPT = /<(?:script[^>]*\bsrc|link[^>]*\brel="modulepreload"[^>]*\bhref)="\/?([^"]+\.js)"/g;

const indexHtml = readFileSync(join(DIST_DIR, "index.html"), "utf8");
const scripts = [...new Set([...indexHtml.matchAll(INITIAL_SCRIPT)].map((match) => match[1]))];
const sizes = scripts.map((script) => ({ script, gzipBytes: gzipSync(readFileSync(join(DIST_DIR, script))).length }));
const totalBytes = sizes.reduce((total, { gzipBytes }) => total + gzipBytes, 0);

for (const { script, gzipBytes } of sizes) console.log(`${(gzipBytes / 1000).toFixed(2).padStart(8)} kB  ${script}`);
console.log(`${(totalBytes / 1000).toFixed(2).padStart(8)} kB  initial JS (gzip), budget ${INITIAL_JS_BUDGET_BYTES / 1000} kB`);
if (scripts.length === 0 || totalBytes > INITIAL_JS_BUDGET_BYTES) {
  console.error(scripts.length === 0 ? "no initial script found in dist/index.html" : "initial JS is over budget");
  process.exit(1);
}
