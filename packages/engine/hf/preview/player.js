// Created by The Angelo Umali.
// The preview page's runtime: compose.js's paused timeline, seeked by the Editor through postMessage. The page sits in a
// sandboxed iframe with no API access; it only listens for {type: "zks.preview.seek", time} from its parent.
/* global gsap, CustomEase, document, window */
(() => {
  // The CSP blocks parsed style attributes, but CSSOM writes are allowed, so each one is applied again here.
  for (const element of document.querySelectorAll("[style]")) element.style.cssText = element.getAttribute("style");

  const root = document.getElementById("root");
  const readJson = (id) => JSON.parse(document.getElementById(id).textContent);
  gsap.registerPlugin(CustomEase);
  for (const [easeId, easePath] of Object.entries(readJson("hf-eases"))) CustomEase.create(easeId, easePath);
  const timeline = gsap.timeline({ paused: true });
  for (const spec of readJson("hf-tweens")) {
    if (spec.set) timeline.set(spec.target, spec.set, spec.at);
    else if (spec.from) timeline.fromTo(spec.target, spec.from, spec.to, spec.at);
    else timeline.to(spec.target, spec.to, spec.at);
  }

  const clips = [...document.querySelectorAll(".clip")].map((element) => {
    const start = Number(element.dataset.start);
    return { element, start, end: start + Number(element.dataset.duration) };
  });
  const seek = (time) => {
    for (const clip of clips) clip.element.style.visibility = time >= clip.start && time < clip.end ? "visible" : "hidden";
    timeline.seek(time, false);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.type !== "zks.preview.seek") return;
    if (Number.isFinite(event.data.time)) seek(event.data.time);
  });
  seek(0);
  // The parent's origin is opaque to a sandboxed frame, so "*"; the message carries only the duration.
  window.parent.postMessage({ type: "zks.preview.loaded", durationS: Number(root.dataset.duration) }, "*");
})();
