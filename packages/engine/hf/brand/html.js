// Created by The Angelo Umali.
// HTML for the brand look. A unit is one animatable piece (a card, a word, a row): a zero-size div at its parent's origin
// whose inline SVG draws in the parent's coordinates, so canvas geometry drops in unchanged. GSAP moves the div about
// `origin`, its anchor in those coordinates. A box is a sized div (a card) whose children draw in its own space.
const { num } = require("./recorder");

const px = (value) => `${num(value)}px`;

const ink = (fragment) => (fragment ? `<svg class="ink" width="1" height="1">${fragment}</svg>` : "");
const unit = (className, fragment, [x, y] = [0, 0], inner = "") =>
  `<div class="u ${className}" style="transform-origin:${px(x)} ${px(y)}">${ink(fragment)}${inner}</div>`;
const box = (className, [x, y, w, h], inner) =>
  `<div class="box ${className}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">${inner}</div>`;

// Strokes that draw on: each path measures 1 and starts dashed out of sight; fx/ink.js draws the dash in.
const drawable = (fragment) =>
  fragment.replace(/<path d="([^"]+)" fill="none"/g, '<path d="$1" pathLength="1" stroke-dasharray="1 3" stroke-dashoffset="1.1" fill="none"');

module.exports = { px, unit, box, drawable };
