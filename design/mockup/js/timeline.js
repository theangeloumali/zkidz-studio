// Created by The Angelo Umali.
"use strict";

/* Screen 3, edit model: segments, captions, cues, the four timeline tracks and the media bin. */

function buildSegments() {
  const random = seeded(7);
  const lengths = Array.from({ length: 39 }, () => 1.8 + random() * 3.2);
  const scale = EDIT_SECONDS / lengths.reduce((sum, length) => sum + length, 0);
  let at = 0;
  // The engine alternates the 1.08x punch-in across jump cuts, so every other shot is punched.
  return lengths.map((length, index) => {
    const segment = {
      at,
      end: at + length * scale,
      punch: index % 2 === 1,
      clip: index < 22 ? "A" : "B",
    };
    at = segment.end;
    return segment;
  });
}

const CAPTION_LINES = [
  "So I stopped editing my videos by hand.",
  "Every pause and every “uh” is gone in one pass.",
  "I talk in Taglish, and it still gets it right.",
  "The Tagalog lines become English captions.",
  "And the swears? Masked. ****",
  "It runs on my own computer, with my own Claude.",
  "I drop the clips in and say what I want.",
  "Then I watch it work, step by step.",
  "Nothing renders until I say yes.",
  "The 4K master comes out on my GPU.",
];

function buildCaptions() {
  const random = seeded(11);
  const captions = [];
  let at = 0.4;
  let index = 0;
  while (at < EDIT_SECONDS - 1.5) {
    const length = 1.6 + random() * 1.8;
    captions.push({
      at,
      end: Math.min(at + length, EDIT_SECONDS),
      text: CAPTION_LINES[index % CAPTION_LINES.length],
    });
    at += length + 0.12;
    index += 1;
  }
  return captions;
}

const SEGMENTS = buildSegments();
const CAPTIONS = buildCaptions();
const CUES = [
  { kind: "hookTitle", at: 0, end: 3.2 },
  { kind: "lowerThird", at: 4, end: 8.5 },
  { kind: "keyword", at: 14, end: 18.5 },
  { kind: "pipeline", at: 38, end: 47 },
  { kind: "handNote", at: 66, end: 72 },
  { kind: "criteriaCard", at: 90, end: 99 },
];
/* Source-time removals the agent proposes, drawn struck through before they are applied. */
const PROPOSED_CUTS = [
  { at: 0, end: 2.4, label: "silence" },
  { at: 31.8, end: 33.1, label: "pause" },
  { at: 64.2, end: 82.8, label: "retake" },
  { at: 121, end: 126.5, label: "pauses" },
  { at: 160.2, end: 168, label: "pauses" },
];
const BLUR_SPAN = { at: 52, end: 56, label: "Blur · email address on screen" };

function duration() {
  return app.cutsApplied ? EDIT_SECONDS : RAW_SECONDS;
}

function pct(seconds) {
  return `${(seconds / duration()) * 100}%`;
}

function block(lane, className, at, end, label, isFresh) {
  const node = h(
    "div",
    {
      class: `blk ${className}`,
      title: label || null,
      dataset: isFresh ? { fresh: "true" } : {},
    },
    label || "",
  );
  node.style.left = pct(at);
  node.style.width = `calc(${pct(end - at)} - 2px)`;
  lane.append(node);
  return node;
}

function marker(lane, className, at, title, isFresh) {
  const node = h("span", {
    class: className,
    title,
    dataset: isFresh ? { fresh: "true" } : {},
  });
  node.style.left = pct(at);
  lane.append(node);
  return node;
}

function drawRuler() {
  const ruler = $("#ruler");
  ruler.replaceChildren();
  const step = app.cutsApplied ? 10 : 20;
  for (let at = 0; at < duration(); at += step) {
    const tick = h("span", { class: "tick" }, formatClock(at));
    tick.style.left = pct(at);
    ruler.append(tick);
  }
}

