// Created by The Angelo Umali.
// set_captions' checks, the TS twin of zks_engine captions.check_entries and specs.gates.check_captions: the engine CLI has
// no command for them, and set_captions must fail before the spec is written. Keep the metrics in step with captions.py.
import type { CaptionEntry, CaptionPhrase } from "@zks/shared";

const MAX_CAPTION_LINES = 2;
// Greedy wrap at the plate's 813 px text width with Inter 600 50 px advance widths (em), as captions.py measures.
const LINE_EM = 813 / 50;
const NARROW_CHARS: ReadonlySet<string> = new Set("ijlrtfI.,:;'!|() ");
const WIDE_CHARS: ReadonlySet<string> = new Set("mwMW");

function charEm(char: string): number {
  if (NARROW_CHARS.has(char)) return 0.3;
  if (WIDE_CHARS.has(char)) return 0.86;
  return char !== char.toLowerCase() ? 0.66 : 0.56;
}

const textEm = (text: string) => [...text].reduce((total, char) => total + charEm(char), 0);

function lineCount(text: string): number {
  let lines = 1;
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = `${line} ${word}`.trim();
    if (line !== "" && textEm(candidate) > LINE_EM) {
      lines += 1;
      line = word;
    } else {
      line = candidate;
    }
  }
  return lines;
}

const idList = (ids: readonly number[]) => `[${ids.join(",")}]`;

/** Phrase ids are positions in the phrase file. Each error names the group, so the agent can fix just that one. */
export function findCaptionErrors(entries: readonly CaptionEntry[], phrases: readonly CaptionPhrase[]): string[] {
  const errors = entries.flatMap((entry) => entryErrors(entry, phrases));
  const coveredIds = entries.flatMap((entry) => entry.ids);
  const missingIds = phrases.map((_phrase, phraseId) => phraseId).filter((phraseId) => !coveredIds.includes(phraseId));
  const doubledIds = [...new Set(coveredIds.filter((phraseId, index) => coveredIds.indexOf(phraseId) !== index))].sort((first, second) => first - second);
  if (missingIds.length > 0) errors.push(`phrases without a caption: ${idList(missingIds)}`);
  if (doubledIds.length > 0) errors.push(`phrases captioned twice: ${idList(doubledIds)}`);
  return errors;
}

function entryErrors(entry: CaptionEntry, phrases: readonly CaptionPhrase[]): string[] {
  const unknownIds = entry.ids.filter((phraseId) => phraseId >= phrases.length);
  if (unknownIds.length > 0) return [`caption ids ${idList(unknownIds)} are not phrases of this edit`];
  const errors: string[] = [];
  const [firstId = 0] = entry.ids;
  if (entry.ids.some((phraseId, index) => phraseId !== firstId + index)) errors.push(`caption ids ${idList(entry.ids)} are not consecutive`);
  if (new Set(entry.ids.map((phraseId) => phrases[phraseId]?.reel)).size > 1) errors.push(`caption ids ${idList(entry.ids)} cross a Reels keep edge`);
  const lines = lineCount(entry.en);
  if (lines > MAX_CAPTION_LINES) errors.push(`caption ids ${idList(entry.ids)} wrap to ${lines} lines: ${JSON.stringify(entry.en.trim())}; split it`);
  return errors;
}
