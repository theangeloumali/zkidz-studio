// Created by The Angelo Umali.
// The live preview (plan §9.3): the renderer's composition for one video, from the same cue and caption JSON and theme, written
// with no frames rendered. The 4318 origin serves it under `script-src 'self'`, so the runtime and CSS are files, not inline.
// Usage (work dir as cwd, or ZKS_WORK): node <engine>/hf/preview v1 [--theme id]   → <WORK>/preview/v1/index.html
const fs = require("fs");
const path = require("path");
const { createTimemap } = require("../overlay/timemap");
const { loadCueSheet } = require("../cues");
const { loadTheme, DEFAULT_THEME } = require("../theme");
const { composeDocument } = require("../compose");
const { REGISTRY } = require("../components");
const { canvasBrand } = require("../brand/canvas");
const { fontAssets, fontFaceCss } = require("../brand/fonts");

const VIDEO_ID = /^v\d+r?$/;
const PLAYER_FILE = path.join(__dirname, "player.js");
const vendor = (file) => require.resolve(`gsap/dist/${file}`, { paths: [path.join(__dirname, "..")] });
const ASSETS = {
  ...fontAssets(),
  "brand/zkidz-dev-logo.png": path.join(__dirname, "..", "brand", "zkidz-dev-logo.png"),
  "vendor/gsap.min.js": vendor("gsap.min.js"),
  "vendor/CustomEase.min.js": vendor("CustomEase.min.js"),
};
// Clips stay hidden until player.js shows the ones live at the seeked time.
const PREVIEW_CSS = `.clip { visibility: hidden; }`;
const EMPTY_STYLE = /<style>\s*<\/style>/;
// compose.js's inline runtime; player.js builds the same timeline from the page's JSON scripts.
const INLINE_RUNTIME = /<script>\s*const COMPOSITION_ID =[\s\S]*?<\/script>/;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readJsonIfPresent = (file) => (fs.existsSync(file) ? readJson(file) : null);

// captions/vN.json groups timed by the phrase file, as zks_engine.captions emit_cues writes cues/vN-cc.json.
function captionCues(work, video) {
  const entries = readJsonIfPresent(path.join(work, "captions", `${video}.json`));
  const phrases = readJsonIfPresent(path.join(work, "captions", `${video}.phrases.json`));
  if (!entries || !phrases) return [];
  const byId = new Map(phrases.map((phrase) => [phrase.id, phrase]));
  return entries
    .filter((entry) => entry.ids.every((id) => byId.has(id)))
    .sort((first, second) => first.ids[0] - second.ids[0])
    .map((entry) => ({ kind: "caption", at: byId.get(entry.ids[0]).at, end: byId.get(entry.ids.at(-1)).end, text: entry.en.trim() }));
}

// Image kinds copy a project file into the page; the preview never carries one.
function withoutImages(cues, warnings) {
  return cues.filter((cue) => {
    if (!REGISTRY[cue.kind]?.image) return true;
    warnings.push(`${cue.kind} at ${cue.at} is not shown in the preview (image cues appear in renders)`);
    return false;
  });
}

function externalized(html) {
  if (!EMPTY_STYLE.test(html) || !INLINE_RUNTIME.test(html)) throw new Error("compose.js output changed shape; update preview/index.js");
  return html.replace(EMPTY_STYLE, '<link rel="stylesheet" href="preview.css" />').replace(INLINE_RUNTIME, '<script src="preview.js"></script>');
}

// Assets first and the page last, by rename, so a reload mid-rebuild sees the old page or the new one.
function writePreview(dir, { html, css }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [relative, source] of Object.entries({ ...ASSETS, "preview.js": PLAYER_FILE })) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.copyFileSync(source, path.join(dir, relative));
  }
  fs.writeFileSync(path.join(dir, "preview.css"), css);
  const partPath = path.join(dir, `index.html.${process.pid}.part`);
  fs.writeFileSync(partPath, html);
  fs.renameSync(partPath, path.join(dir, "index.html"));
}

function buildPreview({ work, video, theme: themeId = DEFAULT_THEME }) {
  if (typeof video !== "string" || !VIDEO_ID.test(video)) throw new Error(`${JSON.stringify(video)} is not a video id (v1, v1r)`);
  const edl = readJson(path.join(work, "edl", `${video}.json`));
  const theme = loadTheme(themeId);
  const brand = canvasBrand();
  brand.applyTheme(theme);
  const warnings = [];
  const authored = fs.existsSync(path.join(work, "cues", `${video}.json`)) ? loadCueSheet(work, [video]) : [];
  const sheet = withoutImages([...authored, ...captionCues(work, video)], warnings);
  const cues = createTimemap(edl, warnings).mapCues(sheet, {
    includeDerived: true,
    isKnownKind: (kind) => Object.hasOwn(REGISTRY, kind),
    cutawayTail: brand.scope.cutawayWipeOut,
  });
  const undrawn = [...new Set(cues.map((cue) => cue.kind).filter((kind) => !Object.hasOwn(theme.components, kind)))];
  if (undrawn.length) throw new Error(`theme ${theme.id} does not draw ${undrawn.join(", ")}`);
  const { html, placed } = composeDocument({ edl, cues, registry: REGISTRY, compositionId: `preview-${video}`, css: "" });
  const css = `${fontFaceCss()}\n${fs.readFileSync(path.join(__dirname, "..", "brand", "brand.css"), "utf8")}\n:root { --glow: ${brand.scope.BRAND.goldBright}; }\n${PREVIEW_CSS}\n`;
  const dir = path.join(work, "preview", video);
  writePreview(dir, { html: externalized(html), css });
  return { dir, placed, warnings };
}

if (require.main === module) {
  const [video, ...args] = process.argv.slice(2);
  try {
    const theme = args.includes("--theme") ? args[args.indexOf("--theme") + 1] : DEFAULT_THEME;
    const { dir, placed, warnings } = buildPreview({ work: process.env.ZKS_WORK || process.cwd(), video, theme });
    console.log(JSON.stringify({ dir, clips: placed.length, warnings }));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildPreview };
