// Created by The Angelo Umali.
// The full-screen brand intro: a 2 s pre-roll in the portfolio's dark brand-film look, then the Z-split that opens it over
// the video. Both draw fieldLayers, so the cut between the clips is invisible. Portrait goes in after a short's intro
// hookTitle (build.js); landscape after a vlog's cold open (brand_intro.py).
const { px, unit } = require("../brand/html");
const { rise, fade, pop, show, hide } = require("../fx/motion");
const { spring } = require("../fx/springs");
const { drawOn, glow } = require("../fx/ink");
const { tracking } = require("../fx/kinetic");
const { k, drawn, join, risingWords } = require("./parts");

const INTRO = {
  seconds: 2.0,
  split: 0.5, // the halves have cleared the frame
  seed: 4242, // one sketch seed for both clips, so the field draws identically in each
};
// Geometry per orientation. `travel` is how far each half slides along the cut's normal to clear the frame (checked by
// test_hf_render's corner test).
const LAYOUTS = {
  portrait: {
    size: [1080, 1920],
    logo: { height: 420, centre: [540, 780] },
    wordmark: { x: 540, baseline: 1130, align: "center" },
    kicker: { x: 540, baseline: 1196 },
    rules: { ys: [250, 1560], left: 90, width: 900 },
    dots: {
      bands: [
        [300, 540],
        [1290, 1520],
      ],
      left: 110,
      width: 860,
    },
    halo: [250, 290],
    travel: 1150,
  },
  landscape: {
    size: [1920, 1080],
    logo: { height: 380, centre: [600, 540] },
    wordmark: { x: 860, baseline: 566, align: "left" },
    kicker: { x: 864, baseline: 634 },
    rules: { ys: [140, 940], left: 160, width: 1600 },
    dots: {
      bands: [
        [175, 300],
        [780, 905],
      ],
      left: 200,
      width: 1520,
    },
    halo: [230, 265],
    travel: 1420,
  },
};
const FIELD = { seed: INTRO.seed };
const BG = "#07090C"; // portfolio FOUNDER_THEME.bg
const WORD = "#E6DDD2"; // portfolio SignatureLockup title
const GOLD_DIM = "rgba(201,168,56,0.45)";
const KICKER_SIZE = 34;
const ANCHOR = { center: "middle", left: "start" }; // the kicker lines up with the wordmark (canvas align)
const OVERLAP = 3; // px each half reaches past the cut
// Static film grain (the portfolio's GrainOverlay): dithers the glow, which bands on near-black once encoded.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='512' height='512'%3E%3Cfilter id='n'%3E" +
  "%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7' stitchTiles='stitch'/%3E" +
  "%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const introFrames = (fps) => Math.round(INTRO.seconds * fps);
const layoutOf = (cue) => LAYOUTS[cue.layout ?? "portrait"];

const logoScale = (L) => L.logo.height / k.Z_LOGO.height;
function logoBox(L) {
  const width = k.Z_LOGO.width * logoScale(L);
  const [cx, cy] = L.logo.centre;
  return [cx - width / 2, cy - L.logo.height / 2, width, L.logo.height];
}

// The Z's middle stroke (steel, top right to bottom left) carried across the frame: where the halves part.
function diagonal(L) {
  const [left, top] = logoBox(L);
  const scale = logoScale(L);
  const [, [ax, ay], [bx, by]] = k.Z_LOGO.tealPath.map(([x, y]) => [left + x * scale, top + y * scale]);
  const length = Math.hypot(bx - ax, by - ay);
  return { normal: [(ay - by) / length, (bx - ax) / length], xAt: (y) => ax + ((bx - ax) * (y - ay)) / (by - ay) };
}

// Seeded dots on a jittered grid in the bands above and below the lockup, linked to near neighbours (FloatingDots, frozen).
function dots(L, settled) {
  const random = k.mulberry32(INTRO.seed);
  const [above, below] = L.dots.bands;
  const column = L.dots.width / 7;
  const points = Array.from({ length: 14 }, (_, index) => {
    const [top, bottom] = index < 7 ? above : below;
    const x = L.dots.left + ((index % 7) + 0.5) * column + (random() - 0.5) * column * 0.6;
    return [x, top + random() * (bottom - top), 3 + random() * 5].map((value) => Math.round(value * 10) / 10);
  });
  const dash = `pathLength="1" stroke-dasharray="1 3" stroke-dashoffset="${settled ? 0 : 1.1}"`;
  const links = points.flatMap(([x1, y1], first) =>
    points
      .slice(first + 1)
      .filter(([x2, y2]) => Math.hypot(x2 - x1, y2 - y1) < 260)
      .map(([x2, y2]) => `<path class="intro-link" d="M${x1} ${y1} L${x2} ${y2}" ${dash}/>`),
  );
  const circles = points.map(([x, y, r]) => `<circle class="intro-dot" cx="${x}" cy="${y}" r="${r}"/>`);
  return unit("intro-dots", `<g stroke="${GOLD_DIM}" stroke-width="1.2" fill="${GOLD_DIM}">${links.join("")}${circles.join("")}</g>`);
}

