// Created by The Angelo Umali.
// Every brand kind by name: the supported list. Each takes its canvas kind's fields (docs/cues-brand.md; the four with no
// canvas twin, chatCard, headlineStack, lineChart, phoneFrame and the matte kinds in depth.js, are in docs/cues-hf.md) and provides
// render(cue, ctx) → { html, motion, exit? }, plus optional sfx(cue, duration) (default: the canvas SFX_OF) and track.
const { hookTitle, lowerThird, chapterCard, endCard } = require("./titles");
const { keyword, comment, handNote, slamStamp, titleSwap } = require("./text");
const { statTile, timeline, flowRow } = require("./data");
const { criteriaCard, pills, chips, checklist } = require("./lists");
const { vsCard, splitFlow, pipeline } = require("./diagrams");
const { caption } = require("./captions");
const { censor, cutaway, phoneFrame } = require("./fx");
const { chatCard } = require("./chat");
const { headlineStack, lineChart } = require("./charts");
const { backdrop, paperCutout, frameEscape } = require("./depth");

// One object, looked up by kind name (REGISTRY[cue.kind]); the build fails on a kind missing here.
const REGISTRY = {
  hookTitle,
  lowerThird,
  chapterCard,
  endCard,
  keyword,
  comment,
  handNote,
  slamStamp,
  titleSwap,
  statTile,
  timeline,
  flowRow,
  criteriaCard,
  checklist,
  pills,
  chips,
  vsCard,
  splitFlow,
  pipeline,
  caption,
  censor,
  cutaway,
  chatCard,
  headlineStack,
  lineChart,
  phoneFrame,
  backdrop,
  paperCutout,
  frameEscape,
};

module.exports = { REGISTRY };
