// Created by The Angelo Umali.
// A 2D-context stand-in that records what the canvas brand code draws as SVG: paths in page coordinates (transforms
// applied), text as <text> under its matrix. It covers only the calls the kit and overlay helpers make, and throws on others.
const { advanceWidth, inkLeft } = require("./fonts");

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];
const scaleOf = ([a, b, c, d]) => Math.sqrt(Math.abs(a * d - b * c));
const isSimilarity = ([a, b, c, d]) => Math.abs(a - d) < 1e-9 && Math.abs(b + c) < 1e-9;

function num(value) {
  if (!Number.isFinite(value)) throw new Error(`recorder: non-finite coordinate ${value}`);
  return String(Math.round(value * 100) / 100);
}
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeXml = (text) => String(text).replace(/[&<>"]/g, (character) => ESCAPES[character]);
const FONT = /^(italic )?(\d+) ([\d.]+)px "([^"]+)"$/;
const ANCHORS = { left: "start", start: "start", center: "middle", right: "end", end: "end" };
const BASELINES = { alphabetic: null, middle: "central", top: "text-before-edge", hanging: "hanging", bottom: "text-after-edge", ideographic: "ideographic" };

class SvgRecorder {
  constructor(idPrefix = "k") {
    this.idPrefix = idPrefix;
    this.ids = 0;
    this.out = [];
    this.path = [];
    this.stack = [];
    this.state = {
      matrix: IDENTITY,
      globalAlpha: 1,
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      font: '400 10px "Inter"',
      textAlign: "start",
      textBaseline: "alphabetic",
      letterSpacing: "0px",
      dash: [],
      clip: null,
    };
  }

  // Everything drawn while `draw` runs, as one SVG fragment (its clip paths included).
  capture(draw) {
    const outer = this.out;
    this.out = [];
    try {
      draw();
      return this.out.join("");
    } finally {
      this.out = outer;
    }
  }

