// Created by The Angelo Umali.
// The brand faces: the kit's Newsreader, Caveat, JetBrains Mono and Chakra Petch (the learning look) plus the overlay's
// Inter. Widths come from fontkit with the optical-size axis at the font size, which is how Chrome lays them out
// (font-optical-sizing: auto).
const fs = require("fs");
const path = require("path");
const fontkit = require("fontkit");

const KIT_FONTS = path.join(__dirname, "..", "kit", "fonts");
const FACES = {
  Newsreader: { file: path.join(KIT_FONTS, "Newsreader.ttf"), weights: "200 800" },
  Inter: { file: path.join(__dirname, "..", "overlay", "fonts", "Inter.ttf"), weights: "100 900" },
  Caveat: { file: path.join(KIT_FONTS, "Caveat.ttf"), weights: "400 700" },
  "JetBrains Mono": { file: path.join(KIT_FONTS, "JetBrainsMono.ttf"), weights: "100 800" },
  // A static family lists one file per weight; the others are one variable file over a weight range.
  "Chakra Petch": {
    files: [
      { file: path.join(KIT_FONTS, "ChakraPetch-SemiBold.ttf"), weight: 600 },
      { file: path.join(KIT_FONTS, "ChakraPetch-Bold.ttf"), weight: 700 },
    ],
  },
};
const filesOf = ({ file, weights, files }) => files ?? [{ file, weight: weights }];

// Published path of each face inside a composition folder, for build.js to copy and the CSS to load.
const fontAssets = () =>
  Object.fromEntries(
    Object.values(FACES)
      .flatMap(filesOf)
      .map(({ file }) => [`fonts/${path.basename(file)}`, file]),
  );
const fontFaceCss = () =>
  Object.entries(FACES)
    .flatMap(([family, face]) =>
      filesOf(face).map(({ file, weight }) => `@font-face { font-family: "${family}"; src: url(fonts/${path.basename(file)}); font-weight: ${weight}; }`),
    )
    .join("\n");

// Unseen text in every face file, laid out so each loads before HyperFrames reads document.fonts.ready.
const fontWarmHtml = () =>
  `<div class="fontwarm" aria-hidden="true">${Object.entries(FACES)
    .flatMap(([family, face]) =>
      filesOf(face).map(({ weight }) => `<span style="font-family:'${family}';font-weight:${String(weight).split(" ")[0]}">a</span>`),
    )
    .join("")}</div>`;

const opened = new Map();
const instances = new Map();
const widths = new Map();

// The file that draws `weight`: a variable face's only file, or a static family's nearest weight (Chrome's matching).
function fileFor(family, weight) {
  const files = filesOf(FACES[family]);
  if (files.length === 1) return files[0].file;
  return files.reduce((best, entry) => (Math.abs(entry.weight - weight) < Math.abs(best.weight - weight) ? entry : best)).file;
}

function instance(family, weight, size) {
  if (!FACES[family]) throw new Error(`no brand face "${family}"; known: ${Object.keys(FACES).join(", ")}`);
  const file = fileFor(family, weight);
  if (!opened.has(file)) {
    if (!fs.existsSync(file)) throw new Error(`${family}: ${file} is missing`);
    opened.set(file, fontkit.openSync(file));
  }
  const font = opened.get(file);
  const axes = font.variationAxes;
  const coords = {};
  if (axes.wght) coords.wght = Math.min(axes.wght.max, Math.max(axes.wght.min, weight));
  if (axes.opsz) coords.opsz = Math.min(axes.opsz.max, Math.max(axes.opsz.min, size));
  const key = `${file}|${coords.wght}|${coords.opsz}`;
  if (!instances.has(key)) instances.set(key, Object.keys(coords).length ? font.getVariation(coords) : font);
  return instances.get(key);
}

// Advance width in px of `text` set in { family, weight, size }, kerned; letter spacing is the caller's.
function advanceWidth(text, { family, weight = 400, size }) {
  const key = `${family}|${weight}|${size}|${text}`;
  if (!widths.has(key)) {
    const face = instance(family, weight, size);
    widths.set(key, (face.layout(String(text)).advanceWidth / face.unitsPerEm) * size);
  }
  return widths.get(key);
}

// How far the ink of `text` reaches left of its origin in px (canvas actualBoundingBoxLeft): a swash overhangs.
function inkLeft(text, { family, weight = 400, size }) {
  const face = instance(family, weight, size);
  return (-face.layout(String(text)).bbox.minX / face.unitsPerEm) * size;
}

// The faces a theme may name: the renderer bundles them and measures text with them.
const FAMILIES = Object.keys(FACES);

module.exports = { FAMILIES, fontAssets, fontFaceCss, fontWarmHtml, advanceWidth, inkLeft };
