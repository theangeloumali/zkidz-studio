# Created by The Angelo Umali.
# Builds a source with showcase inserts: the raw clip turned upright in TV range, except where he plays a delivered
# edit on his monitor. There the edit's own master (or a still) plays in a rounded panel over its blurred fill.
# Usage (from the work dir): python -m zks_engine.showcase v11 ../raw.mp4   (reads inserts/v11.json, writes sources/v11.mkv)
#   inserts/vN.json = [{"at": 119.3, "end": 134.2, "src": "media/deliverables/07-.../07-...-4k.mp4", "src_at": 1.0}]  (seconds; src repo-relative)
#   A wider-than-tall file plays in the landscape panel ("panel" overrides). An HDR raw is tone-mapped like a joined clip.
#   NVIDIA rounds the panel with libplacebo when the probe found a Vulkan GPU, else with scale_cuda and overlay_cuda (WSL);
#   other hosts may have no Vulkan, so they round it with CPU filters.
import json
import shutil
import subprocess
import sys

from . import backends, ffio
from .backends.graph import BT709_TV, restamp
from .join_sources import NVDEC_CODECS, audio_command, cuda_route, gpu_frames, piece_command, probe, run_all
from .pipeline import (CUDA_DEVICE, CUDA_HWACCEL, CUDA_LANCZOS, CUDA_TV_RANGE, CUDA_UPRIGHT, WORK, assert_upright, chain, decode_args, probe_video, project_input, rotation_of, split_orientation,
                       upright_dims)
from .slots import slot
from .specs.paths import video_id
from .render_final import BT709_TAGS, GPU_SCALE, count_frames, frame_times

SIZE = (2160, 3840)
# x, y, w, h. Portrait: 1080-space x 253-827, y 380-1400, under the label chip at y ~300. Landscape: 1080-space y 500-1076,
# between that chip and the caption plate (y 1270+).
PANELS = {"portrait": (506, 760, 1148, 2040), "landscape": (56, 1000, 2048, 1152)}
BASE_PIECE_FRAMES = 1800
# Two mitchell steps: one 60x downscale overflows libplacebo's polar kernel ("radius exceeds implementation capacity").
FILL = ("libplacebo=w=270:h=480:downscaler=mitchell:format=yuv420p,libplacebo=w=36:h=64:downscaler=mitchell:format=yuv420p,"
        f"libplacebo=w={SIZE[0]}:h={SIZE[1]}:upscaler=bicubic:brightness=-0.25:saturation=0.7:format=yuv420p")
CPU_FILL = f"scale=270:480:flags=bicubic,scale=36:64:flags=bicubic,scale={SIZE[0]}:{SIZE[1]}:flags=bicubic,eq=brightness=-0.25:saturation=0.7"
TO_CUDA = f"format=yuv420p,hwupload,{CUDA_TV_RANGE}"
# FILL on CUDA; eq is per pixel, so grading the 36x64 step on the CPU costs nothing.
CUDA_FILL = ("scale_cuda=270:480:interp_algo=bicubic,scale_cuda=36:64:interp_algo=bicubic,hwdownload,format=yuv420p,eq=brightness=-0.25:saturation=0.7,"
             f"hwupload,scale_cuda={SIZE[0]}:{SIZE[1]}:interp_algo=bicubic:format=yuv420p,{BT709_TV}")
STILL_TO_YUV = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"  # same size; format= alone would use BT.601


def grid(fps):
    return restamp({"fps_num": fps[0], "fps_den": fps[1]})


def plan(inserts, frames, fps):
    """(first, count, insert or None) pieces covering every raw frame; long base runs split so encodes run in parallel."""
    pieces, cursor = [], 0
    for insert in sorted(inserts, key=lambda item: item["at"]):
        first, last = round(insert["at"] * fps[0] / fps[1]), round(insert["end"] * fps[0] / fps[1])
        if first < cursor or last > frames:
            sys.exit(f"insert {insert['at']}-{insert['end']} overlaps another or runs past the clip")
        pieces += base_run(cursor, first) + [(first, last - first, insert)]
        cursor = last
    return pieces + base_run(cursor, frames)