const wordmark = (L, at = 0) =>
  risingWords(FIELD, "intro-word", "ZKidz Dev", L.wordmark.x, L.wordmark.baseline, { ...k.WORDMARK_FONT, size: 118 }, at, {
    align: L.wordmark.align,
    color: WORD,
  });

// Everything on the field but the logo. In the pre-roll each piece starts from its tween's from-state; `settled` draws
// the links whole for the split, which has no tweens on them.
function fieldLayers(L, settled) {
  const [top, bottom] = L.rules.ys;
  const [cx, cy] = L.logo.centre;
  const rule = (y, colour) => `<div class="intro-rule" style="left:${L.rules.left}px;top:${y}px;width:${L.rules.width}px;background:${colour}"></div>`;
  return (
    `<div class="intro-bg" style="background:${BG}"></div>` +
    `<div class="intro-glow" style="background:radial-gradient(circle at ${cx}px ${cy}px,` +
    `rgba(201,168,56,0.17) 0,rgba(201,168,56,0.05) 300px,rgba(201,168,56,0) 560px)"></div>` +
    `<div class="intro-grain" style="background-image:${GRAIN}"></div>` +
    rule(top, k.BRAND.gold) +
    rule(bottom, "rgba(236,231,222,0.22)") +
    dots(L, settled) +
    wordmark(L).html +
    unit(
      "intro-kicker",
      `<text x="${L.kicker.x}" y="${L.kicker.baseline}" text-anchor="${ANCHOR[L.wordmark.align]}" font-family="Inter" font-weight="600" ` +
        `font-size="${KICKER_SIZE}" letter-spacing="${0.18 * KICKER_SIZE}" fill="${k.BRAND.goldBright}">SOFTWARE ENGINEERING</text>`,
    )
  );
}

const logoImg = (L, pre) => {
  const [left, top, width, height] = logoBox(L);
  return `<img class="intro-logo${pre ? " pre" : ""}" src="brand/zkidz-dev-logo.png" alt="" style="left:${px(left)};top:${px(top)};width:${px(width)};height:${px(height)}">`;
};

const nodePop = (target, at, stagger) => pop(target, at, "snappy", { origin: "50% 50%", stagger });

// The logo's two strokes and nodes in Z_LOGO space, as the master draws them: steel bar over gold, butt ends, ring nodes.
function vectorZ(L) {
  const Z = k.Z_LOGO;
  const line = (points, colour, name) =>
    `<path class="${name}" d="M${points.map(([x, y]) => `${x} ${y}`).join(" L")}" fill="none" stroke="${colour}" stroke-width="${Z.bar}" ` +
    `stroke-linejoin="round" stroke-linecap="butt" pathLength="1" stroke-dasharray="1 3" stroke-dashoffset="1.1"/>`;
  const node = ([x, y], colour, name) =>
    `<circle class="${name}" cx="${x}" cy="${y}" r="${Z.nodeRadius}" fill="none" stroke="${colour}" stroke-width="${Z.nodeWidth}"/>`;
  const [left, top] = logoBox(L);
  return unit(
    "intro-vz",
    `<g transform="translate(${left} ${top}) scale(${logoScale(L)})">` +
      line(Z.tealPath, k.BRAND.logoSteel, "z-steel") +
      line(Z.goldPath, k.BRAND.logoGold, "z-gold") +
      node(Z.tealNode, k.BRAND.logoSteel, "z-snode") +
      node(Z.goldNode, k.BRAND.logoGold, "z-gnode") +
      `</g>`,
  );
}

