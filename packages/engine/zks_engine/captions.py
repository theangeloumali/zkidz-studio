# Created by The Angelo Umali.
# English caption track: kept speech split into short phrases timed to the audio, then the translations as cues.
# Usage (from the work dir): python -m zks_engine.captions v6 --phrases [--reel reels/v6.json]  → captions/v6.phrases.json
#                            python -m zks_engine.captions v6                                  → derived/cues/v6-cc.json from captions/v6.json
# captions/vN.json = [{"ids": [3, 4], "en": "..."}]; timing always comes from the phrase file, never the translation.
import json
import sys

import numpy as np

from . import edl
from .pipeline import ENERGY_WINDOW, FPS, WORK, derived_file, load_cuts, load_energy, spec_file
from .specs import gates

PAUSE_BREAK = 0.35
MAX_WORDS, MAX_SECONDS = 7, 2.8
ONSET_SEARCH = 0.6  # whisper word starts drift p90 0.47 s, max 0.56 s from the energy onset (measured on v6/v7)
SPEECH_DB = -34  # the cut specs' trim_pauses threshold
ONSET_QUIET = int(0.15 / ENERGY_WINDOW)  # an onset follows at least this many quiet windows
BRIDGE_GAP = 0.5  # a shorter edited gap keeps the caption up until the next one starts, so talk never flickers
HOLD = 0.25
MIN_ON_SCREEN = 0.7
SENTENCE_END = (".", "?", "!")
# Greedy wrap at the plate's 813 px text width with Inter 600 50 px advance widths (em); the component re-measures.
LINE_EM = 813 / 50
NARROW, WIDE = set("ijlrtfI.,:;'!|() "), set("mwMW")


def text_em(text):
    return sum(0.3 if char in NARROW else 0.86 if char in WIDE else 0.66 if char.isupper() else 0.56 for char in text)


def line_count(text):
    lines, line = 1, ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if line and text_em(candidate) > LINE_EM:
            lines, line = lines + 1, word
        else:
            line = candidate
    return lines


def segment_of(seconds, segments):
    frame = seconds * FPS
    return next((index for index, seg in enumerate(segments) if seg["in"] <= frame < seg["out"]), None)


def to_edited(seconds, segments):
    """Source seconds on the edit; a removed time lands on the next kept frame (overlay/timemap.js toEdited)."""
    frame = seconds * FPS
    for seg in segments:
        if frame < seg["in"]:
            return seg["target"] / FPS
        if frame < seg["out"]:
            return (seg["target"] + frame - seg["in"]) / FPS
    return (segments[-1]["target"] + segments[-1]["out"] - segments[-1]["in"]) / FPS


def reel_keeps(path):
    """(at, end) per keep: the studio's {"at", "end", "pin"?} objects or the films' [low, high, ...] lists."""
    keeps = json.loads(spec_file(WORK, path).read_text(encoding="utf-8"))["keep"] if path else []
    return [(keep["at"], keep["end"]) if isinstance(keep, dict) else tuple(keep[:2]) for keep in keeps]


def transcript_path(video):
    """The studio transcript (a JSON array in seconds), else the films pipeline's JSONL in ms."""
    studio = WORK / "transcripts" / f"{video}.words.json"
    return studio if studio.exists() else WORK / "transcripts" / f"{video}_words.json"


def transcript_words(video):
    """(start, end, text) per word, in source seconds, from either transcript shape."""
    path = transcript_path(video)
    content = path.read_text(encoding="utf-8")
    if path.name == f"{video}.words.json":
        return [(word["at"], word["end"], word["text"]) for word in json.loads(content)]
    lines = [json.loads(line) for line in content.splitlines() if line.strip()]
    return [(word["start"] / 1000, word["end"] / 1000, word["text"]) for word in lines]


def kept_words(video, segments, keeps):
    words = []
    for start, end, raw_text in transcript_words(video):
        text = raw_text.strip()
        if not text:
            continue
        seg = segment_of((start + end) / 2, segments)
        if seg is not None:
            reel = next((index for index, (low, high) in enumerate(keeps) if low <= (start + end) / 2 < high), None)
            words.append({"start": start, "end": end, "text": text, "seg": seg, "reel": reel})
    return words


def group(words):
    phrases, current = [], []
    for word in words:
        if current:
            previous = current[-1]
            if (word["seg"] != previous["seg"] or word["reel"] != previous["reel"] or word["start"] - previous["end"] >= PAUSE_BREAK
                    or len(current) >= MAX_WORDS or word["end"] - current[0]["start"] > MAX_SECONDS or previous["text"].endswith(SENTENCE_END)):
                phrases.append(current)
                current = []
        current.append(word)
    return phrases + [current] if current else phrases


def onsets(energy_db):
    loud = energy_db > SPEECH_DB
    quiet_run = np.convolve((~loud).astype(int), np.ones(ONSET_QUIET, dtype=int), "full")[: len(loud)]
    return np.flatnonzero(loud[ONSET_QUIET:] & (quiet_run[ONSET_QUIET - 1:-1] == ONSET_QUIET)) + ONSET_QUIET


