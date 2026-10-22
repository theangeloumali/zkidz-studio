# Created by The Angelo Umali.
# Builds a source with showcase inserts: the raw clip turned upright in TV range, except where he plays a delivered
# edit on his monitor. There the edit's own master (or a still) plays in a rounded panel over its blurred fill.
# Usage (from the work dir): python -m zks_engine.showcase v11 ../raw.mp4   (reads inserts/v11.json, writes sources/v11.mkv)
#   inserts/vN.json = [{"at": 119.3, "end": 134.2, "src": "media/deliverables/07-.../07-...-4k.mp4", "src_at": 1.0}]  (seconds; src repo-relative)
#   A wider-than-tall file plays in the landscape panel ("panel" overrides). An HDR raw is tone-mapped like a joined clip.
import json
import shutil
import subprocess
import sys

from . import ffio
from .join_sources import ENCODER, audio_command, piece_command, probe, run_all
from .pipeline import (CUDA_TV_RANGE, CUDA_UPRIGHT, FPS, FPS_DEN, FPS_NUM, WORK, assert_upright, chain, decode_args, orientation_filter,
                      probe_video, rotation_of, split_orientation, upright_dims)
from .slots import slot
from .render_final import BT709_TV, BT709_TAGS, RENDER_JOBS, count_frames, frame_times

SIZE = (2160, 3840)
# x, y, w, h. Portrait: 1080-space x 253-827, y 380-1400, under the label chip at y ~300. Landscape: 1080-space y 500-1076,
# between that chip and the caption plate (y 1270+).
PANELS = {"portrait": (506, 760, 1148, 2040), "landscape": (56, 1000, 2048, 1152)}
BASE_PIECE_FRAMES = 1800
RESTAMP = f"setpts=N*{FPS_DEN}/({FPS_NUM}*TB)"
# Two mitchell steps: one 60x downscale overflows libplacebo's polar kernel ("radius exceeds implementation capacity").
FILL = ("libplacebo=w=270:h=480:downscaler=mitchell:format=yuv420p,libplacebo=w=36:h=64:downscaler=mitchell:format=yuv420p,"
        f"libplacebo=w={SIZE[0]}:h={SIZE[1]}:upscaler=bicubic:brightness=-0.25:saturation=0.7:format=yuv420p")


def plan(inserts, frames):
    """(first, count, insert or None) pieces covering every raw frame; long base runs split so encodes run in parallel."""
    pieces, cursor = [], 0
    for insert in sorted(inserts, key=lambda item: item["at"]):
        first, last = round(insert["at"] * FPS), round(insert["end"] * FPS)
        if first < cursor or last > frames:
            sys.exit(f"insert {insert['at']}-{insert['end']} overlaps another or runs past the clip")
        pieces += base_run(cursor, first) + [(first, last - first, insert)]
        cursor = last
    return pieces + base_run(cursor, frames)


def base_run(first, last):
    count = max(1, round((last - first) / BASE_PIECE_FRAMES))
    bounds = [first + (last - first) * index // count for index in range(count + 1)]
    return [(start, stop - start, None) for start, stop in zip(bounds, bounds[1:]) if stop > start]


def base_command(raw, first, count, out):
    """Upright TV-range frames straight from NVDEC to NVENC; seeks between real frame times like render_final."""
    times = frame_times(raw)
    seek = (times[first - 1] + times[first]) / 2 if first else 0.0
    graph = chain(orientation_filter(raw, True), CUDA_TV_RANGE, BT709_TV, RESTAMP)
    return ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *decode_args(True), "-ss", f"{seek:.6f}", "-i", str(raw),
            "-vf", graph, "-frames:v", str(count), "-r", f"{FPS_NUM}/{FPS_DEN}", "-fps_mode", "cfr", *ENCODER, "-an", str(out)]