def base_run(first, last):
    count = max(1, round((last - first) / BASE_PIECE_FRAMES))
    bounds = [first + (last - first) * index // count for index in range(count + 1)]
    return [(start, stop - start, None) for start, stop in zip(bounds, bounds[1:]) if stop > start]


def base_command(clip, first, count, out, backend):
    """Upright TV-range 4K frames straight from NVDEC to NVENC (a 1080 raw is scaled on CUDA to match the inserts);
    seeks between real frame times like render_final."""
    times = frame_times(clip.path)
    seek = (times[first - 1] + times[first]) / 2 if first else 0.0
    turn, _ = split_orientation(CUDA_UPRIGHT[clip.rotation])
    graph = chain(turn, CUDA_TV_RANGE, GPU_SCALE.format(*SIZE), grid(clip.fps))
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *decode_args(True), "-ss", f"{seek:.6f}", *ffio.user_input_args(clip.path),
            "-vf", graph, "-frames:v", str(count), "-r", f"{clip.fps[0]}/{clip.fps[1]}", "-fps_mode", "cfr", *backend.mezzanine, "-an", str(out)]


def panel_passes(box):
    """The panel is rounded in its own pass: corner_rounding in the compose pass also rounds the fill, i.e. the frame corners."""
    x, y, w, h = box
    rounded = f"libplacebo=w={w}:h={h}:corner_rounding=0.1:fillcolor=black@0:format=yuva420p"
    compose = (f"libplacebo=inputs=2:w={SIZE[0]}:h={SIZE[1]}:pos_x='if(eq(idx,0),0,{x})':pos_y='if(eq(idx,0),0,{y})'"
               f":pos_w='if(eq(idx,0),{SIZE[0]},{w})':pos_h='if(eq(idx,0),{SIZE[1]},{h})'"
               ":format=yuv420p:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv")
    return rounded, compose


def rounded_mask(box, fps):
    """libplacebo's corner_rounding=0.1 as a mask drawn once and looped: geq on every 4K frame would dominate the encode."""
    _, _, w, h = box
    radius = round(0.1 * min(w, h) / 2)
    outside = f"hypot(max(max({radius}-X,X-(W-1-{radius})),0),max(max({radius}-Y,Y-(H-1-{radius})),0))"
    return f"color=c=black:s={w}x{h}:r={fps[0]}/{fps[1]}:d={fps[1] / fps[0]:.6f},format=gray,geq=lum='255*lte({outside},{radius})',loop=loop=-1:size=1,{grid(fps)}"


def cpu_panel(box, fps):
    x, y, w, h = box
    return (f"[b]scale={w}:{h}:flags=bicubic[pv];{rounded_mask(box, fps)}[mask];[pv][mask]alphamerge[panel];"
            f"[fill][panel]overlay={x}:{y},format=yuv420p,{BT709_TV}")


def cuda_panel(box, fps):
    """Every scale and the blend on CUDA; the alpha merge is a plane copy. overlay_cuda pads a scale_cuda frame's width
    to 2176, so the composite downloads and crops (no pixels move) for NVENC."""
    x, y, w, h = box
    return (f"[a]{TO_CUDA},{CUDA_FILL}[fill];"
            f"[b]{TO_CUDA},{CUDA_LANCZOS.format(w, h)}:format=yuv420p,hwdownload,format=yuv420p[pv];{rounded_mask(box, fps)}[mask];"
            f"[pv][mask]alphamerge,format=yuva420p,hwupload,{BT709_TV}[panel];"
            f"[fill][panel]overlay_cuda=x={x}:y={y},hwdownload,format=yuv420p,crop={SIZE[0]}:{SIZE[1]}:0:0,{BT709_TV}")


def panel_for(size):
    """A file wider than tall plays in the landscape panel."""
    width, height = size
    return "landscape" if width > height else "portrait"


def base_piece(clip, first, count, out, backend):
    """HDR frames need join_sources' tone-map; the CUDA-only seek path would leave HLG washed out. A half turn is a CPU
    filter, so it takes join_sources' piece too."""
    if clip.hdr or clip.rotation == 180 or not gpu_frames(backend, clip.rotation, clip.nvdec):
        return piece_command(clip, first, count, out, backend)
    return base_command(clip, first, count, out, backend)


