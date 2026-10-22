// Created by The Angelo Umali.
// Cues the EDL derives (canvas labels.js and fx.js): the censor gag over a bleep, and the full-frame cutaway that hides a
// camera move and wipes off to the right over the footage after it. Plus the phone frame drawn round a portrait inset.
const { unit, box } = require("../brand/html");
const { rise, BOLD_EXIT } = require("../fx/motion");
const { spring } = require("../fx/springs");
const { roundedPoints } = require("./chat");
const { buzz } = require("../fx/impact");
const { lightLeak } = require("../fx/light");
const { k, drawn, join, NOTHING, risingWords, kicker, goldRule, zMark } = require("./parts");

// Censor: the canvas gag pops on the elastic spring and shakes the whole time (CENSOR_SHAKE).
const censor = {
  track: 4,
  render(cue, { duration }) {
    const centre = [cue.x, cue.y];
    return {
      html: unit(
        "buzz",
        "",
        centre,
        drawn(cue, "gag", (s) => s.drawScaled(...centre, 1, s.drawCensorGag), centre),
      ),
      motion: [...rise(".gag", 0, { preset: "elastic", scaleFrom: 0.3, distance: 0 }), buzz(".buzz", 0, duration)],
    };
  },
};

// Cutaway: opaque from its first frame to the end of `cover`, then wiped off left to right (ease in) behind a gold edge.
// "card" is the canvas's hatched paper with the woven Z, kicker, title and rule; "wipe" (short covers) is ink with the
// twin diagonals, held still.
const cutaway = {
  track: 4,
  render(cue, { duration }) {
    const { cover } = cue;
    const sheet = k.cutawayStyle(cue, cover) === "card" ? cardSheet(cue) : wipeSheet(k.isBareCutaway(cover) ? {} : cue, cue);
    const window = (left) => `inset(0px 0px 0px ${left}px)`;
    const tail = duration - cover;
    return {
      html: box("sheet", [0, 0, k.PW, k.PH], sheet.html) + (tail > 0 ? drawn(cue, "edge", (s) => s.wipeEdge(0, 0, k.PH), undefined, { pre: true }) : ""),
      motion: sheet.motion,
      exit:
        tail > 0
          ? [
              {
                target: ".sheet",
                at: cover,
                from: { clipPath: window(0) },
                to: { clipPath: window(k.PW), duration: tail, ease: "power2.in", immediateRender: false },
              },
              // Hidden (.pre) until the wipe starts: keyframes from CSS, not a from-state that would show from frame 0.
              {
                target: ".edge",
                at: cover,
                to: {
                  keyframes: [
                    { x: 0, opacity: 1, duration: 0 },
                    { x: k.PW, duration: tail, ease: "power2.in" },
                  ],
                },
              },
            ]
          : [],
    };
  },
};

function cardSheet(cue) {
  const { PW } = k;
  const { markTop, markHeight, markAt, kicker: kickerY, kickerAt, title, titleAt, rule, ruleAt } = k.CUTAWAY_CARD;
  const titleFont = k.cutawayTitleFont(cue.title);
  const titleWidth = k.textWidth(cue.title, titleFont);
  const parts = join(
    lightLeak("leak", 0),
    zMark(cue, "z", PW / 2 - k.zMarkWidth(markHeight) / 2, markTop, markHeight, markAt),
    cue.sub ? kicker(cue, "kicker", cue.sub, PW / 2 - k.kickerWidth(cue.sub) / 2, kickerY, kickerAt) : NOTHING,
    risingWords(cue, "title", cue.title, PW / 2, title, titleFont, titleAt, { align: "center" }),
    goldRule(cue, "rule", PW / 2 - titleWidth / 2, rule, titleWidth, ruleAt),
  );
  return { html: drawn(cue, "ground", (s) => s.drawCardGround()) + parts.html, motion: parts.motion };
}

