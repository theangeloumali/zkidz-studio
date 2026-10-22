# Created by The Angelo Umali.
# Where only an inset file plays, its own sound replaces the camera's room recording of it, on the offset showcase.py uses
# for the picture, so picture and sound stay locked and a pause cut by exactly its length joins seamlessly. His talk-over
# keeps the room track. Run after showcase.py and before prepare.py; a rerun starts from the room track saved the first time.
# Usage (repo root, ZKS_WORK=work): python -m zks_engine.insert_audio vN
#   inserts/vN.json: an insert's "clean": [[start, end], ...] in raw seconds; a span may run past the insert's edges into a
#   removed range, so both sides of that cut are pure file.
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

from .pipeline import AUDIO_RATE, WORK, read_wav
from .render_final import BT709_TAGS

PRESENCE_DB = 2.0  # the file sits a little forward of the speaker level the room recorded
FADE = 0.06
HEADROOM = 0.97  # audio.py loudnorms the edit to -14 LUFS, so scaling the whole track keeps every balance


def clean_spans(inserts):
    """(start, end, src, file time - raw time) for every clean span; overlapping spans are refused, not silently overwritten."""
    spans = sorted((start, end, insert["src"], insert["src_at"] - insert["at"]) for insert in inserts for start, end in insert.get("clean", []))
    for earlier, later in zip(spans, spans[1:]):
        if later[0] < earlier[1]:
            sys.exit(f"clean spans {earlier[:2]} and {later[:2]} overlap")
    return spans


def file_slice(audio, start, end, offset, rate):
    """The file's samples for raw seconds start-end, silence wherever that falls outside the file."""
    first, last = round((start + offset) * rate), round((end + offset) * rate)
    piece = np.zeros((last - first, audio.shape[1]))
    low, high = max(first, 0), min(last, len(audio))
    if high > low:
        piece[low - first:high - first] = audio[low:high]
    return piece


def reference_span(spans, src):
    """The file's longest clean span: the most room to measure how loud the speaker played it."""
    return max((span for span in spans if span[2] == src), key=lambda span: span[1] - span[0])


def match_gain(room, clean):
    """The file's level matched to the room's recording of it, plus PRESENCE_DB."""
    level = np.sqrt(np.mean(clean ** 2))
    if level < 1e-6:
        sys.exit("the gain reference span is silent in the file: check that insert's src_at")
    return np.sqrt(np.mean(room ** 2)) / level * 10 ** (PRESENCE_DB / 20)


def blend(room, pieces, rate, fade=FADE):
    """Each (start, end, file samples) replaces the room between equal-power fades; the room's own copy is the far side."""
    mixed = room.copy()
    for start, end, clean in pieces:
        first = round(start * rate)
        low, high = max(first, 0), min(first + len(clean), len(room))  # a span past either end of the room is clipped to it
        if high <= low:
            continue
        clean = clean[low - first:high - first]
        ramp = min(int(fade * rate), (high - low) // 2)  # a short span gets shorter fades, never overlapping ones
        rise = np.sin(np.linspace(0, np.pi / 2, ramp))
        share = np.ones(high - low)
        share[:ramp], share[len(share) - ramp:] = rise, rise[::-1]
        mixed[low:high] = share[:, None] * clean + np.sqrt(1 - share ** 2)[:, None] * room[low:high]
    return mixed


def headroom(track):
    """(track, dB applied): scaled down whole when it peaks past HEADROOM."""
    peak = np.abs(track).max()
    return (track * HEADROOM / peak, 20 * np.log10(HEADROOM / peak)) if peak > HEADROOM else (track, 0.0)


def main(video):
    source = WORK / "sources" / f"{video}.mkv"
    spans = clean_spans(json.loads((WORK / "inserts" / f"{video}.json").read_text(encoding="utf-8")))
    if not spans:
        sys.exit(f"inserts/{video}.json has no \"clean\" spans")
    room_track = source.with_name(f"{video}.room.flac")
    if not room_track.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-vn", "-c:a", "flac", str(room_track)], check=True)
    room = read_wav(room_track)
    files = {src: read_wav(WORK.parent / src) for src in {span[2] for span in spans}}
    gains = {}
    for src in files:
        start, end, _, offset = reference_span(spans, src)
        gains[src] = match_gain(room[round(start * AUDIO_RATE):round(end * AUDIO_RATE)], file_slice(files[src], start, end, offset, AUDIO_RATE))
        print(f"{Path(src).name}: gain {20 * np.log10(gains[src]):+.1f} dB")
    pieces = [(start, end, file_slice(files[src], start, end, offset, AUDIO_RATE) * gains[src]) for start, end, src, offset in spans]
    mixed, scaled_db = headroom(blend(room, pieces, AUDIO_RATE))
    if scaled_db:
        print(f"whole track scaled {scaled_db:+.1f} dB for headroom")
    partial = source.with_name(f"{video}.partial.mkv")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-f", "s16le", "-ar", str(AUDIO_RATE), "-ac", "2", "-i", "-",
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "flac", *BT709_TAGS, str(partial)],
                   input=(mixed * 32767).astype(np.int16).tobytes(), check=True)
    shutil.move(partial, source)
    print(f"{len(spans)} clean spans written into {source}")


if __name__ == "__main__":
    main(sys.argv[1])
