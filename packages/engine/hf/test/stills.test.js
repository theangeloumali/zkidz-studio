// Created by The Angelo Umali.
const test = require("node:test");
const assert = require("node:assert/strict");
const { stillBase } = require("../stills");

const EDL = {
  fps_num: 30,
  fps_den: 1,
  frames: 300,
  punch_crop: "crop=iw/1.08:ih/1.08",
  segments: [{ in: 0, out: 300, target: 0, zoom: 1 }],
  reframes: [{ start: 30, end: 90, cx: 0.5, cy: 0.5, scale: 1 }],
};
// A square picture letterboxed on the UHD canvas, as join_sources writes it for a 2160x2160 clip.
const BANDS = [{ at: 0, end: 10, band: [0, 840, 2160, 2160] }];

test("a still inside a reframe window shows the reframed 9:16 slice, as the master will (#41)", () => {
  const base = stillBase(EDL, BANDS, 60, 2);
  assert.match(base, /^crop=iw\*0\.5625:ih\*0\.5625:iw\*0\.21875:ih\*0\.21875,scale=1080:1920:flags=lanczos$/);
});

test("a still outside every reframe keeps the letterboxed frame, or the punch-in on a punched segment", () => {
  assert.equal(stillBase(EDL, BANDS, 10, 0.33), "null");
  const punched = { ...EDL, segments: [{ in: 0, out: 300, target: 0, zoom: 1.08 }] };
  assert.equal(stillBase(punched, BANDS, 10, 0.33), "crop=iw/1.08:ih/1.08,scale=1080:1920:flags=lanczos");
});
