# Created by The Angelo Umali.
# Transcribes short audio windows in isolation (silence-padded, no context) to confirm what each one holds.
# Usage (from the work dir): python -m zks_engine.check_windows [--lang tl] audio/v3.wav 31.78-32.12 31.40-31.80 ...
import os
import sys
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from .pipeline import MAX_JOBS, WORK
from .transcribe import whispercpp

LEAD, TAIL = 0.5, 1.0  # silence padding: the window is judged on its own sound, not context


def transcribe(wav, start, end, language, model=None, threads=None):
    """The window's words, timed in source milliseconds."""
    (WORK / "transcripts").mkdir(exist_ok=True)
    # Its own file: the same span heard twice at once (QC beside check_window) must not truncate the other's.
    handle, name = tempfile.mkstemp(prefix=f"_w{start}_{end}_", suffix=".wav", dir=WORK / "transcripts")
    os.close(handle)
    window = Path(name)
    try:
        whispercpp.write_window(WORK / wav, start, end, window, lead=LEAD, tail=TAIL)
        words = whispercpp.transcribe_file(window, language, whispercpp.model_path(model), threads)
    finally:
        window.unlink(missing_ok=True)
    shift = round((start - LEAD) * 1000)
    return [{**word, "start": word["start"] + shift, "end": word["end"] + shift} for word in words]


def transcribe_all(wav, spans, language, model=None):
    """Each span's words, in span order, the windows heard side by side sharing the cores (one thread each took 46.6 s
    on a 3 s turbo window)."""
    workers = max(1, min(MAX_JOBS, len(spans)))
    threads = whispercpp.threads_for(workers)
    with ThreadPoolExecutor(workers) as pool:
        return list(pool.map(lambda span: transcribe(wav, *span, language, model, threads=threads), spans))


def parse_args(argv):
    """English by default: a Taglish swear is easier to spot as English letters; --lang tl checks Tagalog words."""
    language = "en"
    if argv[:1] == ["--lang"]:
        language, argv = argv[1], argv[2:]
    return language, argv[0], [tuple(float(x) for x in arg.split("-")) for arg in argv[1:]]


if __name__ == "__main__":
    lang, wav, spans = parse_args(sys.argv[1:])
    for (start, end), words in zip(spans, transcribe_all(wav, spans, lang)):
        print(f"{start:8.2f}-{end:8.2f} -> {''.join(word['text'] for word in words).strip()}", flush=True)
