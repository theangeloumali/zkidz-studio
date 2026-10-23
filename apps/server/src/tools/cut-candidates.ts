// Created by The Angelo Umali.
// First-pass cut candidates from transcript words alone; retakes and false starts need the editorial pass (Phase 4).
import type { CutCandidate } from "@zks/shared";
import type { TranscriptWord } from "./transcript-store.ts";

// "ano" is the Tagalog filler; Taglish footage is a first-class input.
const FILLER_WORDS: ReadonlySet<string> = new Set(["um", "uh", "uhm", "erm", "hmm", "ah", "ano"]);
const MIN_PAUSE_S = 0.8;
/** Breath kept on each side of a trimmed pause, so the join does not clip a word. */
const PAUSE_KEEP_S = 0.15;
const CONTEXT_WORDS = 3;

export interface CandidateOptions {
  readonly removeFillers: boolean;
  readonly trimPauses: boolean;
  readonly idPrefix: string;
}

type CandidateDraft = Omit<CutCandidate, "id" | "context"> & { readonly wordIndex: number };

export function findCutCandidates(words: readonly TranscriptWord[], options: CandidateOptions): CutCandidate[] {
  const drafts = words.flatMap((word, wordIndex) => draftsAt(words, wordIndex, options));
  return drafts
    .sort((first, second) => first.at - second.at)
    .map(({ wordIndex, ...draft }, candidateIndex) => ({
      ...draft,
      id: `${options.idPrefix}-${candidateIndex + 1}`,
      context: contextAround(words, wordIndex),
    }));
}

function draftsAt(words: readonly TranscriptWord[], wordIndex: number, options: CandidateOptions): CandidateDraft[] {
  const word = words[wordIndex];
  const nextWord = words[wordIndex + 1];
  if (word === undefined) return [];
  const drafts: CandidateDraft[] = [];
  const spokenWord = normalizeWord(word.text);
  const isFiller = FILLER_WORDS.has(spokenWord);
  if (options.removeFillers && isFiller) drafts.push({ at: word.at, end: word.end, kind: "filler", reason: `filler "${word.text}"`, wordIndex });
  if (nextWord === undefined) return drafts;
  if (!isFiller && spokenWord !== "" && spokenWord === normalizeWord(nextWord.text)) {
    drafts.push({ at: word.at, end: nextWord.at, kind: "stutter", reason: `"${word.text}" said twice`, wordIndex });
  }
  const gapS = nextWord.at - word.end;
  if (options.trimPauses && gapS > MIN_PAUSE_S) {
    const reason = `${gapS.toFixed(1)} s pause`;
    drafts.push({ at: word.end + PAUSE_KEEP_S, end: nextWord.at - PAUSE_KEEP_S, kind: "pause", reason, wordIndex });
  }
  return drafts;
}

function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

function contextAround(words: readonly TranscriptWord[], wordIndex: number): string {
  return words
    .slice(Math.max(0, wordIndex - CONTEXT_WORDS), wordIndex + CONTEXT_WORDS + 1)
    .map((word) => word.text)
    .join(" ");
}