// `label` is the cue, or nothing for a bare wipe under CUTAWAY_BARE_UNDER seconds of cover.
function wipeSheet(label, cue) {
  const { PW, CUTAWAY_WIPE } = k;
  const ground = drawn(cue, "ground", (s) => s.drawWipeGround(0));
  if (!label.title && !label.sub) return { html: ground, motion: [] };
  const { titleFont, plateWidth } = k.wipeLayout(label);
  const parts = join(
    label.sub ? kicker(cue, "kicker", label.sub, PW / 2 - k.kickerWidth(label.sub) / 2, CUTAWAY_WIPE.kicker, 0, { color: k.BRAND.goldBright }) : NOTHING,
    label.title
      ? risingWords(cue, "title", label.title, PW / 2, CUTAWAY_WIPE.title, titleFont, CUTAWAY_WIPE.titleAt, {
          align: "center",
          color: k.BRAND.copyOnInk,
          step: CUTAWAY_WIPE.step,
        })
      : NOTHING,
  );
  return { html: ground + drawn(cue, "plate", (s) => s.drawWipePlate(plateWidth)) + parts.html, motion: parts.motion };
}

// showcase.py PANELS["portrait"] on the 1080 grid (x, y, w, h): where the 9:16 inset sits in a vertical edit.
const PORTRAIT_PANEL = [253, 380, 574, 1020];
const PHONE = { bezel: 22, outer: 64, inner: 40, overlap: 3, camera: 5 };

// A rounded rect as an SVG subpath.
function roundedPath(x, y, w, h, r) {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

// Phone frame: a generic ink bezel round the portrait inset (its inner corners round off the panel's square ones), a light
// sketched rim that reads on dark and light films, a camera dot and side keys. It slides up, rights its tilt, then holds.
const phoneFrame = {
  track: 1,
  sfx: (cue, duration) => k.cardSfx(duration),
  render(cue, { duration }) {
    const { bezel, outer, inner, overlap, camera } = PHONE;
    const [x, y, w, h] = PORTRAIT_PANEL;
    const [ix, iy, iw, ih] = [x + overlap, y + overlap, w - 2 * overlap, h - 2 * overlap];
    const [ox, oy, ow, oh] = [ix - bezel, iy - bezel, iw + 2 * bezel, ih + 2 * bezel];
    const keys = [
      [ox + ow - 2, oy + 220, 7, 110],
      [ox - 5, oy + 190, 7, 70],
      [ox - 5, oy + 280, 7, 70],
    ];
    const svg =
      `<path d="${roundedPath(ox, oy, ow, oh, outer)}${roundedPath(ix, iy, iw, ih, inner)}" fill="${k.BRAND.ink}" fill-rule="evenodd"/>` +
      keys.map(([kx, ky, kw, kh]) => `<rect x="${kx}" y="${ky}" width="${kw}" height="${kh}" rx="3" fill="${k.BRAND.ink}"/>`).join("") +
      `<circle cx="${ox + ow / 2}" cy="${oy + bezel / 2 + 1}" r="${camera}" fill="${k.BRAND.lineStrong}"/>`;
    const edge = drawn(cue, "edge", (s) =>
      s.sketchPath(roundedPoints(ox, oy, ow, oh, [outer, outer, outer, outer]), { color: k.BRAND.steelOnInk, width: 2.5, passes: 1, rough: 0.6 }),
    );
    const tilt = cue.tilt ?? -6;
    return {
      html: unit("phone", "", [ox + ow / 2, oy + oh], unit("bezel", svg) + edge),
      motion: [
        { target: ".phone", at: 0, from: { y: 160, rotation: tilt }, to: { y: 0, rotation: 0, ...spring("standard") } },
        { target: ".phone", at: 0, from: { opacity: 0 }, to: { opacity: 1, duration: 0.25, ease: "power1.out" } },
      ],
      exit: [
        {
          target: ".phone",
          at: duration - BOLD_EXIT,
          from: { y: 0, opacity: 1 },
          to: { y: 60, opacity: 0, duration: BOLD_EXIT, ease: "power2.in", immediateRender: false },
        },
      ],
    };
  },
};

module.exports = { censor, cutaway, phoneFrame, PORTRAIT_PANEL, roundedPath };
