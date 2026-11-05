// Created by The Angelo Umali.
// "Is this moment on paper": the opaque full-frame kinds and their opaque span. A cue starting on one draws ink, not white.
const COVER_KINDS = ["cutaway", "paperScene"];

// A cutaway's `cover` (timemap.js sets it; its wipe-out tail follows), else the cover's whole span.
const coverSpan = (cover) => cover.cover ?? cover.stop - cover.start;

const onCover = (cue, cues) => cues.some((other) => COVER_KINDS.includes(other.kind) && other.start <= cue.start && cue.start < other.start + coverSpan(other));

module.exports = { COVER_KINDS, coverSpan, onCover };
