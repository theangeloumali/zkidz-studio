# Created by The Angelo Umali.
# Word diff at every cut (herk gate 1): a word the EDL cuts through, and the re-transcribed master against the kept words.
import re
from difflib import SequenceMatcher

from ..pipeline import map_interval
from . import timeline

CLIP_TOLERANCE_S = 0.04  # a word edge this close to a cut is whisper timing noise, not a clipped word
CUT_WINDOW_S = 1.5  # each side of a cut
EDGE_S = 0.25  # a word this near the window edge may be cut off by the window itself
SIMILAR = 0.6  # difflib ratio: a mishearing ("cloude" for "claude"), not a lost word
# Long-form word times drift about a second on a 4.5 min clip (ep 12: 'kasi' at 168.37 there, 169.2 heard alone), so a
# flagged word is heard alone in the source this far either side before its flag stands.
ALONE_MARGIN_S = 1.5


def token(text):
    return re.sub(r"[^\w']", "", text.lower())


def kept_seconds(at, end, edl):
    return sum(stop - start for start, stop in map_interval(at, end, edl))


def is_clipped(at, end, edl, kept=None):
    kept = kept_seconds(at, end, edl) if kept is None else kept
    return kept > CLIP_TOLERANCE_S and end - at - kept > CLIP_TOLERANCE_S


def heard_alone(word, words, hear_source):
    """The word's (at, end) as an isolated hearing of the source around it places it, found by aligning that hearing with
    its long-form neighbours; None when the hearing does not hold it, or holds its token a different number of times (a
    merged repeat would lend the word the other copy's time), or when there is no hear_source to ask."""
    if hear_source is None:
        return None
    start, end = word["at"] - ALONE_MARGIN_S, word["end"] + ALONE_MARGIN_S
    context = [other for other in words if other["end"] > start and other["at"] < end and token(other["text"])]
    heard = [other for other in hear_source(start, end) if token(other["text"])]
    index = next((position for position, other in enumerate(context) if other is word), None)
    context_tokens, heard_tokens = [token(other["text"]) for other in context], [token(other["text"]) for other in heard]
    if index is None or context_tokens.count(context_tokens[index]) != heard_tokens.count(context_tokens[index]):
        return None
    matcher = SequenceMatcher(a=context_tokens, b=heard_tokens, autojunk=False)
    for first, heard_first, size in matcher.get_matching_blocks():
        if first <= index < first + size:
            match = heard[heard_first + index - first]
            return match["at"], match["end"]
    return None


def clipped_words(words, edl, hear_source=None):
    """Words the EDL keeps only part of: the master plays half a word at the cut. hear_source(start_s, end_s) -> words
    heard alone there, which a flagged word must still be clipped by."""
    problems = []
    for word in words:
        kept = kept_seconds(word["at"], word["end"], edl)
        if not is_clipped(word["at"], word["end"], edl, kept):
            continue
        alone = heard_alone(word, words, hear_source)
        if alone and not is_clipped(*alone, edl):
            continue
        problems.append(f"'{token(word['text'])}' at {word['at']:.2f} s is clipped by a cut ({kept:.2f} s of it kept)")
    return problems


def diff_problems(expected, heard):
    """(problem, index of the expected word it names, or None for a repeat), in order."""
    expected_tokens = [word for word, _ in expected]
    problems = []
    for tag, first, last, heard_first, heard_last in SequenceMatcher(a=expected_tokens, b=heard, autojunk=False).get_opcodes():
        if tag in ("delete", "replace"):
            alternatives = heard[heard_first:heard_last]
            for index, (word, optional) in enumerate(expected[first:last], first):
                if not optional and not any(SequenceMatcher(a=word, b=other).ratio() >= SIMILAR for other in alternatives):
                    problems.append((f"'{word}' is missing", index))
        if tag == "insert":
            neighbours = set(expected_tokens[max(first - 1, 0):first + 1])
            problems += [(f"'{word}' is repeated", None) for word in heard[heard_first:heard_last] if word in neighbours]
    return problems


def expected_words(words, edl, window):
    """Fully kept words whose edited span lies in window (edited seconds), as (word, optional near the window edges)."""
    start, end = window
    expected = []
    for word in words:
        spans = map_interval(word["at"], word["end"], edl)
        if len(spans) != 1 or spans[0][1] - spans[0][0] < word["end"] - word["at"] - CLIP_TOLERANCE_S:
            continue
        at, stop = spans[0]
        if at >= start and stop <= end and token(word["text"]):
            expected.append((word, at < start + EDGE_S or stop > end - EDGE_S))
    return expected


def master_ranges(window, edl, intro):
    """An edited-seconds window as master stretches: one across the intro's insert is heard either side of the intro."""
    rate = timeline.rate(edl)
    start, end = window
    shift = (intro["frames"] if intro else 0) / rate
    if intro and start * rate < intro["at"] < end * rate:
        return [(start, intro["at"] / rate), (intro["at"] / rate + shift, end + shift)]
    first = timeline.master_seconds(round(start * rate), edl, intro) - round(start * rate) / rate
    return [(start + first, end + first)]


def removed_alone(word, words, edl, hear_source):
    """A word missing from the master that, heard alone, lies mostly in removed footage: the cut spec removes it."""
    alone = heard_alone(word, words, hear_source)
    return bool(alone) and kept_seconds(*alone, edl) < (alone[1] - alone[0]) / 2


def remembered(hear_source):
    """One hearing per window: a word missing at two nearby cuts is flagged at both."""
    heard = {}

    def hear(start, end):
        if (start, end) not in heard:
            heard[start, end] = hear_source(start, end)
        return heard[start, end]

    return hear_source and hear


def cut_word_problems(words, edl, intro, transcribe_master, hear_source=None):
    """transcribe_master(start_s, end_s) -> words heard in that stretch of the master. hear_source(start_s, end_s) -> words
    heard alone in the source, the second opinion on each flagged word."""
    hear_source = remembered(hear_source)
    problems = clipped_words(words, edl, hear_source)
    for cut in timeline.cut_frames(edl):
        cut_s = cut / timeline.rate(edl)
        window = (max(0.0, cut_s - CUT_WINDOW_S), cut_s + CUT_WINDOW_S)
        heard = [token(word["text"]) for start, end in master_ranges(window, edl, intro) for word in transcribe_master(start, end)]
        expected = expected_words(words, edl, window)
        for problem, index in diff_problems([(token(word["text"]), optional) for word, optional in expected], [word for word in heard if word]):
            if index is None or not removed_alone(expected[index][0], words, edl, hear_source):
                problems.append(f"cut at {cut_s:.2f} s: {problem}")
    return problems
