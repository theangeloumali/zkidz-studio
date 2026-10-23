# Created by The Angelo Umali.
# whisper.cpp's whisper-cli (plan §7.4): the pinned binary under ZKS_HOME/tools, the model, and the word JSON it writes.
# The pinned ffmpeg is built --disable-whisper (spike 04), so every transcription runs here.
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from ..ffio import ToolMissing
from ..home import data_dir

TOOLS_LOCK = Path(__file__).resolve().parents[4] / "tools.lock.json"
SHORT_HASH_LENGTH = 12  # @zks/shared pinnedInstallDir names each extract by this much of its SHA-256
# The pinned whisper-cli builds are CPU-only, so the quantised turbo leads (plan §7.4: CPU -> large-v3-turbo-q5_0).
MODEL_PREFERENCE = ("large-v3-turbo-q5_0", "large-v3-turbo", "base", "tiny")
BLANK_AUDIO = "[BLANK_AUDIO]"  # whisper.cpp's marker for a silent stretch, not a word
OS_PREFIX = {"linux": "linux", "win32": "win", "darwin": "mac"}
ARCH_NAME = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}
SETUP_FIX = "Run: pnpm zks setup"


def platform_key(system=sys.platform, machine=platform.machine()):
    """The tools.lock.json platform key, as @zks/shared platformKey names it."""
    return f"{OS_PREFIX.get(system, system)}-{ARCH_NAME.get(machine.lower(), machine.lower())}"


def load_lock(path=TOOLS_LOCK):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def cli_path(lock=None, key=None):
    """The pinned whisper-cli `pnpm zks setup` installed; PATH only for a Homebrew pin, never an unverified stand-in."""
    entry = (lock or load_lock())["tools"]["whisper-cpp"]["platforms"].get(key or platform_key(), {})
    if "sha256" in entry:
        pinned = data_dir("tools") / "whisper-cpp" / entry["sha256"][:SHORT_HASH_LENGTH] / entry.get("executable", "whisper-cli")
        if pinned.exists():
            return pinned
    elif "homebrew" in entry and (found := shutil.which(Path(entry.get("executable", "whisper-cli")).name)):
        return Path(found)
    raise ToolMissing(f"whisper-cli is not installed. {SETUP_FIX}")


def model_path(name=None, lock=None):
    """The named model, or the most accurate one installed in ZKS_HOME/models."""
    models = (lock or load_lock())["models"]
    if name and name not in models:
        raise ValueError(f"no pinned whisper model '{name}' (tools.lock.json has {', '.join(models)})")
    candidates = [name] if name else [model for model in MODEL_PREFERENCE if model in models]
    for candidate in candidates:
        path = data_dir("models") / models[candidate]["file"]
        if path.exists():
            return path
    wanted = models[name]["file"] if name else "a whisper model"
    raise ToolMissing(f"{wanted} is not in {data_dir('models')}. {SETUP_FIX}")


def cli_args(executable, model, wav, output_base, language, threads):
    return [str(executable), "-m", str(model), "-f", str(wav), "-l", language, "-t", str(threads), "-oj", "-of", str(output_base), "-np",
            # One word per segment: -ml 1 alone splits on tokens, which cuts words in half.
            "-ml", "1", "-sow"]


def parse_transcription(document):
    """whisper-cli -oj output -> the transcript's word lines ({start, end} in ms, text with its leading space)."""
    words = []
    for segment in document["transcription"]:
        text = segment["text"]
        if text.strip() and text.strip() != BLANK_AUDIO:
            words.append({"start": segment["offsets"]["from"], "end": segment["offsets"]["to"], "text": text})
    return words


def write_window(source, start, end, destination, lead=0.0, tail=0.0):
    """Copies start..end seconds of a 16-bit PCM wav, with lead/tail seconds of silence around it."""
    with wave.open(str(source), "rb") as reader:
        rate, width, channels = reader.getframerate(), reader.getsampwidth(), reader.getnchannels()
        first = min(round(start * rate), reader.getnframes())
        reader.setpos(first)
        frames = reader.readframes(max(0, round(end * rate) - first))

    def silence(seconds):
        return bytes(round(seconds * rate) * width * channels)

    with wave.open(str(destination), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(width)
        writer.setframerate(rate)
        writer.writeframes(silence(lead) + frames + silence(tail))


def transcribe_file(wav, language, model, threads=4):
    """Word lines for one wav, timed from its first sample."""
    with tempfile.TemporaryDirectory(prefix="zks-whisper-") as scratch:
        output_base = Path(scratch) / "words"
        result = subprocess.run(cli_args(cli_path(), model, wav, output_base, language, threads), capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f"whisper-cli failed on {Path(wav).name} (exit {result.returncode}): {result.stderr.strip()[-300:]}")
        # A word split mid-character must not sink an hour-long transcription.
        document = json.loads(output_base.with_suffix(".json").read_text(encoding="utf-8", errors="replace"))
    return parse_transcription(document)
