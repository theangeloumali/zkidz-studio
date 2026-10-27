# Created by The Angelo Umali.
# Builds the per-video working files from the raw footage: 16 kHz mono audio (transcription, energy,
# cut snapping) and a 1080x1920 proxy (review stills, frame strips). The raw file is only ever read.
# Usage (from the work dir): python -m zks_engine.prepare v1 ../raw-footage.MP4
import subprocess
import sys
from pathlib import Path

from . import backends, ffio
from .audio import GAP_FILL
from .pipeline import CUDA_LANCZOS, CUDA_TV_RANGE, DROP_ROTATION, OUTPUT, WORK, assert_upright, chain, decode_args, orientation_filter, split_orientation
from .render_final import has_filter


def build_audio(source, video):
    (WORK / "audio").mkdir(exist_ok=True)
    target = WORK / "audio" / f"{video}.wav"
    subprocess.run([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *ffio.user_input_args(source), "-vn", "-ac", "1", "-ar", "16000", "-af", GAP_FILL,
                    "-c:a", "pcm_s16le", str(target)], check=True)
    return target


def proxy_filter(gpu_turn, cpu_turn, cuda):
    """Upright 1080x1920 proxy frames: all on CUDA unless the turn needs the CPU (a half turn)."""
    if cuda and not cpu_turn:
        return chain(gpu_turn, CUDA_TV_RANGE, CUDA_LANCZOS.format(*OUTPUT))
    return chain("hwdownload,format=nv12" if cuda else "", cpu_turn, "scale=1080:1920:flags=lanczos", DROP_ROTATION)


def build_proxy(source, video, backend):
    (WORK / "mezz").mkdir(exist_ok=True)
    target = WORK / "mezz" / f"{video}.mp4"
    # Encoded beside the target and swapped in only once it checks out, so a failed build never replaces a good proxy.
    partial = target.with_name(f"{video}.partial.mp4")
    gpu_turn = orientation_filter(source, True) if backend.name == "nvidia" else ""
    cuda = backend.name == "nvidia" and (not gpu_turn.startswith("transpose_cuda") or has_filter("transpose_cuda"))
    if cuda:
        hardware, video_filter = decode_args(True), proxy_filter(*split_orientation(gpu_turn), True)
    else:  # system frames come back autorotated
        hardware, video_filter = [*backend.device, *backend.decode], proxy_filter("", "", False) + backend.upload
    # 1-second GOP so review stills can seek to any time quickly.
    subprocess.run([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *hardware, *ffio.user_input_args(source), "-vf", video_filter,
                    *backend.proxy, "-g", "30", "-c:a", "copy", str(partial)], check=True)
    assert_upright(partial)
    partial.replace(target)
    return target


if __name__ == "__main__":
    video_name, source_file = sys.argv[1], Path(sys.argv[2])
    if not source_file.is_file():
        sys.exit(f"source not found: {source_file}")
    active = backends.active()
    print(f"audio: {build_audio(source_file, video_name)}")
    print(f"proxy ({active.name}): {build_proxy(source_file, video_name, active)}")
