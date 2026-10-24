// Created by The Angelo Umali.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const PLAYER_SOURCE = fs.readFileSync(path.join(__dirname, "..", "player.js"), "utf8");

/** Runs player.js against a stub page of back-to-back one-second clips, one tween each; records writes and seeks. */
function loadPlayer(clipCount) {
  const liveToggles = [];
  const seekedTargets = [];
  const builtTargets = [];
  const clips = Array.from({ length: clipCount }, (_, index) => {
    const classList = { toggle: (name, isOn) => liveToggles.push({ index, name, isOn }) };
    return { id: `c${index}`, dataset: { start: String(index), duration: "1" }, classList };
  });
  const tweens = clips.map((clip) => ({ target: `#${clip.id} .word`, at: Number(clip.dataset.start), to: { opacity: 1 } }));
  const root = { dataset: { duration: String(clipCount), width: "1080", height: "1920" }, style: {} };
  const jsonScripts = { "hf-eases": "{}", "hf-tweens": JSON.stringify(tweens) };
  const document = {
    querySelectorAll: (selector) => (selector === ".clip" ? clips : []),
    getElementById: (id) => (id === "root" ? root : { textContent: jsonScripts[id] }),
  };
  const gsap = {
    registerPlugin() {},
    timeline: () => {
      const targets = [];
      const add = (target) => targets.push(target) && builtTargets.push(target);
      return { set: add, fromTo: add, to: add, seek: () => seekedTargets.push(...targets) };
    },
  };
  const listeners = {};
  const parent = { postMessage() {} };
  const window = { parent, innerWidth: 306, addEventListener: (type, listener) => (listeners[type] = listener) };
  vm.runInNewContext(PLAYER_SOURCE, { document, window, gsap, CustomEase: { create() {} } });
  const seek = (time) => listeners.message({ source: parent, data: { type: "zks.preview.seek", time } });
  const resizeTo = (innerWidth) => {
    window.innerWidth = innerWidth;
    listeners.resize?.();
  };
  return { seek, resizeTo, root, liveToggles, seekedTargets, builtTargets };
}

test("a seek toggles .live only on the clips whose state changed, so 2,000 cues cost a frame nothing", () => {
  const { seek, liveToggles } = loadPlayer(2000);
  seek(10.2);
  liveToggles.length = 0;
  seek(10.5);
  assert.deepEqual(liveToggles, []);
  seek(11.1);
  assert.deepEqual(liveToggles, [
    { index: 10, name: "live", isOn: false },
    { index: 11, name: "live", isOn: true },
  ]);
});

test("a seek renders only the tweens of clips live at that time", () => {
  const { seek, seekedTargets } = loadPlayer(2000);
  seekedTargets.length = 0;
  seek(10.5);
  assert.deepEqual(seekedTargets, ["#c10 .word"]);
});

test("a clip's tweens are built the first time it is live, so loading 2,000 cues forces no layout per tween", () => {
  const { seek, builtTargets } = loadPlayer(2000);
  assert.deepEqual(builtTargets, ["#c0 .word"]);
  seek(10.5);
  seek(10.6);
  assert.deepEqual(builtTargets, ["#c0 .word", "#c10 .word"]);
});

test("the 1080x1920 composition scales to the frame's width, and follows a resize", () => {
  const { root, resizeTo } = loadPlayer(1);
  assert.equal(root.style.width, "1080px");
  assert.equal(root.style.height, "1920px");
  assert.equal(root.style.transformOrigin, "0 0");
  assert.equal(root.style.transform, `scale(${306 / 1080})`);
  resizeTo(540);
  assert.equal(root.style.transform, "scale(0.5)");
});
