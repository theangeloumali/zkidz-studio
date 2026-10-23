# Created by The Angelo Umali.
# Transcribes short audio windows in isolation (silence-padded, no context) to confirm what each one holds.
# Usage (from the work dir): python -m zks_engine.check_windows [--lang tl] audio/v3.wav 31.78-32.12 31.40-31.80 ...
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from . import ffio
from .pipeline import MAX_JOBS, WORK, whisper_filter


def transcribe(wav, start, end, language):
    out = WORK / "transcripts" / f"_w{start}_{end}_{language}.txt"
    subprocess.run([ffio.ffmpeg_bin(), "-y", "-v", "error", "-ss", f"{start}", "-to", f"{end}", *ffio.user_input_args(WORK / wav), "-af",
                    # No VAD + silence padding: the window is judged on its own sound, not context.
                    "adelay=500:all=1,apad=pad_dur=1," + whisper_filter(out, "text", language=language, word_level=False, vad=False, queue=5),
                    "-f", "null", "-"], cwd=WORK, check=True)
    text = out.read_text(encoding="utf-8").replace("\n", " ").strip()
    out.unlink()
    return text


def parse_args(argv):
    """English by default: a Taglish swear is easier to spot as English letters; --lang tl checks Tagalog words."""
    language = "en"
    if argv[:1] == ["--lang"]:
        language, argv = argv[1], argv[2:]
    return language, argv[0], [tuple(float(x) for x in arg.split("-")) for arg in argv[1:]]


if __name__ == "__main__":
    lang, wav, spans = parse_args(sys.argv[1:])
    (WORK / "transcripts").mkdir(exist_ok=True)
    with ThreadPoolExecutor(MAX_JOBS) as pool:
        for (start, end), text in zip(spans, pool.map(lambda span: transcribe(wav, *span, lang), spans)):
            print(f"{start:8.2f}-{end:8.2f} -> {text}", flush=True)
