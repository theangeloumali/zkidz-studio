// Created by The Angelo Umali.
// ZKidz brand layer over the kit: tokens, one load-time palette remap, type roles and the terminal palette.
const BRAND = {
  ink: Z.ink,
  muted: Z.muted,
  lineStrong: Z.lineStrong,
  steel: Z.steel,
  gold: Z.gold, // rules and fills only: 2.0:1 on paper
  goldInk: Z.goldInk,
  paper: Z.fill,
  white: "#ffffff",
  line: "rgba(70, 98, 125, 0.18)",
  goldBright: "#d5b13a",
  steelOnInk: "#8ea9c4",
  copyOnInk: "#ece7de",
  mutedOnInk: "#95a3b3",
  negative: C.accentDark,
  logoSteel: C.teal,
  logoGold: C.gold,
};

// Kit and agents read these at draw time, so one remap rebrands every implicit default (strokes, text, shadows).
// accent, sky, olive, teal and gold keep their identities (props, the logo master).
// A theme re-runs it after changing BRAND (hf/brand/canvas.js applyTheme).
function remapKitPalette() {
  Object.assign(C, {
    ink: BRAND.ink,
    paper: BRAND.paper,
    white: BRAND.white,
    gray: BRAND.muted,
    lightGray: BRAND.mutedOnInk,
  });
}
remapKitPalette();

// Font objects for drawText/applyFont. trackingEm is read by trackedText/kicker only (applyFont takes px).
// Sizes are on-screen px at 1080 wide, which a phone shows at ~0.36x: kickers stay >= 32 px (~11.5 pt on a phone).
const INTER = "Inter";
const TYPE = {
  display: { family: FONT.serif, size: 96, weight: 600 },
  body: { family: INTER, size: 36, weight: 500 },
  label: { family: INTER, size: 32, weight: 600 },
  kicker: { family: INTER, size: 32, weight: 600, trackingEm: 0.18 },
  hand: { family: FONT.hand, size: 64, weight: 700 },
  mono: { family: FONT.mono, size: 32, weight: 600 },
};

// A table of BRAND/TYPE values rebuilt on every read: a theme (applyTheme) changes them after the files that hold the
// table load, so a plain const would keep the zkidz defaults. Read-only; spread it to get a plain object.
function themed(build) {
  return new Proxy(
    {},
    {
      get: (_, key) => build()[key],
      has: (_, key) => key in build(),
      ownKeys: () => Reflect.ownKeys(build()),
      // configurable: a proxy may not report a non-configurable key its empty target lacks (an array's length).
      getOwnPropertyDescriptor: (_, key) => {
        const own = Reflect.getOwnPropertyDescriptor(build(), key);
        return own && { ...own, configurable: true, writable: false };
      },
      set: () => {
        throw new TypeError("a themed table is read-only");
      },
    },
  );
}

// drawTerminal palette; `block` keeps the kit's #E07A5F (5.44:1 on ink).
const TERMINAL_BRAND = themed(() => ({
  background: BRAND.ink,
  edge: BRAND.lineStrong,
  bar: "#121922", // site dark bg-elevated
  muted: BRAND.mutedOnInk,
  colors: {
    input: BRAND.mutedOnInk,
    output: BRAND.copyOnInk,
    warn: BRAND.goldBright,
    pass: BRAND.steelOnInk,
  },
}));