  save() {
    this.stack.push({ ...this.state });
  }
  restore() {
    if (this.stack.length) this.state = this.stack.pop();
  }
  transform(a, b, c, d, e, f) {
    this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
  }
  setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.state.matrix = [a, b, c, d, e, f];
  }
  translate(x, y) {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x, y) {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(angle) {
    this.transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0);
  }
  setLineDash(segments) {
    this.state.dash = [...segments];
  }
  getLineDash() {
    return [...this.state.dash];
  }

  point(x, y) {
    const [px, py] = apply(this.state.matrix, x, y);
    return `${num(px)} ${num(py)}`;
  }
  beginPath() {
    this.path = [];
  }
  moveTo(x, y) {
    this.path.push(`M${this.point(x, y)}`);
  }
  lineTo(x, y) {
    this.path.push(`${this.path.length ? "L" : "M"}${this.point(x, y)}`);
  }
  quadraticCurveTo(cx, cy, x, y) {
    this.path.push(`Q${this.point(cx, cy)} ${this.point(x, y)}`);
  }
  closePath() {
    if (this.path.length) this.path.push("Z");
  }
  rect(x, y, w, h) {
    this.path.push(`M${this.point(x, y)}L${this.point(x + w, y)}L${this.point(x + w, y + h)}L${this.point(x, y + h)}Z`);
  }
  // Arcs stay arcs under a rotation and uniform scale (all the brand code uses); anything else is refused.
  ellipse(cx, cy, rx, ry, rotation, start, end, anticlockwise = false) {
    const matrix = this.state.matrix;
    if (!isSimilarity(matrix)) throw new Error("recorder: an ellipse under a skew or uneven scale");
    const scale = scaleOf(matrix);
    const turn = Math.atan2(matrix[1], matrix[0]);
    const at = (angle) => {
      const x = Math.cos(angle) * rx;
      const y = Math.sin(angle) * ry;
      return this.point(cx + x * Math.cos(rotation) - y * Math.sin(rotation), cy + x * Math.sin(rotation) + y * Math.cos(rotation));
    };
    const sweep = anticlockwise ? -1 : 1;
    const turns = (end - start) * sweep;
    const span = turns >= 2 * Math.PI ? 2 * Math.PI : ((turns % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const arc = `A${num(rx * scale)} ${num(ry * scale)} ${num(((rotation + turn) * 180) / Math.PI)} `;
    this.path.push(`${this.path.length ? "L" : "M"}${at(start)}`);
    // Two halves for a full turn: one SVG arc cannot end where it starts.
    const pieces = span > Math.PI ? 2 : 1;
    for (let piece = 1; piece <= pieces; piece++) {
      const angle = start + (sweep * span * piece) / pieces;
      this.path.push(`${arc}0 ${anticlockwise ? 0 : 1} ${at(angle)}`);
    }
  }
  arc(x, y, radius, start, end, anticlockwise) {
    this.ellipse(x, y, radius, radius, 0, start, end, anticlockwise);
  }
  roundRect(x, y, w, h, radii = 0) {
    const radius = Math.min(Array.isArray(radii) ? radii[0] : radii, w / 2, h / 2);
    this.moveTo(x + radius, y);
    this.lineTo(x + w - radius, y);
    this.ellipse(x + w - radius, y + radius, radius, radius, 0, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - radius);
    this.ellipse(x + w - radius, y + h - radius, radius, radius, 0, 0, Math.PI / 2);
    this.lineTo(x + radius, y + h);
    this.ellipse(x + radius, y + h - radius, radius, radius, 0, Math.PI / 2, Math.PI);
    this.lineTo(x, y + radius);
    this.ellipse(x + radius, y + radius, radius, radius, 0, Math.PI, 1.5 * Math.PI);
    this.closePath();
  }

  paint(attributes, d = this.path.join("")) {
    const opacity = this.state.globalAlpha < 1 ? ` opacity="${num(this.state.globalAlpha)}"` : "";
    this.emit(`<path d="${d}" ${attributes}${opacity}/>`);
  }
  emit(element) {
    this.out.push(this.state.clip ? `<g clip-path="url(#${this.state.clip})">${element}</g>` : element);
  }
  colour(style) {
    if (typeof style !== "string") throw new Error("recorder: gradients and patterns are not supported");
    return escapeXml(style);
  }
  stroke() {
    if (!this.path.length) return;
    const scale = scaleOf(this.state.matrix);
    const dash = this.state.dash.length ? ` stroke-dasharray="${this.state.dash.map((length) => num(length * scale)).join(" ")}"` : "";
    this.paint(
      `fill="none" stroke="${this.colour(this.state.strokeStyle)}" stroke-width="${num(this.state.lineWidth * scale)}" ` +
        `stroke-linecap="${this.state.lineCap}" stroke-linejoin="${this.state.lineJoin}"${dash}`,
    );
  }
  // A Path2D is SVG path data in its own space, so it keeps it and draws under the current matrix.
  fill(path) {
    const colour = `fill="${this.colour(this.state.fillStyle)}"`;
    if (path === undefined) {
      if (this.path.length) this.paint(colour);
      return;
    }
    if (!path.d) throw new Error("recorder: only a Path2D built from SVG path data can be filled");
    this.paint(`transform="matrix(${this.state.matrix.map(num).join(" ")})" ${colour}`, path.d);
  }
  fillRect(x, y, w, h) {
    const outer = this.path;
    this.path = [];
    this.rect(x, y, w, h);
    this.fill();
    this.path = outer;
  }
  // The clip is the current path intersected with any clip already in force.
  clip(path) {
    if (path !== undefined) throw new Error("recorder: clip(Path2D) is not supported");
    const id = `${this.idPrefix}-clip${++this.ids}`;
    const outer = this.state.clip ? ` clip-path="url(#${this.state.clip})"` : "";
    this.out.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"${outer}><path d="${this.path.join("")}"/></clipPath>`);
    this.state.clip = id;
  }

  parsedFont() {
    const match = FONT.exec(this.state.font);
    if (!match) throw new Error(`recorder: unreadable font "${this.state.font}"`);
    return { italic: Boolean(match[1]), weight: Number(match[2]), size: Number(match[3]), family: match[4] };
  }
  tracking() {
    return parseFloat(this.state.letterSpacing) || 0;
  }
  // Chrome's canvas counts the letter space after the last character too.
  measureText(text) {
    const font = this.parsedFont();
    return {
      width: advanceWidth(text, font) + this.tracking() * [...String(text)].length,
      get actualBoundingBoxLeft() {
        return inkLeft(text, font);
      },
    };
  }
  text(text, x, y, paint) {
    const { italic, weight, size, family } = this.parsedFont();
    const [a, b, c, d, e, f] = this.state.matrix;
    const transform = this.state.matrix === IDENTITY ? "" : ` transform="matrix(${[a, b, c, d, e, f].map(num).join(" ")})"`;
    const anchor = ANCHORS[this.state.textAlign] === "start" ? "" : ` text-anchor="${ANCHORS[this.state.textAlign]}"`;
    const baseline = BASELINES[this.state.textBaseline] ? ` dominant-baseline="${BASELINES[this.state.textBaseline]}"` : "";
    const spacing = this.tracking() ? ` letter-spacing="${num(this.tracking())}"` : "";
    const opacity = this.state.globalAlpha < 1 ? ` opacity="${num(this.state.globalAlpha)}"` : "";
    this.emit(
      `<text x="${num(x)}" y="${num(y)}"${transform} font-family="${escapeXml(family)}" font-size="${num(size)}" font-weight="${weight}"` +
        `${italic ? ' font-style="italic"' : ""}${spacing}${anchor}${baseline} ${paint}${opacity} style="white-space:pre">${escapeXml(text)}</text>`,
    );
  }
  fillText(text, x, y) {
    this.text(text, x, y, `fill="${this.colour(this.state.fillStyle)}"`);
  }
  strokeText(text, x, y) {
    const width = num(this.state.lineWidth);
    this.text(text, x, y, `fill="none" stroke="${this.colour(this.state.strokeStyle)}" stroke-width="${width}" stroke-linejoin="${this.state.lineJoin}"`);
  }
}

// Kit code sets these as plain properties; they live on the state so save/restore covers them.
for (const key of ["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "font", "textAlign", "textBaseline", "letterSpacing"]) {
  Object.defineProperty(SvgRecorder.prototype, key, {
    get() {
      return this.state[key];
    },
    set(value) {
      this.state[key] = value;
    },
  });
}

module.exports = { SvgRecorder, num, escapeXml };
