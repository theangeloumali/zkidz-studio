// Created by The Angelo Umali.
// The canvas brand code, run in Node: overlay.html's scripts (the kit, then overlay/ helpers and
// components) load into one vm realm whose 2D context is an SvgRecorder. HyperFrames components reuse the canvas layout
// and get its cards, rules, kickers and strokes as SVG with the same geometry, so the palette and sketch math stay single-source.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { SvgRecorder } = require("./recorder");
const OVERLAY = path.join(__dirname, "..", "overlay");
// `local` for canvas helpers that animate (kicker, wordsRise): drawn settled, HyperFrames tweens the result instead.
const SETTLED = 1e3;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function pageScripts() {
  const html = fs.readFileSync(path.join(OVERLAY, "overlay.html"), "utf8");
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map((match) => match[1])
    .map((src) => path.join(OVERLAY, src))
    .map((file) => {
      if (!fs.existsSync(file)) throw new Error(`the overlay page loads ${file}, which is missing`);
      return file;
    });
}

function loadCanvas() {
  // A Path2D keeps the SVG path data it was built from, which the recorder can fill.
  // activeCues answers the caption plate's question of which name plates to dodge (see still's `active`).
  const Path2D = class Path2D {
    constructor(d) {
      this.d = typeof d === "string" ? d : "";
    }
  };
  const context = vm.createContext({ location: { search: "" }, URLSearchParams, console, Path2D, activeCues: () => context.__active });
  for (const file of pageScripts()) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  // Layout helpers (textWidth, wrapLines, headLayout) measure through the context, so a recorder is always installed.
  context.__measure = new SvgRecorder("measure");
  context.__active = [];
  const reset = () => vm.runInContext("beginFrame(__measure, 0); jitterScale = 1; drawingCueSeed = null", context);
  reset();

  // Top-level const/let are not properties of a vm global, so names resolve by evaluation. Read constants and functions
  // only: a mutable binding (seedCounter) would be cached stale.
  const cache = new Map();
  const scope = new Proxy(
    {},
    {
      get(_, name) {
        if (typeof name !== "string" || !IDENTIFIER.test(name)) return undefined;
        if (!cache.has(name)) cache.set(name, vm.runInContext(name, context));
        return cache.get(name);
      },
    },
  );

  // Runs draw(scope, capture, ctx) the way the canvas page's drawStill does for cue `seed`: furniture frozen on the cue's
  // seeds at the page's jitter. capture(fn) returns what fn draws as one SVG fragment; ctx is the recorder (transforms).
  // Clip ids start with `idPrefix`, unique per document; `active` is what activeCues answers while it runs.
  function still(seed, idPrefix, draw, { active = [] } = {}) {
    const recorder = new SvgRecorder(idPrefix);
    context.__job = { recorder, seed, run: () => draw(scope, (fn) => recorder.capture(fn), recorder) };
    context.__active = active;
    try {
      return vm.runInContext(
        "beginFrame(__job.recorder, 0); jitterScale = BRAND_JITTER; drawingCueSeed = __job.seed; stillInk(__job.seed, __job.run)",
        context,
      );
    } finally {
      context.__job = null;
      context.__active = [];
      reset();
    }
  }
  const svg = (seed, idPrefix, draw, options) => still(seed, idPrefix, (k, capture, ctx) => capture(() => draw(k, ctx)), options);

  // Like still(), but each call `draw` makes to the canvas global function `name` comes back as its own fragment with its
  // arguments, so a component can animate the pieces a canvas helper lays out (each word wordsRise places).
  function pieces(seed, idPrefix, name, draw) {
    const original = context[name];
    if (typeof original !== "function") throw new Error(`the canvas page has no function ${name}`);
    return still(seed, idPrefix, (k, capture) => {
      const found = [];
      context[name] = (...args) => {
        let result;
        found.push({ args, svg: capture(() => (result = original(...args))) });
        return result;
      };
      try {
        draw(k);
      } finally {
        context[name] = original;
      }
      return found;
    });
  }
  return { scope, still, svg, pieces };
}

let canvas = null;
const canvasBrand = () => (canvas ??= loadCanvas());

module.exports = { canvasBrand, SETTLED };
