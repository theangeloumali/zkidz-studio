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


def token(text):
    return re.sub(r"[^\w']", "", text.lower())


def clipped_words(words, edl):
    """Words the EDL keeps only part of: the master plays half a word at the cut."""
    problems = []
    for word in words:
        kept = sum(end - at for at, end in map_interval(word["at"], word["end"], edl))
        removed = word["end"] - word["at"] - kept
        if kept > CLIP_TOLERANCE_S and removed > CLIP_TOLERANCE_S:
            problems.append(f"'{token(word['text'])}' at {word['at']:.2f} s is clipped by a cut ({kept:.2f} s of it kept)")
    return problems


def word_diff(expected, heard):
    """expected: (token, optional) in order; heard: tokens. A required word missing, or an extra copy of its neighbour, fails."""
    expected_tokens = [word for word, _ in expected]
    problems = []
    for tag, first, last, heard_first, heard_last in SequenceMatcher(a=expected_tokens, b=heard, autojunk=False).get_opcodes():
        if tag in ("delete", "replace"):
            alternatives = heard[heard_first:heard_last]
            for word, optional in expected[first:last]:
                if not optional and not any(SequenceMatcher(a=word, b=other).ratio() >= SIMILAR for other in alternatives):
                    problems.append(f"'{word}' is missing")
        if tag == "insert":
            neighbours = set(expected_tokens[max(first - 1, 0):first + 1])
            problems += [f"'{word}' is repeated" for word in heard[heard_first:heard_last] if word in neighbours]
    return problems


def expected_words(words, edl, window):
    """Fully kept words whose edited span lies in window (edited seconds), each flagged optional near the window edges."""
    start, end = window
    expected = []
    for word in words:
        spans = map_interval(word["at"], word["end"], edl)
        if len(spans) != 1 or spans[0][1] - spans[0][0] < word["end"] - word["at"] - CLIP_TOLERANCE_S:
            continue
        at, stop = spans[0]
        if at >= start and stop <= end and token(word["text"]):
            expected.append((token(word["text"]), at < start + EDGE_S or stop > end - EDGE_S))
    return expected


def cut_word_problems(words, edl, intro, transcribe_master):
    """transcribe_master(start_s, end_s) -> words heard in that stretch of the master."""
    problems = clipped_words(words, edl)
    for cut in timeline.cut_frames(edl):
        cut_s = cut / timeline.rate(edl)
        window = (max(0.0, cut_s - CUT_WINDOW_S), cut_s + CUT_WINDOW_S)
        shift = timeline.master_seconds(cut, edl, intro) - cut_s
        heard = [token(word["text"]) for word in transcribe_master(window[0] + shift, window[1] + shift)]
        problems += [f"cut at {cut_s:.2f} s: {problem}" for problem in word_diff(expected_words(words, edl, window), [word for word in heard if word])]
    return problems
