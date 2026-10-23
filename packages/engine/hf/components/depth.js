// Created by The Angelo Umali.
// Kinds made for the person matte (render.js --layer behind draws a cue with depth "behind" under him): a full-bleed
// backdrop he stands in front of, a paper sheet with a polaroid window his head breaks out of, and his frozen cutout
// slapped on as a sticker. `image: true` makes build.js copy the cue's src into the composition.
const { k } = require("./parts");
const { roundedPath } = require("./fx");
const { px, unit, box } = require("../brand/html");
const { BOLD_EXIT } = require("../fx/motion");
const { spring } = require("../fx/springs");

const WIPE_IN = 0.45;
const BLEED = 4; // the clip's antialiased edge falls off-frame, or the frame's last row and column let footage through

// Backdrop: the image full-bleed, wiped on left to right with a slight settle, wiped off the same way.
const backdrop = {
  image: true,
  track: 0,
  sfx: (cue, duration) => k.cardSfx(duration),
  render(cue, { duration }) {
    const fit = cue.fit === "contain" ? "contain" : "cover";
    const image = `<img class="plate" src="${cue.src}" alt="" style="width:100%;height:100%;object-fit:${fit};display:block">`;
    return {
      html: box("backdrop", [-BLEED, -BLEED, k.PW + 2 * BLEED, k.PH + 2 * BLEED], image),
      motion: [
        {
          target: ".backdrop",
          at: 0,
          from: { clipPath: `inset(0px ${k.PW}px 0px 0px)` },
          to: { clipPath: "inset(0px 0px 0px 0px)", duration: WIPE_IN, ease: "power3.out" },
        },
        { target: ".plate", at: 0, from: { scale: 1.06 }, to: { scale: 1, duration: 1.2, ease: "power2.out" } },
      ],
      exit: [
        {
          target: ".backdrop",
          at: duration - BOLD_EXIT,
          from: { clipPath: "inset(0px 0px 0px 0px)" },
          to: { clipPath: `inset(0px 0px 0px ${k.PW}px)`, duration: BOLD_EXIT, ease: "power2.in", immediateRender: false },
        },
      ],
    };
  },
};

const SLAP = 0.18; // the cutout lands this long after the cue starts
const OUTLINE = 14; // the white rim on screen, px

// Paper cutout: his frozen matte (a 1080x1920 RGBA PNG) as a sticker, a white rim dilated from its alpha and a soft drop
// shadow, slapped down with a small rotation that settles on the snappy spring.
const paperCutout = {
  image: true,
  track: 3,
  sfx: (cue, duration) => [{ at: SLAP, sound: "thud" }, ...k.cardSfx(duration).filter((event) => event.sound === "swishOut")],
  render(cue, { id, duration }) {
    const scale = cue.scale ?? 0.5;
    const rot = cue.rot ?? -4;
    const [w, h] = [k.PW * scale, k.PH * scale];
    const [x, y] = [cue.x ?? k.PW / 2, cue.y ?? k.PH / 2];
    const filter = `${id}-sticker`;
    // Sized in CSS px (not a scale transform), so the dilate radius is the rim's width on screen.
    const defs =
      `<svg width="0" height="0" style="position:absolute"><filter id="${filter}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
      `<feMorphology in="SourceAlpha" operator="dilate" radius="${OUTLINE}" result="grow"/><feFlood flood-color="${k.BRAND.white}"/>` +
      `<feComposite in2="grow" operator="in" result="rim"/><feMerge result="sticker"><feMergeNode in="rim"/><feMergeNode in="SourceGraphic"/></feMerge>` +
      `<feDropShadow in="sticker" dx="0" dy="16" stdDeviation="14" flood-color="#000" flood-opacity="0.4"/></filter></svg>`;
    const image = `<img src="${cue.src}" alt="" style="width:${px(w)};height:${px(h)};display:block;filter:url(#${filter})">`;
    return {
      html: defs + box("sticker", [x - w / 2, y - h / 2, w, h], image),
      motion: [
        {
          target: ".sticker",
          at: 0,
          from: { y: -90, scale: 1.3, rotation: rot + 9 },
          to: { y: 0, scale: 1, rotation: rot, duration: SLAP, ease: "power3.in" },
        },
        { target: ".sticker", at: 0, from: { opacity: 0 }, to: { opacity: 1, duration: 0.08, ease: "power1.out" } },
        // The give after the slap, then rest.
        {
          target: ".sticker",
          at: SLAP,
          from: { scale: 0.96, rotation: rot - 2 },
          to: { scale: 1, rotation: rot, immediateRender: false, ...spring("snappy") },
        },
      ],
      exit: [
        {
          target: ".sticker",
          at: duration - BOLD_EXIT,
          from: { y: 0, opacity: 1, rotation: rot },
          to: { y: -60, opacity: 0, rotation: rot - 6, duration: BOLD_EXIT, ease: "power3.in", immediateRender: false },
        },
      ],
    };
  },
};

const BORDER = { side: 26, bottom: 96, radius: 4 }; // polaroid: an even rim and a deep chin
const SHEET_BLEED = 1100; // the sheet runs this far past the frame, so its tilt and entrance never show an edge

// Frame escape: a paper sheet over the whole frame but a window, with a polaroid rim round the window. Drawn behind him,
// the matte puts him in the window and his head over its top edge. It closes in from wide, tilting as it lands.
const frameEscape = {
  track: 0,
  sfx: (cue, duration) => k.cardSfx(duration),
  render(cue, { id, duration }) {
    const { x = 140, y = 420, w = 800, h = 900, tilt = -4 } = cue;
    const { side, bottom, radius } = BORDER;
    const window = roundedPath(x, y, w, h, 0);
    const shadow = `${id}-rim`;
    const svg =
      `<defs><filter id="${shadow}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.35"/></filter></defs>` +
      `<path d="${roundedPath(-SHEET_BLEED, -SHEET_BLEED, k.PW + 2 * SHEET_BLEED, k.PH + 2 * SHEET_BLEED, 0)}${window}" fill="${k.BRAND.paper}" fill-rule="evenodd"/>` +
      `<path d="${roundedPath(x - side, y - side, w + 2 * side, h + side + bottom, radius)}${window}" fill="${k.BRAND.white}" fill-rule="evenodd" filter="url(#${shadow})"/>` +
      `<path d="${window}" fill="none" stroke="${k.BRAND.line}" stroke-width="3"/>`;
    return {
      html: unit("sheet", svg, [x + w / 2, y + h / 2]),
      motion: [
        { target: ".sheet", at: 0, from: { scale: 1.9, rotation: 0 }, to: { scale: 1, rotation: tilt, ...spring("standard") } },
        { target: ".sheet", at: 0, from: { opacity: 0 }, to: { opacity: 1, duration: 0.2, ease: "power1.out" } },
      ],
      exit: [
        {
          target: ".sheet",
          at: duration - BOLD_EXIT,
          from: { scale: 1, rotation: tilt, opacity: 1 },
          to: { scale: 1.9, rotation: 0, opacity: 0, duration: BOLD_EXIT, ease: "power3.in", immediateRender: false },
        },
      ],
    };
  },
};

module.exports = { backdrop, paperCutout, frameEscape };