def insert_command(insert, first, count, out, backend, fps):
    """The file from insert["src_at"], read from the frame-grid time of `first` so it matches insert_audio's exact offset."""
    src = str(project_input(insert["src"]))
    stream = probe_video(src)
    box = PANELS[insert.get("panel") or panel_for(upright_dims(stream))]
    if src.lower().endswith(".png"):
        # Bounded like every looping input (gates.check_looping_inputs); -frames:v below ends the piece on its count.
        source = ["-loop", "1", "-framerate", f"{fps[0]}/{fps[1]}", "-t", f"{count * fps[1] / fps[0]:.6f}", *ffio.user_input_args(src)]
        decode = f"{STILL_TO_YUV}," if cuda_route(backend) else ""
    else:
        seek = insert["src_at"] + first * fps[1] / fps[0] - insert["at"]
        rotation = rotation_of(stream) % 360
        if gpu_frames(backend, rotation, stream.get("codec_name") in NVDEC_CODECS):
            on_gpu, on_cpu = split_orientation(CUDA_UPRIGHT[rotation])
            depth = "p010le" if "10" in stream.get("pix_fmt", "") else "nv12"  # hwdownload cannot convert bit depth
            hardware = [*CUDA_HWACCEL, "-hwaccel_output_format", "cuda"] if cuda_route(backend) else decode_args(True)
            decode = chain(on_gpu, f"hwdownload,format={depth}", on_cpu) + ","
        else:
            hardware, decode = CUDA_HWACCEL if cuda_route(backend) else [*backend.device, *backend.decode], ""  # system frames, autorotated
        source = [*hardware, "-ss", f"{seek:.4f}", *ffio.user_input_args(src)]
    if cuda_route(backend):
        devices, panel = CUDA_DEVICE, cuda_panel(box, fps)
    elif backend.name == "nvidia":
        rounded, compose = panel_passes(box)
        devices, panel = ["-init_hw_device", "vulkan"], f"[a]{FILL}[fill];[b]{rounded}[panel];[fill][panel]{compose}"
    else:
        devices, panel = [], f"[a]{CPU_FILL}[fill];{cpu_panel(box, fps)}"
    graph = f"[0:v]{decode}{grid(fps)},split[a][b];{panel}{backend.upload}[v]"
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *devices, *source, "-filter_complex", graph,
            "-map", "[v]", "-frames:v", str(count), "-r", f"{fps[0]}/{fps[1]}", "-fps_mode", "cfr", *backend.mezzanine, "-an", str(out)]


def main(video, raw, inserts=None):
    """`inserts` in place of reading inserts/<video>.json (the CLI hands them in, translated from the server's file)."""
    clip = probe(raw)
    backend = backends.active()
    jobs = backends.render_jobs(backend)
    if inserts is None:
        inserts = json.loads((WORK / "inserts" / f"{video_id(video)}.json").read_text(encoding="utf-8"))
    target = WORK / "sources" / f"{video}.mkv"
    work = target.with_name(f"{video}-pieces")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    pieces = plan(inserts, clip.frames, clip.fps)
    outputs = [work / f"{index:02d}.mp4" for index in range(len(pieces))]
    commands = [insert_command(insert, first, count, out, backend, clip.fps) if insert else base_piece(clip, first, count, out, backend)
                for (first, count, insert), out in zip(pieces, outputs)]
    commands.append(audio_command([clip], work / "audio.flac"))
    print(f"{len(pieces)} pieces ({len(inserts)} inserts), {jobs} {backend.name} encodes at once", flush=True)
    with slot("gpu", f"showcase {video} ({WORK})"):
        if codes := run_all(commands, jobs):
            sys.exit(f"showcase failed (exit codes {codes}); pieces kept in {work}")
    for (_, count, _), out in zip(pieces, outputs):
        if count_frames(out) != count:
            sys.exit(f"{out.name}: {count_frames(out)} frames, expected {count}")
    listing = work / "pieces.txt"
    listing.write_text(ffio.concat_listing(outputs), encoding="utf-8")
    subprocess.run([ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *ffio.concat_input_args(listing),
                    "-i", str(work / "audio.flac"), "-map", "0:v", "-map", "1:a", "-c", "copy", *BT709_TAGS, str(target)], check=True)
    if count_frames(target) != clip.frames:
        sys.exit(f"{target.name}: {count_frames(target)} frames, expected {clip.frames}")
    assert_upright(target, SIZE)
    shutil.rmtree(work)
    print(f"wrote {target} ({clip.frames} frames)")
    return clip


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
