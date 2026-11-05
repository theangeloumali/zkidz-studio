# Created by The Angelo Umali.
# Joins several recordings into one uniform source the engine can cut: 2160x3840 8-bit BT.709 SDR at the clips' shared
# rate, HEVC, with lossless FLAC audio. HDR clips (HLG / PQ) are tone-mapped; on NVIDIA every clip is upscaled on the GPU
# (libplacebo when the probe found a Vulkan GPU, else scale_cuda), and the other backends scale and tone-map on the CPU.
# Usage (from the work dir): python -m zks_engine.join_sources sources/v8.mkv ../media/clip1.mp4@1.25 ../media/clip2.mp4 ...
#   clip@Z zooms that clip Z x, anchored at the top, so a face framed high drops below the card band (y 270-600).
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path
from typing import NamedTuple

from . import backends, ffio
from . import progress
from .backends.graph import restamp
from .pipeline import AUDIO_RATE, CUDA_DEVICE, CUDA_HWACCEL, CUDA_TV_RANGE, CUDA_UPRIGHT, DROP_ROTATION, FPS_DEN, FPS_NUM, WORK, chain, command_input, probe_video, rotation_of, split_orientation
from .render_final import GPU_SCALE, LOW_PRIORITY, count_frames, frames_written, has_filter
from .slots import slot
from .specs import gates
from .specs.paths import inside_project

SIZE = (2160, 3840)
HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}
SCALE_TO = ("libplacebo=w={}:h={}:upscaler=ewa_lanczos:downscaler=ewa_lanczos:colorspace=bt709:color_primaries=bt709:"
            "color_trc=bt709:range=tv:format=yuv420p")
SCALE = SCALE_TO.format(*SIZE)
# Picked on "Where to find clients" clip 3 (HLG + Dolby Vision 8.4) beside its SDR sibling: bt.2390 pushed skin red.
TONEMAP = "tonemapping=bt.2446a:gamut_mode=perceptual:saturation=0.9:contrast=1.05"
# The CPU stand-ins: zscale linearises, hable compresses the highlights, then BT.709 TV range.
CPU_TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
CPU_SCALE_TO = "scale={}:{}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p"
CPU_SCALE = CPU_SCALE_TO.format(*SIZE)
# #32: a frame wider than the canvas by more than this is letterboxed; a phone's 9:16 clip still fills it.
WIDER_TOLERANCE = 1.01
# What NVDEC decodes; anything else (ProRes, FFV1) decodes to system frames, as -hwaccel cuda would silently do.
NVDEC_CODECS = {"h264", "hevc", "av1", "vp8", "vp9", "mpeg1video", "mpeg2video", "mpeg4", "vc1", "mjpeg"}
MIN_PIECE_FRAMES = 1800  # a piece shorter than 60 s spends much of its time starting up


class Clip(NamedTuple):
    path: Path
    frames: int
    hdr: bool
    zoom: float
    ten_bit: bool  # NVDEC hands out nv12 for 8-bit, p010 for 10-bit; hwdownload cannot convert between them
    rotation: int = 0  # display matrix degrees; NVDEC frames skip autorotate, so the piece turns them itself
    fps: tuple = (FPS_NUM, FPS_DEN)
    nvdec: bool = True
    audio: bool = True  # a phone clip can be silent; audio_command then pads silence for it
    frame: tuple = SIZE  # the upright picture's display size (rotation and SAR applied), which decides the letterbox


def probe(argument):
    name, _, zoom = argument.partition("@")
    path = command_input(name)
    stream = json.loads(subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                                        "stream=nb_read_packets,color_transfer,r_frame_rate,pix_fmt,codec_name", "-of", "json",
                                        *ffio.user_input_args(path)],
                                       capture_output=True, text=True, check=True).stdout)["streams"][0]
    num, _, den = stream["r_frame_rate"].partition("/")
    video = probe_video(path)
    rotation = rotation_of(video) % 360
    return Clip(Path(path), int(stream["nb_read_packets"]), stream.get("color_transfer") in HDR_TRANSFERS, float(zoom or 1),
                "10" in stream["pix_fmt"], rotation, (int(num), int(den or 1)),
                stream.get("codec_name") in NVDEC_CODECS, ffio.has_audio(path), display_frame(video, rotation))


