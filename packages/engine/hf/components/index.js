// Created by The Angelo Umali.
// Every brand kind by name: the supported list. Each takes its canvas kind's fields (docs/cues-brand.md; the four with no
// canvas twin, chatCard, headlineStack, lineChart, phoneFrame and the matte kinds in depth.js, are in docs/cues-hf.md; the learning kinds are in learning/) and provides
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
const { paperScene } = require("./learning/paper");
const { bigWord } = require("./learning/words");
const { chipRail } = require("./learning/chips");
const { typedPrompt, askField } = require("./learning/ui");
const { commentCta } = require("./learning/cta");
const { receipt } = require("./learning/receipt");
const { footageCard, gradeWipe } = require("./learning/footage");
const { routeMap } = require("./learning/route-map");
const { stepBars } = require("./learning/bars");
const { listRows } = require("./learning/rows");
const { meterGauge } = require("./learning/gauge");
const { receiptPrint } = require("./learning/receipt-print");
const { phoneScreen } = require("./learning/phone");
const { chatThread } = require("./learning/chat-thread");
const { tradeScreen } = require("./learning/trade");
const { flowSteps } = require("./learning/flow");

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
  paperScene,
  bigWord,
  chipRail,
  typedPrompt,
  askField,
  commentCta,
  receipt,
  footageCard,
  gradeWipe,
  routeMap,
  stepBars,
  listRows,
  meterGauge,
  receiptPrint,
  phoneScreen,
  chatThread,
  tradeScreen,
  flowSteps,
};

module.exports = { REGISTRY };
