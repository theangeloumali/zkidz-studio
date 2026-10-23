# Created by The Angelo Umali.
# Joins several recordings into one uniform source the engine can cut: 2160x3840 8-bit BT.709 SDR at 30000/1001, HEVC,
# with lossless FLAC audio. HDR clips (HLG / PQ) are tone-mapped; every clip is upscaled with libplacebo on the GPU.
# Usage (from the work dir): python -m zks_engine.join_sources sources/v8.mkv ../clip1.mp4@1.25 ../clip2.mp4 ...
#   clip@Z zooms that clip Z x, anchored at the top, so a face framed high drops below the card band (y 270-600).
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import NamedTuple

from . import ffio
from . import progress
from .pipeline import AUDIO_RATE, CUDA_UPRIGHT, DROP_ROTATION, FPS_DEN, FPS_NUM, WORK, chain, probe_video, rotation_of, split_orientation
from .render_final import LOW_PRIORITY, RENDER_JOBS, count_frames
from .slots import slot

SIZE = (2160, 3840)
HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}
SCALE = (f"libplacebo=w={SIZE[0]}:h={SIZE[1]}:upscaler=ewa_lanczos:downscaler=ewa_lanczos:colorspace=bt709:color_primaries=bt709:"
         "color_trc=bt709:range=tv:format=yuv420p")
# Picked on "Where to find clients" clip 3 (HLG + Dolby Vision 8.4) beside its SDR sibling: bt.2390 pushed skin red.
TONEMAP = "tonemapping=bt.2446a:gamut_mode=perceptual:saturation=0.9:contrast=1.05"
ENCODER = ["-c:v", "hevc_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "14", "-b:v", "0", "-spatial-aq", "1"]
MIN_PIECE_FRAMES = 1800  # a piece shorter than 60 s spends much of its time starting up


class Clip(NamedTuple):
    path: Path
    frames: int
    hdr: bool
    zoom: float
    ten_bit: bool  # NVDEC hands out nv12 for 8-bit, p010 for 10-bit; hwdownload cannot convert between them
    rotation: int = 0  # display matrix degrees; NVDEC frames skip autorotate, so the piece turns them itself


def probe(argument):
    path, _, zoom = argument.partition("@")
    stream = json.loads(subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                                        "stream=nb_read_packets,color_transfer,r_frame_rate,pix_fmt", "-of", "json",
                                        *ffio.user_input_args(path)],
                                       capture_output=True, text=True, check=True).stdout)["streams"][0]
    if stream["r_frame_rate"] != f"{FPS_NUM}/{FPS_DEN}":
        sys.exit(f"{path}: {stream['r_frame_rate']} fps; the engine assumes {FPS_NUM}/{FPS_DEN}")
    return Clip(Path(path), int(stream["nb_read_packets"]), stream.get("color_transfer") in HDR_TRANSFERS, float(zoom or 1),
                "10" in stream["pix_fmt"], rotation_of(probe_video(path)) % 360)


