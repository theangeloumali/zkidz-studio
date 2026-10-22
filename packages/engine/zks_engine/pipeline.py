# Created by The Angelo Umali.
# Shared plumbing for the engine: paths, frame rate, loaders, time mapping, decode mode, orientation.
# Commands run from the project's work dir (cwd) or ZKS_WORK; the package holds only code.
import json
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

from . import ffio
from .home import data_dir

FPS_NUM, FPS_DEN = 30000, 1001
FPS = FPS_NUM / FPS_DEN
AUDIO_RATE = 48000
ENERGY_WINDOW = 0.01
FRAME_EPSILON = 1e-6
WHISPER_MODEL = "ggml-large-v3-turbo.bin"
VAD_MODEL = "ggml-silero-v5.1.2.bin"
DROP_ROTATION = "sidedata=mode=delete:type=DISPLAYMATRIX"
OUTPUT = (1080, 1920)  # the 9:16 frame TikTok and Reels play
# ffprobe rotation (mod 360) -> the CUDA-path filter that stands the frame upright; a half turn runs after hwdownload.
CUDA_UPRIGHT = {0: "", 270: "transpose_cuda=dir=clock", 90: "transpose_cuda=dir=cclock", 180: "hflip,vflip"}
# scale_cuda clamps lanczos undershoot at 0 but wraps overshoot past 255 (275 -> 19): black specks on full-range whites.
# TV luma has 20 codes over one pass's ~18; chroma and blur.py's second pass measured 0 wraps on this footage (QC r7).
CUDA_TV_RANGE = "colorspace_cuda=range=tv"
CUDA_LANCZOS = "scale_cuda={}:{}:interp_algo=lanczos"  # only ever after CUDA_TV_RANGE


def work_dir():
    return Path(os.environ.get("ZKS_WORK") or Path.cwd())


def models_dir():
    return data_dir("models")


# The HyperFrames renderer and the overlay page it draws through; the project installs editable, so it sits beside the package.
HF_DIR = Path(__file__).resolve().parent.parent / "hf"


WORK = work_dir()
# At most this many ffmpeg/whisper jobs at once: more saturated the machine (6 in flight hung the desktop).
MAX_JOBS = int(os.environ.get("ZKS_JOBS", "2"))


def load_cuts(video):
    return json.loads((WORK / "cuts" / f"{video}.json").read_text(encoding="utf-8"))


def load_edl(video):
    return json.loads((WORK / "edl" / f"{video}.json").read_text(encoding="utf-8"))


def source_path(spec):
    """A relative `source` in a cut spec is relative to the work dir's parent (the footage folder)."""
    return WORK.parent / spec["source"]


def frame_to_sample(frame, edl):
    return round(frame * AUDIO_RATE * edl["fps_den"] / edl["fps_num"])


def intro_track(video):
    """The brand pre-roll's own audio (sfx.py writes it, render_final.py plays it before the edit)."""
    return WORK / "audio" / f"{video}_intro.wav"


def source_to_edited(seconds, edl):
    frame = seconds * edl["fps_num"] / edl["fps_den"]
    for seg in edl["segments"]:
        if seg["in"] <= frame <= seg["out"]:
            return (seg["target"] + frame - seg["in"]) * edl["fps_den"] / edl["fps_num"]
    raise ValueError(f"source {seconds:.2f}s falls inside a removed range")


def map_interval(start, end, edl):
    """A source span as edited (start, end) seconds: clipped to each kept segment it touches, merged where kept
    segments abut in the edit, and [] when it falls wholly inside removed footage. Segments are in source order."""
    rate = edl["fps_num"] / edl["fps_den"]
    spans = []
    for seg in edl["segments"]:
        low, high = max(start * rate, seg["in"]), min(end * rate, seg["out"])
        if high - low <= FRAME_EPSILON:  # a span ending exactly on a cut must not leave a float-noise sliver
            continue
        edited = (seg["target"] + low - seg["in"], seg["target"] + high - seg["in"])
        if spans and spans[-1][1] == edited[0]:
            spans[-1] = (spans[-1][0], edited[1])
        else:
            spans.append(edited)
    return [(low / rate, high / rate) for low, high in spans]


