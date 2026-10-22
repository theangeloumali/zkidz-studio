// Created by The Angelo Umali.
// The cinematic layer, drawn over the footage in the overlay: a dark scrim that dims the footage behind a card (the
// overlay cannot blur it), warm light leaks that sweep across the frame on the big moments, and a white impact flash.
// Leak blobs and the flash start hidden (.pre) and run on keyframes, so no from-state shows before its beat.
const { BOLD_EXIT } = require("./motion");

const px = (value) => `${Math.round(value)}px`;

// A soft dark ellipse behind [x, y, w, h], fading in with the card and out with its exit.
function scrim(name, [x, y, w, h], at, duration, { strength = 0.55 } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const html =
    `<div class="scrim ${name}" style="left:0;top:${px(y - 260)};width:1080px;height:${px(h + 520)};` +
    `background:radial-gradient(ellipse ${px(w * 0.9)} ${px(h * 0.95 + 200)} at ${px(cx)} ${px(cy - y + 260)},` +
    `rgba(8,12,18,${strength}) 0%,rgba(8,12,18,${strength * 0.6}) 45%,rgba(8,12,18,0) 100%)"></div>`;
  return {
    html,
    motion: [
      { target: `.${name}`, at, from: { opacity: 0 }, to: { opacity: 1, duration: 0.5, ease: "power1.out" } },
      {
        target: `.${name}`,
        at: duration - BOLD_EXIT,
        from: { opacity: 1 },
        to: { opacity: 0, duration: BOLD_EXIT, ease: "power1.in", immediateRender: false },
      },
    ],
  };
}

// Two warm blobs crossing the frame on opposite diagonals over ~1.4 s from `at`.
function lightLeak(name, at) {
  const blob = (index, colour) =>
    `<div class="leak-blob ${name}-b${index} pre" style="background:radial-gradient(circle,${colour} 0%,rgba(255,150,60,0.18) 38%,rgba(255,150,60,0) 70%)"></div>`;
  const sweep = (index, from, mid, to, delay) => ({
    target: `.${name}-b${index}`,
    at: at + delay,
    to: {
      keyframes: [
        { ...from, opacity: 0, duration: 0 },
        { ...mid, opacity: 0.85, duration: 0.6, ease: "power1.out" },
        { ...to, opacity: 0, duration: 0.8, ease: "power1.in" },
      ],
    },
  });
  return {
    html: `<div class="leak ${name}">${blob(0, "rgba(255,206,110,0.6)")}${blob(1, "rgba(255,170,90,0.5)")}</div>`,
    motion: [
      sweep(0, { x: -900, y: -300 }, { x: -100, y: 200 }, { x: 600, y: 700 }, 0),
      sweep(1, { x: 1100, y: 900 }, { x: 400, y: 500 }, { x: -300, y: 50 }, 0.15),
    ],
  };
}

// A white flash over the whole frame at an impact: up in two frames, gone in five.
const flash = (name, at, { peak = 0.5 } = {}) => ({
  html: `<div class="flash ${name} pre"></div>`,
  motion: [
    {
      target: `.${name}`,
      at,
      to: {
        keyframes: [
          { opacity: 0, duration: 0 },
          { opacity: peak, duration: 0.066, ease: "none" },
          { opacity: 0, duration: 0.17, ease: "power2.in" },
        ],
      },
    },
  ],
});

module.exports = { scrim, lightLeak, flash };
