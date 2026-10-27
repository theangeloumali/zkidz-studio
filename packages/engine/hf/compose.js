// Created by The Angelo Umali.
// Mapped cues → one standalone HyperFrames composition (no IO). Every clip covers exactly the frames the canvas page would
// draw; every tween is data the page's runtime replays into one paused GSAP timeline.
const { exit } = require("./fx/motion");
const { fontWarmHtml } = require("./brand/fonts");
const { easeDefinitions } = require("./fx/springs");
const { SAFE } = require("./overlay/cue-rules");

const CLIP_LEAD_FRAMES = 0.25; // clips open a quarter frame early, so float error can never drop their first frame
const FRAME_EPSILON = 1e-6;
const seconds = (value) => value.toFixed(9);

// The canvas draws frame n while n / fps >= cue.start, so a cue's first frame is the ceiling of its start.
const frameAtOrAfter = (time, fps) => Math.ceil(time * fps - FRAME_EPSILON);

const RUNTIME = `(() => {
  gsap.registerPlugin(CustomEase);
  for (const [id, path] of Object.entries(JSON.parse(document.getElementById("hf-eases").textContent))) CustomEase.create(id, path);
  const tl = gsap.timeline({ paused: true });
  for (const spec of JSON.parse(document.getElementById("hf-tweens").textContent)) {
    if (spec.set) tl.set(spec.target, spec.set, spec.at);
    else if (spec.from) tl.fromTo(spec.target, spec.from, spec.to, spec.at);
    else tl.to(spec.target, spec.to, spec.at);
  }
  window.__timelines[COMPOSITION_ID] = tl;
})();`;

// Safe zones for review stills: the card band, the caption band (bottom 1430) and the platform's right-hand UI column.
const guideBox = (left, top, right, bottom) => `<div style="left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px"></div>`;
const GUIDES = `<div class="guides">${guideBox(SAFE.left, SAFE.top, SAFE.right, SAFE.columnTop)}${guideBox(70, 1270, 1010, 1430)}${guideBox(SAFE.columnRight, SAFE.columnTop, 1080, 1780)}</div>`;

function composeDocument({ edl, cues, registry, compositionId, css, guides = false, settled = false, size = [1080, 1920] }) {
  const fps = edl.fps_num / edl.fps_den;
  const snap = (time) => Math.round(time * fps) / fps;
  const clips = [];
  const tweens = [];
  const placed = [];

  cues.forEach((cue, index) => {
    const firstFrame = frameAtOrAfter(cue.start, fps);
    const endFrame = frameAtOrAfter(cue.stop, fps);
    if (endFrame <= firstFrame) return;
    const id = `c${index}`;
    const component = registry[cue.kind];
    const context = { id, duration: cue.stop - cue.start, cues, fps, settled };
    const start = Math.max(0, (firstFrame - CLIP_LEAD_FRAMES) / fps);
    const { html, motion, exit: exits = exit(".cue-out", context.duration) } = component.render(cue, context);
    clips.push(
      `<div id="${id}" class="clip" data-start="${seconds(start)}" data-duration="${seconds((endFrame - firstFrame) / fps)}" data-track-index="${component.track ?? 2}">` +
        `<div class="cue-out">${html}</div></div>`,
    );
    for (const spec of [...motion, ...exits]) {
      // Each selector of a list is scoped, or ".a, .b" would reach .b in every cue.
      const target = spec.target
        .split(",")
        .map((selector) => `#${id} ${selector.trim()}`)
        .join(", ");
      tweens.push({ ...spec, at: snap(cue.start + spec.at), target });
    }
    const landed = component.landed ? { landed: cue.start + component.landed(cue) } : {};
    placed.push({ id, kind: cue.kind, text: cue.text ?? cue.title ?? null, start: cue.start, stop: cue.stop, firstFrame, endFrame, seed: cue.seed, ...landed });
  });

  // Cue text is agent output: a raw `</script` ends the script and `<!--` puts the parser in its escaped state, so every `<` goes.
  const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  const eases = easeDefinitions(tweens.map((spec) => spec.to?.ease).filter(Boolean));
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${compositionId}</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="${compositionId}" data-start="0" data-duration="${seconds(edl.frames / fps)}" data-width="${size[0]}" data-height="${size[1]}">
      ${fontWarmHtml()}
      ${guides ? GUIDES : ""}
      ${clips.join("\n      ")}
      <script src="vendor/gsap.min.js"></script>
      <script src="vendor/CustomEase.min.js"></script>
      <script type="application/json" id="hf-eases">${json(eases)}</script>
      <script type="application/json" id="hf-tweens">${json(tweens)}</script>
      <script>
        const COMPOSITION_ID = ${JSON.stringify(compositionId)};
        ${RUNTIME}
      </script>
    </div>
  </body>
</html>
`;
  return { html, placed };
}

module.exports = { composeDocument };