def energy_db(samples, rate, window=ENERGY_WINDOW):
    """RMS level in dB for each `window` seconds of mono samples."""
    import numpy as np  # local, so doctor.py can report a missing numpy instead of crashing on import

    hop = int(rate * window)
    count = len(samples) // hop
    rms = np.sqrt((samples[: count * hop].reshape(count, hop) ** 2).mean(axis=1) + 1e-12)
    return 20 * np.log10(rms)


def load_energy(wav_path, window=ENERGY_WINDOW):
    """RMS level in dB for each `window` seconds of a mono 16-bit WAV."""
    import numpy as np

    with wave.open(str(wav_path)) as wav:
        rate = wav.getframerate()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return energy_db(samples, rate, window)


def read_wav(path):
    """Any file's audio as float64 stereo at AUDIO_RATE."""
    import numpy as np

    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(AUDIO_RATE), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def has_cuda():
    """CUDA decode needs both an ffmpeg built with it and a working NVIDIA driver (never on a Mac)."""
    if not shutil.which("nvidia-smi"):
        return False
    hwaccels = subprocess.run(["ffmpeg", "-hide_banner", "-hwaccels"], capture_output=True, text=True).stdout
    return "cuda" in hwaccels.split()


def decode_args(cuda):
    return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] if cuda else []


def chain(*filters):
    return ",".join(item for item in filters if item)


def probe_video(path):
    result = subprocess.run(["ffprobe", "-v", "error", *ffio.WHITELISTS, "-select_streams", "v:0", "-show_entries",
                             "stream=codec_name,width,height,pix_fmt,sample_aspect_ratio:stream_side_data", "-of", "json", str(path)],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)["streams"][0]


def rotation_of(stream):
    return next((round(data["rotation"]) for data in stream.get("side_data_list", []) if "rotation" in data), 0)


def upright_size(path):
    return upright_dims(probe_video(path))


def upright_dims(stream):
    turned = rotation_of(stream) % 180 == 90
    return (stream["height"], stream["width"]) if turned else (stream["width"], stream["height"])


def orientation_filter(path, cuda):
    """ffmpeg 9 skips autorotate for GPU frames, so the CUDA path turns them itself; CPU decode autorotates.
    Never -noautorotate: it writes the rotation into the output, so players turn upright frames again (measured)."""
    if not cuda:
        return ""
    return CUDA_UPRIGHT[rotation_of(probe_video(path)) % 360]


def split_orientation(orientation):
    """(stage before hwdownload, stage after it): only transpose_cuda runs on GPU frames."""
    return (orientation, "") if orientation.startswith("transpose_cuda") else ("", orientation)


def assert_upright(path, size=OUTPUT):
    """Every proxy and master must be a square-pixel portrait of size with no rotation for a player to apply."""
    stream = probe_video(path)
    problems = []
    if (stream["width"], stream["height"]) != size:
        problems.append(f"size {stream['width']}x{stream['height']}, expected {size[0]}x{size[1]}")
    if stream.get("sample_aspect_ratio", "N/A") not in ("1:1", "0:1", "N/A"):
        problems.append(f"SAR {stream['sample_aspect_ratio']}, expected 1:1")
    if any(data.get("side_data_type") == "Display Matrix" for data in stream.get("side_data_list", [])):
        problems.append(f"rotation side data ({rotation_of(stream)} degrees)")
    if problems:
        sys.exit(f"{path}: " + "; ".join(problems))


def filter_path(path):
    """A path as a filter option value. The drive colon in C:/ ends an option unless quoted AND escaped
    (measured: a bare \\: fails, '...\\:...' parses)."""
    return "'" + Path(path).as_posix().replace(":", r"\:") + "'"


def whisper_filter(destination, fmt, language="tl", word_level=True, vad=True, queue=20):
    parts = [f"model={filter_path(models_dir() / WHISPER_MODEL)}", f"language={language}", f"queue={queue}",
             f"destination={filter_path(destination)}", f"format={fmt}"]
    if word_level:
        parts.append("max_len=1")
    if vad:
        parts.append(f"vad_model={filter_path(models_dir() / VAD_MODEL)}")
    return "whisper=" + ":".join(parts)