// The pre-roll: the rules run out, dots and links appear, the Z draws on and settles into the master logo on the chime
// (the `intro` sound), the lockup rises under it; from ~1.65 s nothing moves.
const brandIntro = {
  sfx: () => [{ at: 0, sound: "intro" }],
  render(cue) {
    const L = layoutOf(cue);
    const { steel, gold, goldNode } = k.Z_BEATS;
    const [cx, cy] = L.logo.centre;
    const [rx, ry] = L.halo;
    const halo = drawn(FIELD, "intro-halo", (s) => s.sketchEllipse(cx, cy, rx, ry, { color: k.BRAND.goldBright, width: 4, passes: 1 }), [cx, cy], {
      pre: true,
    });
    return {
      html: fieldLayers(L, false) + halo + vectorZ(L) + logoImg(L, true),
      motion: [
        { target: ".intro-rule", at: 0, from: { scaleX: 0 }, to: { scaleX: 1, ...spring(), stagger: 0.08 } },
        fade(".intro-glow", 0, { duration: 0.8, ease: "power1.out" }),
        drawOn(".intro-link", 0.15, { duration: 0.4, stagger: 0.02 }),
        nodePop(".intro-dot", 0.05, 0.035),
        nodePop(".z-snode", 0.1),
        drawOn(".z-steel", 0.15, { duration: steel[1] - steel[0] }),
        drawOn(".z-gold", 0.15 + gold[0] - steel[0], { duration: gold[1] - gold[0] }),
        nodePop(".z-gnode", 0.1 + goldNode),
        // The drawn Z hands over to the master logo once both strokes are down.
        show(".intro-logo", 0.85),
        hide(".intro-vz", 0.92),
        glow(".intro-halo", 0.1 + goldNode, { duration: 0.6, fromScale: 0.85, scale: 1.25, fromOpacity: 0.9 }),
        ...wordmark(L, 0.9).motion,
        ...rise(".intro-kicker", 1.05, { distance: 18, scaleFrom: 1 }),
        tracking(".intro-kicker text", 1.05, 0.32 * KICKER_SIZE, 0.18 * KICKER_SIZE),
      ],
      exit: [], // the last frame is the split's first
    };
  },
};

// The settled field cut along the Z's diagonal, each half sliding away along the cut's normal over the footage and gone
// at INTRO.split. Each half reaches OVERLAP past the cut and far off frame on its own side (a clip polygon may leave its box).
function halves(L) {
  const { normal, xAt } = diagonal(L);
  const [w, h] = L.size;
  const field = fieldLayers(L, true);
  // Each half: its name, the side of the cut it keeps, and how far off frame it reaches.
  const sides = [
    ["intro-upper", 1, -1200],
    ["intro-lower", -1, w + 1220],
  ];
  const parts = sides.map(([name, sign, far]) => {
    const cut = (y) => xAt(y) + sign * OVERLAP;
    const polygon = [
      [far, 0],
      [cut(0), 0],
      [cut(h), h],
      [far, h],
    ];
    return {
      html: `<div class="intro-half ${name}" style="clip-path:polygon(${polygon.map(([x, y]) => `${px(x)} ${px(y)}`).join(",")})">${field}</div>`,
      motion: [
        {
          target: `.${name}`,
          at: 0,
          from: { x: 0, y: 0 },
          to: { x: sign * normal[0] * L.travel, y: sign * normal[1] * L.travel, duration: INTRO.split, ease: "power2.in" },
        },
        { target: `.${name}`, at: 0.2, from: { filter: "blur(0px)" }, to: { filter: "blur(8px)", duration: INTRO.split - 0.2, ease: "power1.in" } },
        // Off frame, but still overlapping its box: stop painting it.
        hide(`.${name}`, INTRO.split),
      ],
    };
  });
  return join(...parts);
}

// The split over the footage: the logo shrinks and fades as the halves part, on a whoosh.
const brandSplit = {
  sfx: () => [{ at: 0, sound: "whipOut" }],
  render(cue) {
    const L = layoutOf(cue);
    const field = halves(L);
    return {
      html: field.html + logoImg(L, false),
      motion: [
        ...field.motion,
        {
          target: ".intro-logo",
          at: 0,
          from: { opacity: 1, scale: 1, transformOrigin: "50% 50%" },
          to: { opacity: 0, scale: 0.6, transformOrigin: "50% 50%", duration: 0.45, ease: "power2.in" },
        },
      ],
      exit: [],
    };
  },
};

module.exports = { INTRO, LAYOUTS, introFrames, brandIntro, brandSplit };
