// Created by The Angelo Umali.
// Maps cues authored in SOURCE seconds onto an edit's frames, for the HyperFrames builder (hf/build.js) and as a browser
// global, so a cue lands on the same edited frame wherever it is drawn.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(this, () => {
  const CUE_SEED_BASE = 9001;
  const REEL_MIN_KEPT = 0.5;
  // Cutaways and censor gags are generated from the EDL, so a re-timed cut or bleep can never leave its graphic behind.
  const CENSOR_LEAD = 0.08;
  const CENSOR_HOLD = 0.25;
  // A caption this close to its neighbour swaps in place instead of rising or fading.
  const CAPTION_JOIN = 0.3;
  // A cue starting this soon after a cut starts on it: a few frames late, a cover flashes the footage under it.
  const CUT_SNAP = 0.2;
  // Word pins inside a cue (a row's `at`, `subAt`, `swapAt`, a marker's `moveAt`) are source seconds after cue.at.
  const isPinKey = (key) => key === "at" || /[a-z]At$/.test(key);
  // Not `item.constructor === Object`: cue files run in a vm context in Node, whose objects carry that context's Object.
  const isPlainObject = (item) => Object.prototype.toString.call(item) === "[object Object]";

  function createTimemap(edl, warnings) {
    const fps = edl.fps_num / edl.fps_den;
    const duration = edl.frames / fps;
    const segments = [...edl.segments].sort((first, second) => first.in - second.in);

    // A time inside a removed range lands on the next kept frame; >0.1 s of drift is reported.
    function toEdited(sourceSeconds, label) {
      const frame = sourceSeconds * fps;
      for (const segment of segments) {
        if (frame < segment.in) {
          if ((segment.in - frame) / fps > 0.1) warnings.push(`${label} @${sourceSeconds}s snapped to next kept frame`);
          return segment.target / fps;
        }
        if (frame < segment.out) return (segment.target + frame - segment.in) / fps;
      }
      return duration;
    }

    // Edited [start, stop] seconds of each kept piece of a source span (JS twin of pipeline.map_interval).
    function keptSpans(startSeconds, endSeconds) {
      const spans = [];
      for (const segment of segments) {
        const from = Math.max(startSeconds * fps, segment.in);
        const to = Math.min(endSeconds * fps, segment.out);
        if (to > from) spans.push([(segment.target + from - segment.in) / fps, (segment.target + to - segment.in) / fps]);
      }
      return spans;
    }

    // The edited second of the cut just before `start` when `start` is within CUT_SNAP of it, else `start`.
    function snapToCut(start) {
      const cut = segments.map((segment) => segment.target / fps).filter((edge) => edge <= start && start - edge < CUT_SNAP);
      return cut.length ? Math.max(...cut) : start;
    }

    // Reels keep a cue only if most of it survives, clamped to its kept frames; full edits keep every cue as authored.
    // A derived cue on wholly removed footage (a bleep inside a cut) is expected, so it drops without a warning.
    function editedWindow(cue, label) {
      // A caption is timed to its word, and its states run back to back: snapping one would lay it over the one before.
      const onCut = cue.kind === "caption" ? (start) => start : snapToCut;
      const spans = keptSpans(cue.at, cue.end);
      if (cue.isDerived && !spans.length) return null;
      if (cue.isDerived) return { start: toEdited(cue.at, label), stop: toEdited(cue.end, label) };
      if (!edl.reel) return { start: onCut(toEdited(cue.at, label)), stop: toEdited(cue.end, label) };
      const kept = spans.reduce((sum, [start, stop]) => sum + stop - start, 0);
      const share = spans.length ? kept / (cue.end - cue.at) : 0;
      if (share < REEL_MIN_KEPT) {
        warnings.push(`${label} @${cue.at}s dropped from the reel (${Math.round(share * 100)}% of its span kept)`);
        return null;
      }
      return { start: onCut(spans[0][0]), stop: spans.at(-1)[1] };
    }

    // Mapping pins onto the edit keeps each on its word across a trimmed pause or a clamped reel start.
    function pinsOnEdit(cue, start, label) {
      const toLocal = (key, value) => (isPinKey(key) && typeof value === "number" ? toEdited(cue.at + value, `${label} ${key}`) - start : value);
      const mapItem = (item) => (isPlainObject(item) ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, toLocal(key, value)])) : item);
      // A list one object down (bigWord's slot.words) holds pins too; the object's own keys stay as they are (grow.at).
      const mapLists = (value) => Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, Array.isArray(inner) ? inner.map(mapItem) : inner]));
      const mapValue = (key, value) => (Array.isArray(value) ? value.map(mapItem) : isPlainObject(value) ? mapLists(value) : toLocal(key, value));
      return Object.fromEntries(Object.entries(cue).map(([key, value]) => [key, key === "at" ? value : mapValue(key, value)]));
    }

    function derivedCues() {
      return [
        ...edl.cutaways.map((cutaway) => ({ kind: "cutaway", ...cutaway })),
        ...edl.bleeps.map(({ at, end, x, y }) => ({ kind: "censor", at: at - CENSOR_LEAD, end: end + CENSOR_HOLD, x, y })),
      ].map((cue) => ({ ...cue, isDerived: true }));
    }

    // A cutaway stays opaque over its whole span (`cover`), then leaves over the footage after it; each style sets the tail.
    function withCutawayTail(cue, edited, cutawayTail) {
      const cover = edited.stop - edited.start;
      if (cue.kind !== "cutaway" || cover <= 0) return edited;
      return { ...edited, cover, stop: Math.min(duration, edited.stop + cutawayTail(cue, cover)) };
    }

    // The cue sheet on the edit: derived cues first (only when the sheet names the video itself), then every authored cue
    // that survives, each with its edited [start, stop), its pins mapped, caption joins and a stable seed.
    function mapCues(cueSheet, { includeDerived = false, isKnownKind = () => true, cutawayTail = () => 0 } = {}) {
      const cues = [...(includeDerived ? derivedCues() : []), ...cueSheet]
        .map((cue) => {
          const label = `${cue.kind}${cue.text ? ` "${cue.text}"` : ""}`;
          if (!isKnownKind(cue.kind)) warnings.push(`${label}: unknown component`);
          const edited = editedWindow(cue, label);
          return edited && { ...(cue.isDerived ? cue : pinsOnEdit(cue, edited.start, label)), ...withCutawayTail(cue, edited, cutawayTail) };
        })
        .filter(Boolean)
        .map((cue, index) => ({ ...cue, seed: CUE_SEED_BASE + index }));
      const captions = cues.filter((cue) => cue.kind === "caption");
      const touches = (cue, edge) => captions.some((other) => other !== cue && Math.abs(edge(other, cue)) < CAPTION_JOIN);
      for (const cue of captions) {
        cue.joinsBefore ??= touches(cue, (other, self) => other.stop - self.start);
        cue.joinsAfter ??= touches(cue, (other, self) => other.start - self.stop);
      }
      return cues;
    }

    return { mapCues };
  }

  // Every visible cue's sounds on the edited timeline in sfx.py's schema; a sound after its cue has gone is dropped.
  function sfxEvents(cues, soundsOf) {
    return cues
      .filter((cue) => cue.stop > cue.start)
      .flatMap((cue) =>
        soundsOf(cue, cue.stop - cue.start)
          .map(({ at, sound, pan = 0, gain = 0, dur }) => ({ time: cue.start + at, sound, pan, gain, dur, kind: cue.kind, cueStart: cue.start }))
          .filter((event) => event.time <= cue.stop),
      )
      .sort((first, second) => first.time - second.time);
  }

  return { createTimemap, sfxEvents };
});
