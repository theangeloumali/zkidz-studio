# Created by The Angelo Umali.
# Word-level whisper transcription, split at quiet points and run in parallel.
# ffmpeg's whisper filter uses only a few threads, so one long file runs ~0.1x realtime on CPU.
# Usage (from the work dir): python -m zks_engine.transcribe audio/v3.wav transcripts/v3_words.json [chunks] [language]
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from . import progress
from .pipeline import ENERGY_WINDOW, MAX_JOBS, WORK, load_energy, whisper_filter
from .slots import slot

SEARCH = 5.0  # seconds either side of an even split searched for the quietest point
MIN_CHUNK = 20.0  # shorter chunks cost more in model start-up than they save


def split_points(energy_db, chunks):
    """Chunk boundaries at the quietest point near each even split; always strictly increasing."""
    duration = len(energy_db) * ENERGY_WINDOW
    chunks = max(1, min(chunks, int(duration // MIN_CHUNK)))
    points = [0.0]
    for index in range(1, chunks):
        target = duration * index / chunks
        # Never search before the previous boundary, so a short clip cannot produce -to <= -ss.
        low = max(int((target - SEARCH) / ENERGY_WINDOW), int(points[-1] / ENERGY_WINDOW) + 1)
        high = min(len(energy_db), int((target + SEARCH) / ENERGY_WINDOW))
        points.append((low + int(np.argmin(energy_db[low:high]))) * ENERGY_WINDOW if high > low else target)
    return points + [duration]


WORD_LINE = re.compile(r'^\{"start":\s*(\d+),\s*"end":\s*(\d+),\s*"text":\s*"(.*)"\s*\}$')


def parse_word(line):
    """The whisper filter writes quotes inside "text" unescaped, which json.loads rejects."""
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        start, end, text = WORD_LINE.match(line.strip()).groups()
        return {"start": int(start), "end": int(end), "text": text}


def transcribe_chunk(wav, start, end, index, language):
    out = WORK / "transcripts" / f"_{Path(wav).stem}_chunk{index}.json"
    try:
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", wav,
                        "-af", whisper_filter(out, "json", language=language), "-f", "null", "-"], cwd=WORK, check=True)
        words = [parse_word(line) for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    finally:
        out.unlink(missing_ok=True)
    offset = round(start * 1000)
    return [{**word, "start": word["start"] + offset, "end": word["end"] + offset} for word in words]


def main(wav, destination, chunks=6, language="tl"):
    (WORK / "transcripts").mkdir(exist_ok=True)
    points = split_points(load_energy(WORK / wav), chunks)
    count = len(points) - 1
    with slot("whisper", f"transcribe {wav} ({WORK})"), ThreadPoolExecutor(min(count, MAX_JOBS)) as pool:
        parts = pool.map(transcribe_chunk, [wav] * count, points[:-1], points[1:], range(count), [language] * count)
    words = [word for part in parts for word in part]
    (WORK / destination).write_text("".join(json.dumps(word) + "\n" for word in words), encoding="utf-8")
    print(f"{len(words)} words from {count} chunks split at {[round(p, 1) for p in points]}")


if __name__ == "__main__":
    with progress.job(Path(sys.argv[1]).stem, "transcribe"):
        main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6, sys.argv[4] if len(sys.argv) > 4 else "tl")
