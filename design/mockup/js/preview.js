// Created by The Angelo Umali.
"use strict";

/* Screen 3, live preview: placeholder footage on canvas plus the HTML overlay layer, driven by the playhead. */

const canvas = $("#footage");
const context = canvas.getContext("2d");

function sizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  updatePlayback();
}

window.addEventListener("resize", sizeCanvas);

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function segmentAt(t) {
  return app.cutsApplied ? SEGMENTS.find((segment) => t >= segment.at && t < segment.end) : null;
}

/* Abstract stand-in for camera footage: light fields that drift with the playhead, still when paused. */
function drawFootage() {
  const { width, height } = canvas;
  if (!width) return;
  const t = app.time;
  context.fillStyle = token("--color-video-ink");
  context.fillRect(0, 0, width, height);
  const fields = [
    {
      color: token("--color-video-steel"),
      x: 0.3 + Math.sin(t * 0.35) * 0.12,
      y: 0.42 + Math.cos(t * 0.27) * 0.08,
      r: 0.75,
      alpha: 0.75,
    },
    {
      color: token("--color-video-gold-rule"),
      x: 0.78 + Math.cos(t * 0.22) * 0.1,
      y: 0.2 + Math.sin(t * 0.31) * 0.06,
      r: 0.5,
      alpha: 0.35,
    },
    {
      color: token("--color-video-paper"),
      x: 0.5,
      y: 0.62 + Math.sin(t * 0.5) * 0.02,
      r: 0.28,
      alpha: 0.18,
    },
  ];
  fields.forEach((field) => {
    const gradient = context.createRadialGradient(field.x * width, field.y * height, 0, field.x * width, field.y * height, field.r * height);
    gradient.addColorStop(0, field.color);
    gradient.addColorStop(1, "transparent");
    context.globalAlpha = field.alpha;
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
  context.globalAlpha = 0.7;
  context.fillStyle = token("--color-video-paper");
  context.font = `${Math.round(height * 0.022)}px ${token("--font-mono")}`;
  const segment = segmentAt(t);
  context.fillText(`placeholder footage · clip ${segment ? segment.clip : t < 107 ? "A" : "B"}`, width * 0.06, height * 0.04);
  context.globalAlpha = 1;
}

function updatePlayback() {
  const t = app.time;
  const punch = Boolean(segmentAt(t)?.punch);
  $("#player").dataset.punch = String(punch);
  $("#punch-flag").hidden = !punch;
  $("#timecode").textContent = `${formatTime(t)} / ${formatTime(duration())}`;
  const hookOn = app.cuesApplied.some((cue) => cue.kind === "hookTitle") && t < 3.2;
  $("#ov-hook").hidden = !hookOn;
  const chipCue = app.cuesApplied.find((cue) => cue.kind === "keyword");
  $("#ov-chip").hidden = !(chipCue && t >= chipCue.at && t < chipCue.end);
  const caption = app.captionsApplied ? CAPTIONS.find((line) => t >= line.at && t < line.end) : null;
  const captionNode = $("#ov-caption");
  captionNode.hidden = !caption || hookOn;
  if (caption) captionNode.textContent = caption.text;
  $("#playhead").style.setProperty("--x", `${(t / duration()) * $("#lane-video").clientWidth}px`);
  drawFootage();
}

let lastFrame = 0;
function playLoop(now) {
  if (!app.playing) return;
  const delta = lastFrame ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  app.time += delta;
  if (app.time >= duration()) {
    app.time = 0;
    setPlaying(false);
  }
  updatePlayback();
  if (app.playing) requestAnimationFrame(playLoop);
}

function setPlaying(playing) {
  app.playing = playing;
  const button = $("#play-btn");
  button.setAttribute("aria-label", playing ? "Pause" : "Play");
  button.replaceChildren(icon(playing ? "pause" : "play"));
  lastFrame = 0;
  if (playing) requestAnimationFrame(playLoop);
}

$("#play-btn").addEventListener("click", () => setPlaying(!app.playing));

$("#guides-toggle").addEventListener("click", (event) => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(on));
  $("#guides").hidden = !on;
});
