# Created by The Angelo Umali.
# Word-level transcription through whisper.cpp, split at quiet points and run in parallel.
# Usage (from the work dir): python -m zks_engine.transcribe audio/v3.wav transcripts/v3_words.json [chunks] [language] [model]
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from ..pipeline import ENERGY_WINDOW, MAX_JOBS, WORK, load_energy
from ..slots import slot
from . import whispercpp

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


def transcribe_chunk(wav, start, end, index, language, model, threads):
    chunk = WORK / "transcripts" / f"_{Path(wav).stem}_chunk{index}.wav"
    try:
        whispercpp.write_window(WORK / wav, start, end, chunk)
        words = whispercpp.transcribe_file(chunk, language, model, threads)
    finally:
        chunk.unlink(missing_ok=True)
    offset = round(start * 1000)
    return [{**word, "start": word["start"] + offset, "end": word["end"] + offset} for word in words]


def main(wav, destination, chunks=6, language="tl", model=None):
    (WORK / "transcripts").mkdir(exist_ok=True)
    model_file = whispercpp.model_path(model)
    points = split_points(load_energy(WORK / wav), chunks)
    count = len(points) - 1
    jobs = min(count, MAX_JOBS)
    threads = max(1, (os.cpu_count() or 4) // jobs)  # parallel chunks share the cores instead of oversubscribing them
    with slot("whisper", f"transcribe {wav} ({WORK})"), ThreadPoolExecutor(jobs) as pool:
        parts = pool.map(lambda index: transcribe_chunk(wav, points[index], points[index + 1], index, language, model_file, threads), range(count))
    words = [word for part in parts for word in part]
    (WORK / destination).write_text("".join(json.dumps(word) + "\n" for word in words), encoding="utf-8")
    print(f"{len(words)} words from {count} chunks split at {[round(p, 1) for p in points]}")