def pieces(clips, jobs=RENDER_JOBS):
    """(clip, first frame, frame count) pieces: every clip is at least one, and a long clip splits by its share of `jobs`."""
    total = sum(clip.frames for clip in clips)
    result = []
    for clip in clips:
        count = max(1, min(jobs, round(jobs * clip.frames / total), clip.frames // MIN_PIECE_FRAMES))
        result += [(clip, clip.frames * i // count, clip.frames * (i + 1) // count - clip.frames * i // count) for i in range(count)]
    return result


def picture(clip):
    crop = f":crop_w=iw/{clip.zoom}:crop_h=ih/{clip.zoom}:crop_x=(iw-iw/{clip.zoom})/2:crop_y=0" if clip.zoom != 1 else ""
    return SCALE + crop + (f":{TONEMAP}" if clip.hdr else "")


def piece_filter(clip, first, frames):
    on_gpu, on_cpu = split_orientation(CUDA_UPRIGHT[clip.rotation])
    download = f"hwdownload,format={'p010le' if clip.ten_bit else 'nv12'}"
    return chain(f"select='between(n,{first},{first + frames - 1})'", on_gpu, download, on_cpu, picture(clip),
                 f"setpts=N*{FPS_DEN}/({FPS_NUM}*TB)", DROP_ROTATION)


def piece_command(clip, first, frames, out):
    """Frames picked by decode index on the GPU, never by a time seek: clip 1's timestamps shift ~half a frame mid-file,
    so a seek half a frame before frame k landed on k+1. Output is re-stamped by index (drift vs audio stays under
    ~25 ms inside a clip; audio_command resets it at every join)."""
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-init_hw_device", "vulkan", "-hwaccel", "cuda",
            "-hwaccel_output_format", "cuda", *ffio.user_input_args(clip.path),
            "-vf", piece_filter(clip, first, frames),
            "-r", f"{FPS_NUM}/{FPS_DEN}", "-fps_mode", "cfr", "-frames:v", str(frames), *ENCODER, "-an", str(out)]


def run_all(commands):
    """Exit codes of the commands that failed, RENDER_JOBS at a time: 14 at once meant 14 libplacebo Vulkan devices, and 12
    failed VK_ERROR_INITIALIZATION_FAILED."""
    with ThreadPoolExecutor(RENDER_JOBS) as pool:
        return [code for code in pool.map(lambda command: subprocess.run(command, **LOW_PRIORITY).returncode, commands) if code]


def audio_command(clips, out):
    """Each clip's audio padded or trimmed to exactly its video length, so lip sync cannot drift across a join."""
    inputs = [arg for clip in clips for arg in ffio.user_input_args(clip.path)]
    chains = "".join(f"[{i}:a]aresample={AUDIO_RATE},apad,atrim=end_sample={round(clip.frames * AUDIO_RATE * FPS_DEN / FPS_NUM)}[a{i}];"
                     for i, clip in enumerate(clips))
    joined = "".join(f"[a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1[a]"
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", chains + joined, "-map", "[a]",
            "-c:a", "flac", str(out)]


def main(target, arguments):
    target = WORK / target
    clips = [probe(argument) for argument in arguments]
    expected = sum(clip.frames for clip in clips)
    work = target.with_name(f"{target.stem}-pieces")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    plan = pieces(clips)
    outputs = [work / f"{index:02d}.mp4" for index in range(len(plan))]
    commands = [piece_command(*piece, out) for piece, out in zip(plan, outputs)] + [audio_command(clips, work / "audio.flac")]
    print(f"joining {len(clips)} clips ({expected} frames) as {len(plan)} GPU pieces, {RENDER_JOBS} at once", flush=True)
    with slot("gpu", f"join_sources {target.name} ({WORK})"):
        codes = run_all(commands)
    if codes:
        sys.exit(f"join failed (exit codes {codes}); pieces kept in {work}")
    for (_, _, frames), out in zip(plan, outputs):
        if count_frames(out) != frames:
            sys.exit(f"{out.name}: {count_frames(out)} frames, expected {frames}")
    listing = work / "pieces.txt"
    listing.write_text(ffio.concat_listing(outputs), encoding="utf-8")
    subprocess.run([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *ffio.concat_input_args(listing),
                    "-i", str(work / "audio.flac"), "-map", "0:v", "-map", "1:a", "-c", "copy", "-colorspace", "bt709",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", str(target)], check=True)
    if count_frames(target) != expected:
        sys.exit(f"{target.name}: {count_frames(target)} frames after the join, expected {expected}")
    shutil.rmtree(work)
    starts, cursor = [], 0
    for clip in clips:
        notes = [note for note, on in (("HDR tone-mapped", clip.hdr), (f"zoom {clip.zoom}x", clip.zoom != 1)) if on]
        starts.append(f"{clip.path.name} @ {cursor * FPS_DEN / FPS_NUM:.3f}s" + (f" ({', '.join(notes)})" if notes else ""))
        cursor += clip.frames
    print(f"joined {target} ({expected} frames): " + "; ".join(starts))


if __name__ == "__main__":
    with progress.job(Path(sys.argv[1]).stem, "join"):
        main(sys.argv[1], sys.argv[2:])