def display_frame(video, rotation):
    """Width x height as shown upright: non-square pixels widen the frame, and a quarter turn swaps the sides."""
    width, height = video.get("width"), video.get("height")
    if not width or not height:
        return SIZE
    sar_num, _, sar_den = str(video.get("sample_aspect_ratio", "1:1")).partition(":")
    if sar_num.isdigit() and sar_den.isdigit() and int(sar_num) and int(sar_den):
        width = width * int(sar_num) / int(sar_den)
    return (height, width) if rotation in (90, 270) else (width, height)


def fitted(clip):
    """The picture's size on the canvas: all of it for 9:16 or taller, and 2160 wide with bars above and below for a
    wider frame (#32), which used to be stretched into non-square pixels the upright check refused."""
    width, height = clip.frame
    if width * SIZE[1] <= height * SIZE[0] * WIDER_TOLERANCE:
        return SIZE
    return SIZE[0], round(SIZE[0] * height / width / 2) * 2


def letterbox(clip):
    """Centres a fitted picture on the black canvas; nothing for a picture that already fills it."""
    height = fitted(clip)[1]
    return "" if height == SIZE[1] else f"pad={SIZE[0]}:{SIZE[1]}:0:{(SIZE[1] - height) // 2}:color=black,setsar=1"


def picture_bands(clips):
    """Each clip's picture [x, y, w, h] on the 2160x3840 canvas over [at, end) seconds of the joined source: reframes
    crop inside it and qc's frame-faces reads it."""
    bands, cursor = [], 0
    for clip in clips:
        width, height = fitted(clip)
        seconds = lambda frame: frame * clip.fps[1] / clip.fps[0]  # noqa: E731
        bands.append({"at": seconds(cursor), "end": seconds(cursor + clip.frames), "band": [(SIZE[0] - width) // 2, (SIZE[1] - height) // 2, width, height],
                      "clip": str(clip.path)})
        cursor += clip.frames
    return bands


def write_bands(target, clips):
    target.with_suffix(".bands.json").write_text(json.dumps(picture_bands(clips), indent=1), encoding="utf-8")


def common_rate(clips):
    """One source has one frame grid: clips at different rates would need a resample, which breaks decode-index identity."""
    rates = {clip.fps for clip in clips}
    if len(rates) > 1:
        sys.exit("clips at different rates: " + ", ".join(f"{clip.path.name} {clip.fps[0]}/{clip.fps[1]}" for clip in clips))
    return rates.pop()


def pieces(clips, jobs):
    """(clip, first frame, frame count) pieces: every clip is at least one, and a long clip splits by its share of `jobs`."""
    total = sum(clip.frames for clip in clips)
    result = []
    for clip in clips:
        count = max(1, min(jobs, round(jobs * clip.frames / total), clip.frames // MIN_PIECE_FRAMES))
        result += [(clip, clip.frames * i // count, clip.frames * (i + 1) // count - clip.frames * i // count) for i in range(count)]
    return result


def picture(clip):
    crop = f":crop_w=iw/{clip.zoom}:crop_h=ih/{clip.zoom}:crop_x=(iw-iw/{clip.zoom})/2:crop_y=0" if clip.zoom != 1 else ""
    return chain(SCALE_TO.format(*fitted(clip)) + crop + (f":{TONEMAP}" if clip.hdr else ""), letterbox(clip))


def cpu_picture(clip):
    crop = f"crop=iw/{clip.zoom}:ih/{clip.zoom}:(iw-iw/{clip.zoom})/2:0" if clip.zoom != 1 else ""
    return chain(crop, CPU_TONEMAP if clip.hdr else "", CPU_SCALE_TO.format(*fitted(clip)), letterbox(clip))


def cuda_picture(clip):
    """picture() on CUDA. scale_cuda ignores a crop on CUDA frames, so a zoom scales up on CUDA and crops its top-centre
    window after download: a CPU crop moves no pixels, and overlay_cuda would pad the width to 2176."""
    width, height = fitted(clip)
    # No pad_cuda in the pinned ffmpeg: a letterboxed picture pads after download, as a zoom crops there.
    download = "hwdownload,format=yuv420p" if clip.zoom != 1 or height != SIZE[1] else ""
    if clip.zoom == 1:
        return chain(GPU_SCALE.format(width, height), download, letterbox(clip))
    big_w, big_h = (round(side * clip.zoom / 2) * 2 for side in (width, height))
    return chain(GPU_SCALE.format(big_w, big_h), download, f"crop={width}:{height}:{(big_w - width) // 2}:0", letterbox(clip))


def cuda_route(backend):
    """NVIDIA without a Vulkan GPU for libplacebo (WSL offers only llvmpipe): every scale stays on CUDA."""
    return backend.name == "nvidia" and not backend.libplacebo


def cuda_piece_filter(clip, select, timing, on_cuda):
    """A tone-map, a bit-depth drop and a half turn have no CUDA filter here, so only they run on the CPU, at the
    source's size, between download and upload."""
    on_gpu, on_cpu = split_orientation(CUDA_UPRIGHT[clip.rotation]) if on_cuda else ("", "")
    to_cuda = ""
    if not on_cuda or clip.hdr or clip.ten_bit or on_cpu:
        download = f"hwdownload,format={'p010le' if clip.ten_bit else 'nv12'}" if on_cuda else ""
        to_cuda = chain(download, on_cpu, CPU_TONEMAP if clip.hdr else "format=yuv420p", "hwupload")
    return chain(select, on_gpu, to_cuda, CUDA_TV_RANGE, cuda_picture(clip), timing, DROP_ROTATION)


def gpu_frames(backend, rotation, nvdec=True):
    """CUDA frames only on NVIDIA from a codec NVDEC decodes, and a quarter turn only with transpose_cuda (the pinned
    ffmpeg n8.1 has none)."""
    return backend.name == "nvidia" and nvdec and (rotation in (0, 180) or has_filter("transpose_cuda"))


def piece_filter(clip, first, frames, backend):
    timing = restamp({"fps_num": clip.fps[0], "fps_den": clip.fps[1]})
    select = f"select='between(n,{first},{first + frames - 1})'"
    if cuda_route(backend):
        return cuda_piece_filter(clip, select, timing, gpu_frames(backend, clip.rotation, clip.nvdec))
    if not gpu_frames(backend, clip.rotation, clip.nvdec):
        picture_filter = picture(clip) if backend.name == "nvidia" else cpu_picture(clip)
        return chain(select, picture_filter, timing, DROP_ROTATION) + backend.upload
    on_gpu, on_cpu = split_orientation(CUDA_UPRIGHT[clip.rotation])
    download = f"hwdownload,format={'p010le' if clip.ten_bit else 'nv12'}"
    return chain(select, on_gpu, download, on_cpu, picture(clip), timing, DROP_ROTATION)


def decode_for(clip, backend):
    """NVIDIA pieces keep libplacebo (one Vulkan device each); system frames come back autorotated."""
    if cuda_route(backend):
        return [*CUDA_DEVICE, *CUDA_HWACCEL, *(["-hwaccel_output_format", "cuda"] if gpu_frames(backend, clip.rotation, clip.nvdec) else [])]
    vulkan = ["-init_hw_device", "vulkan"] if backend.name == "nvidia" else []
    if gpu_frames(backend, clip.rotation, clip.nvdec):
        return [*vulkan, "-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]
    return [*vulkan, *backend.device, *backend.decode]


def piece_command(clip, first, frames, out, backend):
    """Frames picked by decode index, never by a time seek: clip 1's timestamps shift ~half a frame mid-file, so a seek
    half a frame before frame k landed on k+1. Output is re-stamped by index (drift vs audio stays under ~25 ms inside a
    clip; audio_command resets it at every join)."""
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *decode_for(clip, backend), *ffio.user_input_args(clip.path),
            "-vf", piece_filter(clip, first, frames, backend),
            "-r", f"{clip.fps[0]}/{clip.fps[1]}", "-fps_mode", "cfr", "-frames:v", str(frames), *backend.mezzanine, "-an", str(out)]


def run_all(commands, jobs, on_frames=None):
    """Exit codes of the commands that failed, `jobs` at a time: 14 at once meant 14 libplacebo Vulkan devices, and 12
    failed VK_ERROR_INITIALIZATION_FAILED. on_frames gets the frames all the commands have written, every ffio.POLL_S."""
    if on_frames:  # each command's last argument is its output; its progress file sits beside it
        commands = [[*command[:-1], "-progress", str(Path(command[-1]).with_suffix(".progress")), command[-1]] for command in commands]
    for command in commands:
        gates.check_command(command)
    reports = [Path(command[-1]).with_suffix(".progress") for command in commands]
    with ThreadPoolExecutor(jobs) as pool:
        runs = [pool.submit(lambda command=command: subprocess.run(command, **LOW_PRIORITY).returncode) for command in commands]
        while on_frames and wait(runs, ffio.POLL_S).not_done:
            on_frames(sum(frames_written(report) for report in reports))
        if on_frames:
            on_frames(sum(frames_written(report) for report in reports))
        return [code for code in (run.result() for run in runs) if code]


def audio_command(clips, out):
    """Each clip's audio padded or trimmed to exactly its video length, so lip sync cannot drift across a join."""
    inputs = [arg for clip in clips for arg in (ffio.user_input_args(clip.path) if clip.audio else ["-f", "lavfi", "-i", f"anullsrc=r={AUDIO_RATE}:cl=stereo"])]
    chains = "".join(f"[{i}:a]aresample={AUDIO_RATE},apad,atrim=end_sample={round(clip.frames * AUDIO_RATE * clip.fps[1] / clip.fps[0])}[a{i}];"
                     for i, clip in enumerate(clips))
    joined = "".join(f"[a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1[a]"
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", chains + joined, "-map", "[a]",
            "-c:a", "flac", str(out)]


def main(target, arguments):
    target = inside_project(WORK / target, WORK)
    clips = [probe(argument) for argument in arguments]
    num, den = common_rate(clips)
    backend = backends.active()
    jobs = backends.render_jobs(backend)
    expected = sum(clip.frames for clip in clips)
    work = target.with_name(f"{target.stem}-pieces")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    plan = pieces(clips, jobs)
    outputs = [work / f"{index:02d}.mp4" for index in range(len(plan))]
    commands = [piece_command(*piece, out, backend) for piece, out in zip(plan, outputs)] + [audio_command(clips, work / "audio.flac")]
    print(f"joining {len(clips)} clips ({expected} frames) as {len(plan)} {backend.name} pieces, {jobs} at once", flush=True)
    with progress.job(target.stem, "joining", total=expected) as stage:
        with slot("gpu", f"join_sources {target.name} ({WORK})", on_wait=stage.wait):
            stage.begin()
            codes = run_all(commands, jobs, stage.update)
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
    write_bands(target, clips)
    starts, cursor = [], 0
    for clip in clips:
        notes = [note for note, on in (("HDR tone-mapped", clip.hdr), (f"zoom {clip.zoom}x", clip.zoom != 1)) if on]
        starts.append(f"{clip.path.name} @ {cursor * den / num:.3f}s" + (f" ({', '.join(notes)})" if notes else ""))
        cursor += clip.frames
    print(f"joined {target} ({expected} frames): " + "; ".join(starts))
    return clips


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
