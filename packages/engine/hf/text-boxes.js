// Created by The Angelo Umali.
// Where each cue's text lands (#43): the built page in the pinned Chrome, every cue seeked to a few moments of its own span,
// each visible text run and chip plate read from the DOM as a box on the 1080 grid. Layout reads only, no pixels.
/* global window, document, getComputedStyle, innerWidth, innerHeight, NodeFilter -- read inside page.evaluate, in Chrome */
const fs = require("fs");
const os = require("os");
const path = require("path");

const HF_PACKAGE = path.dirname(require.resolve("hyperframes/package.json", { paths: [__dirname] }));
const puppeteer = require(require.resolve("puppeteer-core", { paths: [HF_PACKAGE] }));
const CHROME_CACHES = [path.join(".cache", "hyperframes", "chrome"), path.join(".cache", "puppeteer")];
const LANDED = 0.7; // s into a cue when its entry has usually landed; the middle and the last moment are read too

// ZKS_CHROME (setup's pin), else the newest headless shell HyperFrames or puppeteer cached: doctor.check_chrome's order.
function chromePath(env = process.env, home = os.homedir()) {
  if (env.ZKS_CHROME) return env.ZKS_CHROME;
  for (const cache of CHROME_CACHES) {
    const root = path.join(home, cache, "chrome-headless-shell");
    if (!fs.existsSync(root)) continue;
    const shells = fs
      .readdirSync(root)
      .sort()
      .reverse()
      .flatMap((version) => fs.readdirSync(path.join(root, version)).map((platform) => path.join(root, version, platform, "chrome-headless-shell")))
      .filter((file) => fs.existsSync(file));
    if (shells.length) return shells[0];
  }
  throw new Error("no Chrome for --boxes; run pnpm zks setup");
}

// The moments a cue is read at, inside its own span.
const readTimes = ({ start, stop }) => [
  ...new Set([start + Math.min(LANDED, (stop - start) / 2), (start + stop) / 2, stop - 1 / 30].map((t) => Math.max(start, t))),
];

// In the page: every visible text run and chip plate under one clip, after seeking the timeline to `time`.
function visibleText(id, time) {
  const timeline = Object.values(window.__timelines)[0];
  timeline.seek(time, false);
  const root = document.getElementById(id);
  const opacity = (element) => {
    let value = 1;
    for (let node = element; node && node !== root.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      value *= Number(style.opacity);
    }
    return value;
  };
  // A box clipped by every overflow-hidden ancestor and the frame: a scrolling column shows only its window.
  const clipped = (element, rect) => {
    let [left, top, right, bottom] = [rect.left, rect.top, rect.right, rect.bottom];
    for (let node = element.parentElement; node && node !== root.parentElement; node = node.parentElement) {
      if (!/hidden|clip/.test(getComputedStyle(node).overflow)) continue;
      const box = node.getBoundingClientRect();
      [left, top, right, bottom] = [Math.max(left, box.left), Math.max(top, box.top), Math.min(right, box.right), Math.min(bottom, box.bottom)];
    }
    [left, top, right, bottom] = [Math.max(left, 0), Math.max(top, 0), Math.min(right, innerWidth), Math.min(bottom, innerHeight)];
    return [left, top, right - left, bottom - top];
  };
  const rects = [];
  const keep = (element, rect) => {
    const [x, y, width, height] = clipped(element, rect);
    // Under 0.1 effective opacity a text has not appeared yet, or has gone.
    if (width > 0 && height > 0 && opacity(element) >= 0.1) rects.push([x, y, width, height].map(Math.round));
  };
  for (const element of root.querySelectorAll("text, .chip-plate")) keep(element, element.getBoundingClientRect());
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || node.parentElement.closest("svg")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    keep(node.parentElement, range.getBoundingClientRect());
  }
  return rects;
}

async function measureText(dir, placed, size = [1080, 1920]) {
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: size[0], height: size[1] });
    await page.evaluateOnNewDocument(() => {
      window.__timelines = {};
    });
    await page.goto(`file://${path.resolve(dir, "index.html")}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const measured = [];
    for (const cue of placed) {
      const boxes = [];
      for (const time of readTimes(cue)) boxes.push(...(await page.evaluate(visibleText, cue.id, time)));
      const unique = [...new Map(boxes.map((box) => [box.join(","), box])).values()];
      if (unique.length) measured.push({ clip: cue.id, name: cue.name ?? null, kind: cue.kind, at: cue.start, end: cue.stop, boxes: unique });
    }
    return measured;
  } finally {
    await browser.close();
  }
}

module.exports = { measureText };
