// Created by The Angelo Umali.
// Per-kind item timing and the safe frame, shared by the canvas page (browser globals) and hf/ (require), so an unpinned
// item lands on the same beat and a card in the same band in either style. Loads before ui.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(this, () => {
  // Cards live between y 270 and the 880 column top; TikTok's action column starts at x 940 below it.
  const SAFE = { top: 270, bottom: 1248, left: 65, right: 1015, columnTop: 880, columnRight: 940 };
  const bandTop = (y, height) => Math.min(Math.max(y ?? 300, SAFE.top), Math.max(SAFE.top, SAFE.columnTop - height));

  const staggerAt = (index, step = 0.1, start = 0) => start + index * step;
  // An item's own word pin, else the kind's stagger.
  const itemAt = (item, index, step, start) => item.at ?? staggerAt(index, step, start);
  const tickPan = (index) => (index % 2 ? 0.25 : -0.25);

  const criteriaAt = (row, index) => itemAt(row, index, 1 / 3, 0.5);
  const timelineAt = (step, index) => itemAt(step, index, 1 / 3, 0.4);
  const timelineNodeAt = (step, index) => timelineAt(step, index) + (index ? 0.16 : 0);
  const pillAt = (item, index) => itemAt(item, index, 0.3, 0.45);
  const chipStartOf = (cue, index) => cue.items[index].at ?? staggerAt(index, cue.step ?? 0.1, cue.text ? 0.35 : 0.1);
  const flowItemAt = (cue, index) => 0.3 + index * (cue.step ?? 0.4);

  return { SAFE, bandTop, staggerAt, itemAt, tickPan, criteriaAt, timelineAt, timelineNodeAt, pillAt, chipStartOf, flowItemAt };
});
