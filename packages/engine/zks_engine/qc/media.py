# Created by The Angelo Umali.
# Pixels and samples for the QC gates, decoded by the pinned ffmpeg onto the 1080x1920 grid every box is authored on.
import subprocess

import numpy as np

from .. import ffio
from ..pipeline import OUTPUT

GRID = f"scale={OUTPUT[0]}:{OUTPUT[1]}:flags=area"
SAMPLE_SIZE = (64, 64)
QC_AUDIO_RATE = 16000


def decode(arguments):
    return subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-nostdin", *arguments], capture_output=True, check=True).stdout


def seek_to_frame(frame, fps):
    """Half a frame early: accurate seek then starts on exactly this frame of a constant-rate file."""
    return max(0.0, (frame - 0.5) * fps[1] / fps[0])


def gray_frames(path, first_frame, count, fps, region=None, stride=1):
    """count frames from first_frame (every stride-th), the region cropped off the grid and shrunk to SAMPLE_SIZE."""
    crop = f",crop={region[2]}:{region[3]}:{region[0]}:{region[1]}" if region else ""
    pick = f",select='not(mod(n\\,{stride}))'" if stride > 1 else ""
    graph = f"{GRID}{crop}{pick},scale={SAMPLE_SIZE[0]}:{SAMPLE_SIZE[1]}:flags=area,format=gray"
    raw = decode(["-ss", f"{seek_to_frame(first_frame, fps):.6f}", *ffio.user_input_args(path), "-vf", graph, "-fps_mode", "passthrough",
                  "-frames:v", str(count), "-an", "-f", "rawvideo", "-"])
    frames = np.frombuffer(raw, np.uint8).reshape(-1, SAMPLE_SIZE[1], SAMPLE_SIZE[0]).astype(np.float32)
    if len(frames) != count:
        raise ValueError(f"{path}: {len(frames)} of {count} frames from frame {first_frame}")
    return frames


def rgb_frame(path, frame, fps):
    raw = decode(["-ss", f"{seek_to_frame(frame, fps):.6f}", *ffio.user_input_args(path), "-vf", f"{GRID},format=rgb24", "-frames:v", "1", "-an",
                  "-f", "rawvideo", "-"])
    return np.frombuffer(raw, np.uint8).reshape(OUTPUT[1], OUTPUT[0], 3)


def mono_audio(path, start_s, duration_s, rate=QC_AUDIO_RATE):
    """Mono float samples; a window starting before 0 is padded with silence so its length always holds."""
    lead = max(0.0, -start_s)
    raw = decode(["-ss", f"{max(0.0, start_s):.6f}", *ffio.user_input_args(path), "-t", f"{duration_s - lead:.6f}", "-vn", "-ac", "1", "-ar", str(rate),
                  "-f", "f32le", "-"])
    samples = np.concatenate([np.zeros(round(lead * rate)), np.frombuffer(raw, np.float32).astype(np.float64)])
    wanted = round(duration_s * rate)
    return np.pad(samples, (0, max(0, wanted - len(samples))))[:wanted]


def write_wav(path, master, start_s, duration_s):
    """A 16 kHz mono stretch of the master for whisper.cpp."""
    decode(["-ss", f"{max(0.0, start_s):.6f}", *ffio.user_input_args(master), "-t", f"{duration_s:.6f}", "-vn", "-ac", "1", "-ar", str(QC_AUDIO_RATE),
            "-c:a", "pcm_s16le", "-y", str(path)])


def overlay_alpha(frames_dir, count, fps):
    """The overlay PNGs' alpha for edited frames 0..count-1. The frames are the engine's own, so no user-media policy applies."""
    raw = decode(["-framerate", f"{fps[0]}/{fps[1]}", "-start_number", "0", "-i", str(frames_dir / "%05d.png"), "-frames:v", str(count),
                  "-vf", "alphaextract,format=gray", "-f", "rawvideo", "-"])
    return np.frombuffer(raw, np.uint8).reshape(-1, OUTPUT[1], OUTPUT[0])