def panel_passes(box):
    """The panel is rounded in its own pass: corner_rounding in the compose pass also rounds the fill, i.e. the frame corners."""
    x, y, w, h = box
    rounded = f"libplacebo=w={w}:h={h}:corner_rounding=0.1:fillcolor=black@0:format=yuva420p"
    compose = (f"libplacebo=inputs=2:w={SIZE[0]}:h={SIZE[1]}:pos_x='if(eq(idx,0),0,{x})':pos_y='if(eq(idx,0),0,{y})'"
               f":pos_w='if(eq(idx,0),{SIZE[0]},{w})':pos_h='if(eq(idx,0),{SIZE[1]},{h})'"
               ":format=yuv420p:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv")
    return rounded, compose


def panel_for(size):
    """A file wider than tall plays in the landscape panel."""
    width, height = size
    return "landscape" if width > height else "portrait"


def base_piece(clip, first, count, out):
    """HDR frames need join_sources' libplacebo tone-map; the CUDA-only seek path would leave HLG washed out."""
    return piece_command(clip, first, count, out) if clip.hdr else base_command(clip.path, first, count, out)


def insert_command(insert, first, count, out):
    """The file from insert["src_at"], read from the frame-grid time of `first` so it matches insert_audio's exact offset."""
    src = str(WORK.parent / insert["src"])  # repo-relative like a cut spec source; an absolute path still wins
    stream = probe_video(src)
    rounded, compose = panel_passes(PANELS[insert.get("panel") or panel_for(upright_dims(stream))])
    if src.lower().endswith(".png"):
        source, decode = ["-loop", "1", "-framerate", f"{FPS_NUM}/{FPS_DEN}", "-i", src], ""
    else:
        seek = insert["src_at"] + first / FPS - insert["at"]
        source = [*decode_args(True), "-ss", f"{seek:.4f}", "-i", src]
        on_gpu, on_cpu = split_orientation(CUDA_UPRIGHT[rotation_of(stream) % 360])
        depth = "p010le" if "10" in stream.get("pix_fmt", "") else "nv12"  # hwdownload cannot convert bit depth
        decode = chain(on_gpu, f"hwdownload,format={depth}", on_cpu) + ","
    graph = f"[0:v]{decode}{RESTAMP},split[a][b];[a]{FILL}[fill];[b]{rounded}[panel];[fill][panel]{compose}[v]"
    return ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-init_hw_device", "vulkan", *source, "-filter_complex", graph,
            "-map", "[v]", "-frames:v", str(count), "-r", f"{FPS_NUM}/{FPS_DEN}", "-fps_mode", "cfr", *ENCODER, "-an", str(out)]


def main(video, raw):
    clip = probe(raw)
    inserts = json.loads((WORK / "inserts" / f"{video}.json").read_text(encoding="utf-8"))
    target = WORK / "sources" / f"{video}.mkv"
    work = target.with_name(f"{video}-pieces")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    pieces = plan(inserts, clip.frames)
    outputs = [work / f"{index:02d}.mp4" for index in range(len(pieces))]
    commands = [insert_command(insert, first, count, out) if insert else base_piece(clip, first, count, out)
                for (first, count, insert), out in zip(pieces, outputs)]
    commands.append(audio_command([clip], work / "audio.flac"))
    print(f"{len(pieces)} pieces ({len(inserts)} inserts), {RENDER_JOBS} GPU encodes at once", flush=True)
    with slot("gpu", f"showcase {video} ({WORK})"):
        if codes := run_all(commands):
            sys.exit(f"showcase failed (exit codes {codes}); pieces kept in {work}")
    for (_, count, _), out in zip(pieces, outputs):
        if count_frames(out) != count:
            sys.exit(f"{out.name}: {count_frames(out)} frames, expected {count}")
    listing = work / "pieces.txt"
    listing.write_text(ffio.concat_listing(outputs), encoding="utf-8")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *ffio.concat_input_args(listing),
                    "-i", str(work / "audio.flac"), "-map", "0:v", "-map", "1:a", "-c", "copy", *BT709_TAGS, str(target)], check=True)
    if count_frames(target) != clip.frames:
        sys.exit(f"{target.name}: {count_frames(target)} frames, expected {clip.frames}")
    assert_upright(target, SIZE)
    shutil.rmtree(work)
    print(f"wrote {target} ({clip.frames} frames)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