function drawVideoLane(isFresh, showProposal = false) {
  const lane = $("#lane-video");
  lane.replaceChildren();
  if (!app.cutsApplied) {
    block(lane, "blk-raw", 0, 107, "clip A · uncut", isFresh);
    block(lane, "blk-raw", 107, RAW_SECONDS, "clip B · uncut", isFresh);
    if (showProposal) PROPOSED_CUTS.forEach((cut) => block(lane, "blk-cut", cut.at, cut.end, "", true).setAttribute("title", `Proposed cut · ${cut.label}`));
    return;
  }
  SEGMENTS.forEach((segment, index) => {
    const node = block(lane, segment.punch ? "blk-punch" : "blk-seg", segment.at, segment.end, "", isFresh);
    node.title = `${segment.clip} · shot ${index + 1}${segment.punch ? " · 1.08× punch-in" : ""}`;
    if (isFresh) node.style.animationDelay = `${index * 12}ms`;
    if (index > 0) marker(lane, "mark-cut", segment.at, "Cut", isFresh);
  });
  block(lane, "blk-blur", BLUR_SPAN.at, BLUR_SPAN.end, "", isFresh).title = BLUR_SPAN.label;
}

function drawCaptionLane(isFresh) {
  const lane = $("#lane-captions");
  lane.replaceChildren();
  if (!app.captionsApplied) return;
  CAPTIONS.forEach((caption, index) => {
    const node = block(lane, "blk-cap", caption.at, caption.end, "", isFresh);
    if (isFresh) node.style.animationDelay = `${index * 10}ms`;
  });
}

function addCueBlock(cue, isFresh) {
  block($("#lane-cues"), "blk-cue", cue.at, cue.end, cue.kind, isFresh);
  marker($("#lane-sfx"), "sfx", cue.at, `SFX for ${cue.kind}`, isFresh);
}

function updateTimelineMeta() {
  $("#timeline-meta").textContent = app.cutsApplied
    ? `Edited · ${formatClock(EDIT_SECONDS)} (from ${formatClock(RAW_SECONDS)})`
    : `Uncut · ${formatClock(RAW_SECONDS)}`;
}

function drawTimeline() {
  drawRuler();
  drawVideoLane(false);
  drawCaptionLane(false);
  $("#lane-cues").replaceChildren();
  $("#lane-sfx").replaceChildren();
  app.cuesApplied.forEach((cue) => addCueBlock(cue, false));
  updateTimelineMeta();
  updatePlayback();
}

/* Click the timeline to seek. */
$("#timeline").addEventListener("click", (event) => {
  const lane = $("#lane-video").getBoundingClientRect();
  if (event.clientX < lane.left) return;
  app.time = Math.min(Math.max(0, ((event.clientX - lane.left) / lane.width) * duration()), duration() - 0.05);
  updatePlayback();
});

/* File names come from the user's disk, so they go in as text, never markup. */
function binItem(clip) {
  return h(
    "li",
    { class: "bin-item", dataset: { fresh: "true" } },
    h("span", { class: `thumb ${clip.thumb}`, "aria-hidden": "true" }),
    h("span", {}, h("span", { class: "bin-name" }, clip.name), h("span", { class: "bin-meta mono" }, clip.meta)),
  );
}

function renderBin(clips) {
  $("#bin-list").replaceChildren(...clips.map(binItem));
  $("#player-empty").hidden = clips.length > 0;
}

function addToBin(files) {
  $("#bin-list").append(...clipsFromFiles(files, (file) => `${(file.size / 1048576).toFixed(1)} MB`).map(binItem));
  $("#player-empty").hidden = true;
  toast(`${files.length} clip${files.length > 1 ? "s" : ""} added to the bin.`);
}

wireDropTarget($("#bin-drop"), addToBin);
$("#bin-input").addEventListener("change", (event) => addToBin(Array.from(event.target.files)));
