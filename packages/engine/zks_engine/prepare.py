# Created by The Angelo Umali.
# Builds the per-video working files from the raw footage: 16 kHz mono audio (transcription, energy,
# cut snapping) and a 1080x1920 proxy (review stills, frame strips). The raw file is only ever read.
# Usage (from the work dir): python -m zks_engine.prepare v1 ../raw-footage.MP4
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import backends, ffio, join_sources, progress
from .audio import GAP_FILL
from .backends.graph import restamp
from .pipeline import CUDA_LANCZOS, CUDA_TV_RANGE, DROP_ROTATION, OUTPUT, WORK, assert_upright, chain, decode_args, orientation_filter, split_orientation
from .render_final import has_filter


def encode_reporting(command, source, video, stage_name):
    """Runs the ffmpeg command as a progress stage measured in source seconds, so the bar moves while it encodes."""
    total = ffio.probe(source).get("durationS") or None
    with progress.job(video, stage_name, total=total, unit="seconds") as stage:
        stage.begin()
        ffio.run_reporting(command, lambda seconds: stage.update(min(seconds, total) if total else seconds))


def build_audio(source, video, clip=None):
    """clip: the raw clip `source` is, so the wav ends with its frames (as the joined source's audio does) and a silent clip
    gets silence."""
    (WORK / "audio").mkdir(exist_ok=True)
    target = WORK / "audio" / f"{video}.wav"
    # Renamed into place whole: a transcription waiting on this ingest starts once the wav is newer than the ingest.
    partial = target.with_name(f"{video}.partial.wav")
    silent = clip is not None and not clip.audio
    sound = ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"] if silent else ffio.user_input_args(source)
    length = ["-t", f"{clip.frames * clip.fps[1] / clip.fps[0]:.6f}"] if clip is not None else []
    # A raw clip's audio can stop before its video: padded, then cut at the video's length, as the joined source's is.
    fill = f"{GAP_FILL},apad" if length else GAP_FILL
    encode_reporting([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *sound, "-vn", "-ac", "1", "-ar", "16000", "-af", fill,
                      *length, "-c:a", "pcm_s16le", str(partial)], source, video, "audio")
    partial.replace(target)
    return target


def proxy_filter(gpu_turn, cpu_turn, cuda):
    """Upright 1080x1920 proxy frames: all on CUDA unless the turn needs the CPU (a half turn)."""
    if cuda and not cpu_turn:
        return chain(gpu_turn, CUDA_TV_RANGE, CUDA_LANCZOS.format(*OUTPUT))
    return chain("hwdownload,format=nv12" if cuda else "", cpu_turn, "scale=1080:1920:flags=lanczos", DROP_ROTATION)


def build_proxy(source, video, backend):
    (WORK / "mezz").mkdir(exist_ok=True)
    target = WORK / "mezz" / f"{video}.mp4"
    partial = target.with_name(f"{video}.partial.mp4")
    gpu_turn = orientation_filter(source, True) if backend.name == "nvidia" else ""
    cuda = backend.name == "nvidia" and (not gpu_turn.startswith("transpose_cuda") or has_filter("transpose_cuda"))
    if cuda:
        hardware, video_filter = decode_args(True), proxy_filter(*split_orientation(gpu_turn), True)
    else:  # system frames come back autorotated
        hardware, video_filter = [*backend.device, *backend.decode], proxy_filter("", "", False) + backend.upload
    # 1-second GOP so review stills can seek to any time quickly.
    encode_reporting([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *hardware, *ffio.user_input_args(source), "-vf", video_filter,
                      *backend.proxy, "-g", "30", "-c:a", "copy", str(partial)], source, video, "proxy")
    return swap_in(partial, target)


def swap_in(partial, target):
    """Encoded beside the target and swapped in only once it checks out, so a failed build never replaces a good proxy."""
    assert_upright(partial)
    partial.replace(target)
    return target


def raw_proxy_filter(clip):
    """join_sources.cpu_picture at proxy size: the same frames by decode index, crop, tone-map and letterbox, so proxy
    frame n is source frame n."""
    width, height = (side * OUTPUT[0] // join_sources.SIZE[0] // 2 * 2 for side in join_sources.fitted(clip))
    crop = f"crop=iw/{clip.zoom}:ih/{clip.zoom}:(iw-iw/{clip.zoom})/2:0" if clip.zoom != 1 else ""
    bars = f"pad={OUTPUT[0]}:{OUTPUT[1]}:0:{(OUTPUT[1] - height) // 2}:color=black,setsar=1" if join_sources.letterbox(clip) else ""
    return chain(f"select='between(n,0,{clip.frames - 1})'", crop, join_sources.CPU_TONEMAP if clip.hdr else "",
                 join_sources.CPU_SCALE_TO.format(width, height), bars, restamp({"fps_num": clip.fps[0], "fps_den": clip.fps[1]}), DROP_ROTATION)


def build_raw_proxy(clip, video, backend, on_seconds):
    """The proxy straight from one raw clip, decoded to system frames (autorotated) and encoded with the backend."""
    (WORK / "mezz").mkdir(exist_ok=True)
    target = WORK / "mezz" / f"{video}.mp4"
    partial = target.with_name(f"{video}.partial.mp4")
    rate = f"{clip.fps[0]}/{clip.fps[1]}"
    # Silence pads audio that stops early: -shortest then ends on the video's own frame count, never on the audio.
    audio = ["-af", "apad", "-c:a", "aac", "-b:a", "192k"] if clip.audio else ["-an"]
    ffio.run_reporting([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *backend.device, *backend.decode, *ffio.user_input_args(clip.path),
                        "-vf", raw_proxy_filter(clip) + backend.upload, "-r", rate, "-fps_mode", "cfr", "-frames:v", str(clip.frames), *backend.proxy,
                        "-g", "30", *audio, "-shortest", str(partial)], on_seconds)
    return swap_in(partial, target)


def ingest_one(video, argument):
    """One clip: the wav first and then the proxy straight from the raw, the proxy beside the 4K join, so whisper and the
    editor start minutes sooner. The proxy reports as its own step after the join, since a video has one progress record."""
    clip = join_sources.probe(argument)
    build_audio(clip.path, video, clip)
    seconds, stop = [0.0], threading.Event()

    def on_seconds(written):
        if stop.is_set():
            raise InterruptedError("the join failed")  # run_reporting kills the encode
        seconds[0] = written

    with ThreadPoolExecutor(1) as pool:
        proxy = pool.submit(build_raw_proxy, clip, video, backends.active(), on_seconds)
        try:
            clips = join_sources.main(f"sources/{video}.mkv", [argument])
        except BaseException:
            stop.set()
            raise
        total = clip.frames * clip.fps[1] / clip.fps[0]
        with progress.job(video, "proxy", total=total, unit="seconds") as stage:
            stage.begin()
            while not proxy.done():
                stage.update(min(seconds[0], total))
                threading.Event().wait(ffio.POLL_S)
            proxy.result()
            stage.update(total)
    return clips


if __name__ == "__main__":
    video_name, source_file = sys.argv[1], Path(sys.argv[2])
    if not source_file.is_file():
        sys.exit(f"source not found: {source_file}")
    active = backends.active()
    print(f"audio: {build_audio(source_file, video_name)}")
    print(f"proxy ({active.name}): {build_proxy(source_file, video_name, active)}")