def snap_start(words, previous, previous_start, onset_times):
    """The nearest speech onset to whisper's start, never before the previous phrase's last word or past this one's."""
    start = words[0]["start"]
    low = max(start - ONSET_SEARCH, previous[-1]["start"] + 0.05 if previous else 0.0, previous_start + 0.2)
    high = min(start + ONSET_SEARCH, words[1]["start"] if len(words) > 1 else words[0]["end"])
    nearby = onset_times[(onset_times >= low) & (onset_times <= high)]
    return float(nearby[np.argmin(abs(nearby - start))]) if len(nearby) else start


def build_phrases(video, reel_path):
    # Segments from the current cut spec, as the edit stage builds them: edl/ is the last render's, missing before one.
    spec = load_cuts(video)
    energy_db = load_energy(WORK / "audio" / f"{spec.get('base', video)}.wav")
    segments, _frames = edl.build(spec, energy_db)
    words = kept_words(video, segments, reel_keeps(reel_path))
    onset_times = onsets(energy_db) * ENERGY_WINDOW
    groups = group(words)
    starts = []
    for index, words_in in enumerate(groups):
        snapped = snap_start(words_in, groups[index - 1] if index else None, starts[-1] if starts else -1.0, onset_times)
        # A word straddling a cut belongs to the segment after it: its caption waits for that segment's first frame.
        starts.append(max(snapped, segments[words_in[0]["seg"]]["in"] / FPS))
    phrases = []
    for index, words_in in enumerate(groups):
        seg = segments[words_in[0]["seg"]]
        own_end = words_in[-1]["end"] + HOLD
        end = min(own_end, seg["out"] / FPS)
        if index + 1 < len(groups):
            following = groups[index + 1]
            gap = to_edited(starts[index + 1], segments) - to_edited(words_in[-1]["end"], segments)
            if following[0]["reel"] == words_in[0]["reel"] and gap < BRIDGE_GAP:
                # Bridged: up until the next caption (the segment's out when that one opens the next kept segment).
                end = starts[index + 1] if following[0]["seg"] == words_in[0]["seg"] else seg["out"] / FPS
            elif following[0]["seg"] == words_in[0]["seg"]:
                end = min(end, starts[index + 1])
        end = max(end, min(starts[index] + MIN_ON_SCREEN, seg["out"] / FPS))
        if index + 1 < len(groups) and groups[index + 1][0]["seg"] == words_in[0]["seg"]:
            end = min(end, starts[index + 1])  # two plates never share the band
        phrases.append({"id": index, "at": round(starts[index], 3), "end": round(end, 3), "reel": words_in[0]["reel"],
                        "text": " ".join(word["text"] for word in words_in)})
    out = WORK / "captions" / f"{video}.phrases.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(phrases, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{video}: {len(phrases)} phrases from {len(words)} kept words -> {out}")
    return phrases


def check_entries(entries, phrases):
    problems, covered = [], []
    for entry in entries:
        ids = entry["ids"]
        if ids != list(range(ids[0], ids[0] + len(ids))):
            problems.append(f"ids {ids} are not consecutive")
        if not entry.get("en", "").strip():
            problems.append(f"ids {ids} have no English")
        covered += ids
    missing = sorted(set(range(len(phrases))) - set(covered))
    doubled = sorted({i for i in covered if covered.count(i) > 1})
    if missing:
        problems.append(f"phrases without a caption: {missing}")
    if doubled:
        problems.append(f"phrases captioned twice: {doubled}")
    return problems


def emit_cues(video):
    phrases = json.loads((WORK / "captions" / f"{video}.phrases.json").read_text(encoding="utf-8"))
    entries = json.loads(spec_file(WORK, f"captions/{video}.json").read_text(encoding="utf-8"))
    try:
        gates.check_captions(entries, phrases)
    except gates.GateFailed as failure:
        sys.exit(f"{video} captions: {failure}")
    if problems := check_entries(entries, phrases):
        sys.exit(f"{video} captions:\n  " + "\n  ".join(problems))
    cues = [{"kind": "caption", "at": phrases[entry["ids"][0]]["at"], "end": phrases[entry["ids"][-1]]["end"], "text": entry["en"].strip(),
             **({"bottom": entry["bottom"]} if "bottom" in entry else {})}
            for entry in sorted(entries, key=lambda entry: entry["ids"][0])]
    target = derived_file(WORK, f"cues/{video}-cc.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(cues, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{video}: {len(cues)} captions -> {target}")


if __name__ == "__main__":
    name, flags = sys.argv[1], sys.argv[2:]
    if "--phrases" in flags:
        build_phrases(name, flags[flags.index("--reel") + 1] if "--reel" in flags else None)
    else:
        emit_cues(name)
