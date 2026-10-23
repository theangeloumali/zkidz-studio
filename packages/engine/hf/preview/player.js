// Created by The Angelo Umali.
// The preview page's runtime: compose.js's tweens as paused per-clip timelines, seeked by the Editor through postMessage. The page sits in a
// sandboxed iframe with no API access; it only listens for {type: "zks.preview.seek", time} from its parent.
/* global gsap, CustomEase, document, window */
(() => {
  // The CSP blocks parsed style attributes but allows CSSOM writes, so index.js ships them as data-style.
  for (const element of document.querySelectorAll("[data-style]")) element.style.cssText = element.dataset.style;

  const root = document.getElementById("root");
  // Cues are laid out on the 1080x1920 canvas; the frame is player-sized, so the canvas scales to its width.
  const canvasWidth = Number(root.dataset.width);
  root.style.width = `${canvasWidth}px`;
  root.style.height = `${root.dataset.height}px`;
  root.style.transformOrigin = "0 0";
  const fitToFrame = () => (root.style.transform = `scale(${window.innerWidth / canvasWidth})`);
  fitToFrame();
  window.addEventListener("resize", fitToFrame);
  const readJson = (id) => JSON.parse(document.getElementById(id).textContent);
  gsap.registerPlugin(CustomEase);
  for (const [easeId, easePath] of Object.entries(readJson("hf-eases"))) CustomEase.create(easeId, easePath);
  // Tweens group by clip (compose.js scopes every target "#cN ..."). Each clip's paused timeline is built the first time
  // the clip is live: GSAP reads computed style per tween, and building all 10,000 at load forced seconds of layout.
  const specsByClip = new Map();
  for (const spec of readJson("hf-tweens")) {
    const clipId = /^#(c\d+) /.exec(spec.target)[1];
    if (!specsByClip.has(clipId)) specsByClip.set(clipId, []);
    specsByClip.get(clipId).push(spec);
  }
  const buildTimeline = (specs) => {
    const timeline = gsap.timeline({ paused: true });
    for (const spec of specs) {
      if (spec.set) timeline.set(spec.target, spec.set, spec.at);
      else if (spec.from) timeline.fromTo(spec.target, spec.from, spec.to, spec.at);
      else timeline.to(spec.target, spec.to, spec.at);
    }
    return timeline;
  };

  const clips = [...document.querySelectorAll(".clip")].map((element) => {
    const start = Number(element.dataset.start);
    return { element, start, end: start + Number(element.dataset.duration), specs: specsByClip.get(element.id) ?? [], timeline: null };
  });
  const seek = (time) => {
    for (const clip of clips) {
      const isVisible = time >= clip.start && time < clip.end;
      // Toggle only on change: the Editor seeks every frame, and 2,000 writes per seek spent its frame budget.
      if (clip.isVisible !== isVisible) {
        clip.isVisible = isVisible;
        clip.element.classList.toggle("live", isVisible);
      }
      if (!isVisible) continue;
      clip.timeline ??= buildTimeline(clip.specs);
      clip.timeline.seek(time, false);
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.type !== "zks.preview.seek") return;
    if (Number.isFinite(event.data.time)) seek(event.data.time);
  });
  seek(0);
  // The parent's origin is opaque to a sandboxed frame, so "*"; the message carries only the duration.
  window.parent.postMessage({ type: "zks.preview.loaded", durationS: Number(root.dataset.duration) }, "*");
})();
