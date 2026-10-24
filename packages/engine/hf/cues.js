// Created by The Angelo Umali.
// cues/<name>.json in order (plan §7.7): a cue array is appended to the sheet, a patch list ({op, match}) edits it.
// Cue files are data only; nothing in them is executed.
const fs = require("fs");
const path = require("path");

const CUE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAME_TIME = 1e-6;
const isPatch = (entry) => entry !== null && typeof entry === "object" && "op" in entry;

// As pipeline.spec_file: a job reads its start snapshot (ZKS_SPECS, plan §7.6), never the live work/cues the agent edits;
// the engine's derived sheets (<v>-cc, placeholders) back either one from work/derived.
function cueFilePath(work, name) {
  const primary = path.join(process.env.ZKS_SPECS || work, "cues", `${name}.json`);
  const derived = path.join(work, "derived", "cues", `${name}.json`);
  return !fs.existsSync(primary) && fs.existsSync(derived) ? derived : primary;
}

function readCueFile(work, name) {
  if (!CUE_NAME.test(name)) throw new Error(`${JSON.stringify(name)} is not a cue file name (letters, digits, - and _)`);
  const label = `cues/${name}.json`;
  const file = cueFilePath(work, name);
  if (!fs.existsSync(file)) throw new Error(`${label} is missing`);
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error(`${label} must hold an array of cues or of patches`);
  const patches = entries.filter(isPatch).length;
  if (patches && patches !== entries.length) throw new Error(`${label} mixes cues and patches; a reel override holds only patches`);
  return { label, entries, isPatchList: patches > 0 };
}

function applyPatch(sheet, patch, label) {
  const { kind, at } = patch.match ?? {};
  const index = sheet.findIndex((cue) => cue.kind === kind && Math.abs(cue.at - at) < SAME_TIME);
  if (index < 0) throw new Error(`${label}: no ${kind} at ${at} to ${patch.op}`);
  if (patch.op === "remove") sheet.splice(index, 1);
  else if (patch.op === "replace") sheet.splice(index, 1, patch.cue);
  else throw new Error(`${label}: op is remove or replace, not ${patch.op}`);
}

function loadCueSheet(work, cueNames) {
  const sheet = [];
  for (const name of cueNames) {
    const { label, entries, isPatchList } = readCueFile(work, name);
    if (isPatchList) entries.forEach((patch) => applyPatch(sheet, patch, label));
    else sheet.push(...entries);
  }
  return sheet;
}

module.exports = { loadCueSheet };
