# Created by The Angelo Umali.
# Composites one edit: the source cut by the EDL, privacy blur, punch-ins, overlays and the edited audio, on the GPU.
# Usage: python -m zks_engine.render_final v1 [--draft | --4k]   (--4k: sharpened 2160x3840 HEVC)
# Frames are selected by index n and restamped onto the overlay PNGs' grid; the punch-in is two fixed branches switched
# by overlay enable, since scale eval=frame + crop is not pixel-safe. Upright footage on NVIDIA composites on CUDA/OpenCL;
# everything else runs the backend's CPU-filter graph (backends/graph.py) between its decode and its encoder. Zooms,
# reframes, focus and the matte run on libplacebo when a Vulkan GPU exists, else on CPU filters between NVDEC and NVENC.
import functools
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import NamedTuple

from . import backends, ffio
from .backends import graph as backend_graph
from .backends.graph import BT709_TV, CPU_CRISP, MASK_GRAY, UHD, animation_layer, edit_ranges, grade_of, overlay_tail, restamp, three_planes
from .backends.graph import GRADES  # noqa: F401 - re-exported: the card clips grade by render_final.GRADES / grade_of
from .backends.profile import Backend
from .blur import blur_graph, blur_regions, gpu_blur_graph, output_regions, overlap, ranges_expr
from .edl import FACECAM_ZOOM, PUNCH_TOP
from . import progress
from .slots import slot
from .specs import SpecError, gates
from .pipeline import (AUDIO_RATE, CUDA_LANCZOS, CUDA_TV_RANGE, CUDA_UPRIGHT, DROP_ROTATION, OUTPUT, WORK, assert_upright, chain, decode_args, frame_to_sample,
                       intro_track, load_cuts, load_edl, probe_video, rotation_of, source_path, spec_file, split_orientation, upright_dims)

# BT709_TV tags overlay_cuda's inputs alike; otherwise ffmpeg 9 inserts a CPU converter on a CUDA link and fails.
GPU_SCALE = CUDA_LANCZOS + ":format=yuv420p," + BT709_TV  # reads the TV-range frames decode hands on
# Footage only (the animation layer goes on after): fine detail, then a wide low-strength clarity pass; no halos at 2x zoom.
CRISP = "unsharp_opencl=lx=5:ly=5:la=0.6,unsharp_opencl=lx=17:ly=17:la=0.18"
# Named by platform: OpenCL device 0 can be the Intel iGPU.
OPENCL_DEVICE = ["-init_hw_device", "opencl=ocl:,platform_name=NVIDIA CUDA", "-filter_hw_device", "ocl"]


def punch_frame(width=OUTPUT[0], height=OUTPUT[1]):
    """The 1.08x frame the GPU punch-in reads from, and where the output window sits inside it (same framing as PUNCH_CROP)."""
    big_w, big_h = round(width * FACECAM_ZOOM / 2) * 2, round(height * FACECAM_ZOOM / 2) * 2
    return big_w, big_h, (big_w - width) // 2, round(big_h * PUNCH_TOP)


def gpu_scale_png(size, pix_fmt):
    """RGBA PNGs to BT.709 TV-range frames at `size`, scaled by libplacebo on the GPU."""
    return (f"format=rgba,libplacebo=w={size[0]}:h={size[1]}:upscaler=ewa_lanczos:format={pix_fmt}:colorspace=bt709:range=tv:"
            "color_primaries=bt709:color_trc=bt709")


def overlay_upload(size):
    """The 1080p animation layer on the OpenCL device; for 4K, libplacebo upscales it on the GPU first."""
    if size == OUTPUT:
        return "scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,hwupload"
    return f"{gpu_scale_png(size, 'yuva420p')},hwupload"


# Zoom curves per preset, k frames into an n-frame window. scale_expr writes the same curves in ffmpeg's expression language.
ZOOM_CURVES = {
    "snap": ("1+0.3*(1-exp(-{k}/1.2))", lambda k, n: 1 + 0.3 * (1 - math.exp(-k / 1.2))),  # 1.3x in 5 frames, then holds
    "push": ("1+0.06*(1-cos(PI*min({k}/{n1},1)))", lambda k, n: 1 + 0.06 * (1 - math.cos(math.pi * min(k / max(n - 1, 1), 1)))),
    "reveal": ("1.6-0.3*(1-cos(PI*min({k}/36,1)))", lambda k, n: 1.6 - 0.3 * (1 - math.cos(math.pi * min(k / 36, 1)))),
    "through-out": ("1+0.2*pow(max({k}-{n}+6,0)/5,3)", lambda k, n: 1 + 0.2 * (max(k - n + 6, 0) / 5) ** 3),
    "through-in": ("1+0.25*exp(-{k}/3)", lambda k, n: 1 + 0.25 * math.exp(-k / 3)),
    # Accelerates into the screen until it fills the frame (`to`), where the cut to its insert lands.
    "portal": ("1+({to}-1)*pow(min({k}/{n1},1),3)", lambda k, n, to=2.0: 1 + (to - 1) * min(k / max(n - 1, 1), 1) ** 3),
    "lean": ("1+0.025*(1-cos(PI*min({k}/{n1},1)))", lambda k, n: 1 + 0.025 * (1 - math.cos(math.pi * min(k / max(n - 1, 1), 1)))),
}


def zoom_factor(preset, k, n, item=None):
    curve = ZOOM_CURVES[preset][1]
    return curve(k, n, item["to"]) if preset == "portal" else curve(k, n)


def frame_expr(edl):
    """The chunk's edited frame index from t, the variable libplacebo has."""
    return f"(t*{edl['fps_num'] / edl['fps_den']:.10f})"


def gate(frame, start, end):
    return f"gte({frame},{start - 0.5})*lt({frame},{end - 0.5})"


def scale_expr(edl, frame=None):
    """Per-frame footage scale (frame: an expression of the edited frame index): the 1.08x punch-in times every zoom window."""
    frame = frame or frame_expr(edl)
    inside = functools.partial(gate, frame)
    _, punched = edit_ranges(edl)
    punch = "".join(f"+{FACECAM_ZOOM - 1:g}*{inside(a, b)}" for a, b in punched)
    zoom = ""
    for item in edl.get("zooms", []):
        n = item["end"] - item["start"]
        # k clamps at 0: before its window a curve's exp() would overflow, and inf times the 0 gate is NaN (a libplacebo crash).
        curve = ZOOM_CURVES[item["preset"]][0].format(k=f"max({frame}-{item['start']},0)", n=n, n1=max(n - 1, 1), to=item.get("to", 1))
        zoom += f"+({curve}-1)*{inside(item['start'], item['end'])}"
    return f"(1{punch})*(1{zoom})"


def gated(items, key, default, frame):
    """`key` of the window covering `frame`, `default` outside every window."""
    return f"({default:g}" + "".join(f"+{item[key] - default:.6f}*{gate(frame, item['start'], item['end'])}"
                                       for item in items if item[key] != default) + ")"


def centre_expr(edl, axis, default, frame=None):
    """The crop centre (fraction of the frame) on one axis: each zoom window's own, the punch-in framing elsewhere."""
    return gated(edl.get("zooms", []), axis, default, frame or frame_expr(edl))


def crop_window(edl, frame=None):
    """(x, y, w, h) per frame as fractions of the source frame: the reframe's crop (edl["crops"], else the whole
    letterboxed frame) with the punch-in and every zoom scaled inside it."""
    frame = frame or frame_expr(edl)
    crops = edl.get("crops", [])
    rx, ry, rw, rh = (gated(crops, key, default, frame) for key, default in (("x", 0), ("y", 0), ("w", 1), ("h", 1)))
    scale = scale_expr(edl, frame)
    cx, cy = centre_expr(edl, "cx", 0.5, frame), centre_expr(edl, "cy", PUNCH_TOP + 0.5 / FACECAM_ZOOM, frame)
    w, h = f"{rw}/({scale})", f"{rh}/({scale})"
    # With nothing zoomed rx+rw-w rounds a hair under rx, and ffmpeg's clip() is NaN when its max is below its min.
    return (f"clip({rx}+{cx}*{rw}-{w}/2,{rx},max({rx},{rx}+{rw}-{w}))", f"clip({ry}+{cy}*{rh}-{h}/2,{ry},max({ry},{ry}+{rh}-{h}))", w, h)


def zoom_crop(edl, size):
    """libplacebo crops and scales each frame on Vulkan; the expressions are evaluated per frame (measured on a 4K HLG
    clip: a 1.0x to 1.3x snap in 5 frames, frame-exact)."""
    x, y, w, h = crop_window(edl)
    return (f"libplacebo=w={size[0]}:h={size[1]}:crop_w='iw*{w}':crop_h='ih*{h}':crop_x='iw*{x}':crop_y='ih*{y}'"
            ":upscaler=ewa_lanczos:downscaler=ewa_lanczos:format=yuv420p:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv")


def perspective_crop(edl, size):
    """crop_window on CPU filters: perspective maps the window's corners onto the frame per frame (crop cannot animate
    its size), then one scale to the output. `in` counts from 1."""
    x, y, w, h = crop_window(edl, "(in-1)")
    corners = {"x0": f"W*{x}", "y0": f"H*{y}", "x1": f"W*({x}+{w})", "y1": f"H*{y}",
               "x2": f"W*{x}", "y2": f"H*({y}+{h})", "x3": f"W*({x}+{w})", "y3": f"H*({y}+{h})"}
    return ("perspective=" + ":".join(f"{name}='{value}'" for name, value in corners.items())
            + f":interpolation=cubic:eval=frame,scale={size[0]}:{size[1]}:flags=lanczos")


def has_motion(edl):
    """Anything only the zoom graphs composite: zooms, reframe crops, rack focus, the matte and the bystander blur."""
    return any(edl.get(key) for key in ("zooms", "crops", "focus", "matte", "faces"))


def device_args(edl):
    """The OpenCL device every composite uses, plus a Vulkan one for libplacebo when the edit zooms or reframes."""
    return (["-init_hw_device", "vulkan=vk"] if edl.get("zooms") or edl.get("crops") else []) + OPENCL_DEVICE


FOCUS_EASE = 0.3  # seconds the rack focus takes to pull in and to let go


def focus_weight_expr(windows, rate):
    """0..1 per frame (t from the chunk's first frame): 1 inside each focus window, cosine-eased over FOCUS_EASE at both
    ends. A chunk cut inside a window eases from the whole window's edges (`rise`/`fall`), not its own first frame."""
    frame, ease = f"(t*{rate:.10f})", FOCUS_EASE * rate
    ramp = lambda edge: f"(0.5-0.5*cos(PI*min(max(({edge})/{ease:.6f},0),1)))"  # noqa: E731
    return "+".join(f"{ramp(f'{frame}-({w.get("rise", w["start"])})')}*{ramp(f'{w.get("fall", w["end"])}-{frame}')}" for w in windows)


def check_focus(edl):
    """A focus window blurs outside his mask, which matte.py writes only over matte windows."""
    for window in edl.get("focus", []):
        if not any(m["start"] <= window["start"] and window["end"] <= m["end"] for m in edl.get("matte", [])):
            sys.exit(f"focus {window['start']}-{window['end']} (edited frames) is outside every matte window; add matteRanges over it")


def focus_graph(edl, footage, mask, size, opencl=True):
    """Rack focus: `footage` (a chain) with the room blurred outside his mask (`mask`, a full-range gray label) per
    strength, on the OpenCL device or the CPU; the eased weight scales the inverted mask per frame (eq), and each merge
    runs only inside its windows."""
    rate = edl["fps_num"] / edl["fps_den"]
    strengths = list(dict.fromkeys(window["blur"] for window in edl["focus"]))
    labels = lambda prefix: "".join(f"[{prefix}{i}]" for i in range(len(strengths)))  # noqa: E731
    graph = (f"{footage},split=2[f_sharp][f_src];[f_src]{'hwupload,' if opencl else ''}split={len(strengths)}{labels('f_up')};"
             f"{mask}split={len(strengths)}{labels('f_m')};")
    blur, download = ("boxblur_opencl", ",hwdownload,format=yuv420p") if opencl else ("boxblur", "")
    base = "f_sharp"
    for index, strength in enumerate(strengths):
        radius = max(1, round(strength * size[0] / OUTPUT[0]))
        windows = [w for w in edl["focus"] if w["blur"] == strength]
        weight = focus_weight_expr(windows, rate)
        active = "+".join(f"between(t,{(w['start'] - 0.5) / rate:.6f},{(w['end'] - 0.5) / rate:.6f})" for w in windows)
        graph += (f"[f_up{index}]{blur}=lr={radius}:lp=2:cr={max(1, radius // 2)}:cp=2{download}[f_soft{index}];"
                  f"[f_m{index}]negate,eq=eval=frame:contrast='{weight}':brightness='({weight}-1)*128/255',{three_planes(f'f_w{index}')}[f_w{index}];"
                  f"[{base}][f_soft{index}][f_w{index}]maskedmerge=enable='{active}'")
        base = f"f_room{index}"
        if index < len(strengths) - 1:
            graph += f"[{base}];"
    return graph


FACE_GRID = (12, 21)  # the face is rebuilt from the frame at this size: one block (~90 px of 1080) per reframed face


def faces_graph(footage, mask, size):
    """The bystander blur (#44): `footage` (a chain) replaced by its FACE_GRID copy scaled back up wherever `mask`
    (face_mask.py, TV-range luma, cropped like the footage) marks a face that is not the creator's; the mask's edge is
    feathered so the patch reads as frosted glass, not a disc."""
    feather = max(2, round(size[0] / 120))
    return (f"{footage},split[fb_sharp][fb_src];"
            f"[fb_src]scale={FACE_GRID[0]}:{FACE_GRID[1]}:flags=area,scale={size[0]}:{size[1]}:flags=bicubic[fb_soft];"
            f"{mask},{MASK_GRAY},gblur=sigma={feather},{three_planes('fb_mask')}[fb_mask];[fb_sharp][fb_soft][fb_mask]maskedmerge")


def matte_graph(edl, footage, mask, behind, size, opencl):
    """The behind layer over the footage, then the footage back wherever the matte says he is; focus blurs the room
    first. `mask` is the TV-range luma mask (matte.py) with the footage's exact crop."""
    matte_mask = f"{mask},{MASK_GRAY},{three_planes('mask')}"
    if edl.get("focus"):
        footage = f"{mask},{MASK_GRAY},split=2[mask_a][mask_b];" + focus_graph(edl, footage, "[mask_b]", size, opencl)
        matte_mask = f"[mask_a]{three_planes('mask')}"
    return (f"{footage},split[near][far];[2:v]{behind}[behind];[far][behind]overlay=format=yuv420[backed];"
            f"{matte_mask}[mask];[backed][near][mask]maskedmerge")


def cpu_motion_graph(edl, backend, size, regions=(), first_frame=0, captions=None):
    """zoom_graph on CPU filters, for NVIDIA without OpenCL or libplacebo: NVDEC's system frames are selected, cropped
    per frame (perspective_crop), focused, matted and graded, then go to the encoder like the CPU composite. Blur boxes
    are on the output grid, so they veil the cropped picture; one over an animated zoom would not follow it."""
    zoom_windows = [(zoom["start"], zoom["end"]) for zoom in edl.get("zooms", [])]
    if any(overlap(ranges, zoom_windows) for *_, ranges in regions):
        sys.exit("a blur box over an animated zoom would not follow the moving crop; move its span off the zoom or drop the zoom")
    check_focus(edl)
    keep, _ = edit_ranges(edl, first_frame)
    select = chain(f"select='{ranges_expr(keep)}'", restamp(edl), "format=yuv420p")
    crop = perspective_crop(edl, size)
    footage = f"[0:v]{chain(select, DROP_ROTATION, crop)}"
    if edl.get("faces"):
        footage = faces_graph(footage, f"[{edl['faces_input']}:v]{select},{crop}", size)
    if edl.get("matte"):
        behind = f"scale={size[0]}:{size[1]}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuva420p"
        footage = matte_graph(edl, footage, f"[3:v]{select},{crop}", behind, size, opencl=False)
    graded = f"{footage},{chain(grade_of(edl), CPU_CRISP if size == UHD else '')}"
    if not regions:
        return f"{graded}[base];" + overlay_tail(backend, size, captions)
    veil, veiled = blur_graph(regions, "graded", size)
    return f"{graded}[graded];{veil}[{veiled}]null[base];" + overlay_tail(backend, size, captions)


def zoom_graph(edl, gpu_turn, regions, size, finish, first_frame, captions=None):
    """An edit with animated zooms: the footage leaves CUDA once, libplacebo applies the reframe, punch-in and every zoom."""
    zoom_windows = [(zoom["start"], zoom["end"]) for zoom in edl.get("zooms", [])]
    if any(overlap(ranges, zoom_windows) for *_, ranges in regions):
        sys.exit("a blur box over an animated zoom would not follow the moving crop; move its span off the zoom or drop the zoom")
    check_focus(edl)
    keep, _ = edit_ranges(edl, first_frame)
    select = chain(f"select='{ranges_expr(keep)}'", restamp(edl))
    footage = f"[0:v]{chain(select, gpu_turn, CUDA_TV_RANGE)},hwdownload,format=nv12,{zoom_crop(edl, size)}"
    if edl.get("faces"):
        footage = faces_graph(footage, f"[{edl['faces_input']}:v]{select},format=yuv420p,{zoom_crop(edl, size)}", size)
    if edl.get("matte"):
        footage = matte_graph(edl, footage, f"[3:v]{select},{zoom_crop(edl, size)}", gpu_scale_png(size, "yuva420p"), size, opencl=True)
    graded = f"{footage},{chain(DROP_ROTATION, grade_of(edl))}"
    if regions:  # on the output grid, so they veil the cropped picture, as on the CPU route
        veil, veiled = blur_graph(regions, "zoomed", size)
        graded = f"{graded}[zoomed];{veil}[{veiled}]null"
    return (
        f"{graded},{chain('hwupload', finish)}[graded];"
        f"{animation_layer(captions)}{overlay_upload(size)}[ovl];"
        f"[graded][ovl]overlay_opencl,hwdownload,format=yuv420p,{BT709_TV}[v]"
    )


def matte_inputs(piece, first, behind_dir, mask, seek):
    """The behind layer's PNGs (on the overlay's frame grid), or a clear layer when only focus uses the matte, and the
    source-space mask (seeked like the footage)."""
    rate = f"{piece['fps_num']}/{piece['fps_den']}"
    behind = png_input(piece, first, behind_dir) if behind_dir.is_dir() else ["-f", "lavfi", "-i", f"color=c=black@0:s={OUTPUT[0]}x{OUTPUT[1]}:r={rate},format=rgba"]
    return [*behind, "-ss", f"{seek:.6f}", "-i", str(mask)]


def gpu_graph(edl, gpu_turn, regions=(), size=OUTPUT, finish="", first_frame=0, captions=None):
    """CUDA decodes, turns and scales: straight to the output and, for the punch-in, to 1.08x, whose window an overlay_cuda
    at a negative offset lays over the frame (both inputs share the decoder's context). After the CPU grade, finish (OpenCL
    filters), the blur veil and the animation layer composite on the one OpenCL device, whose uploads complete in order;
    a hwupload_cuda context raced overlay_cuda and composited random frames half-uploaded (QC r5).
    first_frame: the source frame a chunk's seeked input starts at, which select counts from."""
    if has_motion(edl):
        return zoom_graph(edl, gpu_turn, regions, size, finish, first_frame, captions)
    keep, punched = edit_ranges(edl, first_frame)
    big_w, big_h, left, top = punch = punch_frame(*size)
    placed = output_regions(regions, punched, punch, size)
    decode = chain(f"select='{ranges_expr(keep)}'", restamp(edl), gpu_turn, CUDA_TV_RANGE)
    return (
        f"[0:v]{decode},split[wide_src][big_src];"
        f"[wide_src]{GPU_SCALE.format(*size)}[wide];"
        f"[big_src]{GPU_SCALE.format(big_w, big_h)}[big];"
        f"[wide][big]overlay_cuda=x={-left}:y={-top}:enable='{ranges_expr(punched) if punched else 0}'"
        + (",split[framed][soften];" + gpu_blur_graph(placed, "soften", grade_of(edl), size) if placed else "[framed];")
        + f"{animation_layer(captions)}{overlay_upload(size)}[ovl];"
        # Without DROP_ROTATION the source's display matrix rides along and the muxer tags the upright frame as rotated.
        + f"[framed]hwdownload,format=yuv420p,{chain(DROP_ROTATION, grade_of(edl))},{chain('hwupload', finish)}[graded];"
        + ("[graded][veil]overlay_opencl[blurred];" if placed else "")
        + f"[{'blurred' if placed else 'graded'}][ovl]overlay_opencl,hwdownload,format=yuv420p,{BT709_TV}[v]"
    )


def soundtrack(video):
    """The SFX mix when it is newer than everything it was built from; the plain edit when the video has no SFX."""
    edit, mix, events = WORK / "audio" / f"{video}_edit.wav", WORK / "audio" / f"{video}_mix.wav", WORK / "edl" / f"{video}.sfx.json"
    if not events.exists():
        return edit
    if mix.exists() and mix.stat().st_mtime > max(edit.stat().st_mtime, events.stat().st_mtime):
        return mix
    sys.exit(f"{video}: {mix.name} is missing or older than {edit.name} / {events.name}; re-run sfx.py {video}")


class Route(NamedTuple):
    backend: Backend
    on_gpu: bool  # nvidia's CUDA/OpenCL composite; otherwise the backend's CPU-filter graph
    gpu_turn: str  # transpose_cuda for a quarter-turned source on the CUDA composite
    frame_size: tuple  # the upright source, where blur boxes are placed off the CUDA path


@functools.cache
def has_filter(name):
    listing = subprocess.run([ffio.ffmpeg_bin(), "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return re.search(rf"^\s*\S+\s+{re.escape(name)}\s", listing, re.M) is not None


def route_for(source, backend):
    """Off the CUDA composite, decode hands back system frames and autorotate turns them: the pinned ffmpeg n8.1 has no
    transpose_cuda, and a half turn never had a CUDA filter."""
    stream = probe_video(source)
    gpu_turn, cpu_turn = split_orientation(CUDA_UPRIGHT[rotation_of(stream) % 360])
    on_gpu = backend.name == "nvidia" and not cpu_turn and (not gpu_turn or has_filter("transpose_cuda")) and has_opencl()
    return Route(backend, on_gpu, gpu_turn if on_gpu else "", upright_dims(stream))


MIN_CHUNK_FRAMES = 900  # 30 s: a shorter chunk spends much of its time starting up
BT709_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
# Below-normal priority: the PNG decode and grade still use the CPU, and the desktop must stay responsive.
LOW_PRIORITY = {"creationflags": subprocess.BELOW_NORMAL_PRIORITY_CLASS} if sys.platform == "win32" else {}


def edl_slice(edl, first, last):
    """Output frames [first, last) as their own edit: segments trimmed, targets from 0, source frames unchanged."""
    segments = []
    for seg in edl["segments"]:
        start, stop = max(first, seg["target"]), min(last, seg["target"] + seg["out"] - seg["in"])
        if stop > start:
            source_in = seg["in"] + start - seg["target"]
            segments.append({**seg, "in": source_in, "out": source_in + stop - start, "target": start - first})
    def within(items, eased=False):
        # An eased window keeps its true edges (rise/fall) so a chunk cut inside it does not ease in again.
        edges = lambda item: {"rise": item.get("rise", item["start"]) - first, "fall": item.get("fall", item["end"]) - first} if eased else {}  # noqa: E731
        return [{**item, "start": max(item["start"], first) - first, "end": min(item["end"], last) - first, **edges(item)}
                for item in items if item["end"] > first and item["start"] < last]

    return {**edl, "segments": segments, "frames": last - first, "zooms": within(edl.get("zooms", [])), "matte": within(edl.get("matte", [])),
            "crops": within(edl.get("crops", [])), "focus": within(edl.get("focus", []), eased=True)}


def chunk_bounds(frames, jobs):
    count = max(1, min(jobs, frames // MIN_CHUNK_FRAMES))
    return [(frames * index // count, frames * (index + 1) // count) for index in range(count)]


def intro_bounds(frames, at, jobs):
    """The edit's chunks before the brand intro's insert and after it, sharing `jobs` by length."""
    before = chunk_bounds(at, min(jobs - 1, max(1, round(jobs * at / frames))))
    after = chunk_bounds(frames - at, jobs - len(before))
    return before, [(first + at, last + at) for first, last in after]


@functools.cache
def frame_times(source):
    """Presentation times (s) of every video frame, from the packet table: no decode."""
    result = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts,pts_time", "-of", "csv=p=0",
                             *ffio.user_input_args(source)], capture_output=True, text=True, check=True)
    return sorted(float(line.split(",")[1]) for line in result.stdout.split() if "," in line and "N/A" not in line)


def chunk_command(piece, first, spec, source, route, size, encoder, frames_dir, out):
    """One chunk, its input seeked between its first kept frame and the one before: accurate seek makes that frame n=0.
    Real frame times, not index x 1001: an Insta360 clip's timestamps shifted half a frame mid-file and the grid seek
    landed a frame late. -frames:v ends it on time: overlay_opencl repeats the footage's last frame past its end."""
    first_source = piece["segments"][0]["in"]

    def seek_of(path):
        times = frame_times(path)
        return (times[first_source - 1] + times[first_source]) / 2 if first_source else 0.0

    seek = seek_of(source)
    captions_dir = frames_dir.with_name(frames_dir.name + ".cc")
    captions = (4 if piece.get("matte") else 2) if captions_dir.is_dir() else None
    if piece.get("faces"):  # the bystander mask comes after every other input
        piece = {**piece, "faces_input": (4 if piece.get("matte") else 2) + (1 if captions else 0)}
    if route.on_gpu and (route.backend.libplacebo or not has_motion(piece)):
        graph = gpu_graph(piece, route.gpu_turn, blur_regions(spec, piece, size), size, CRISP if size == UHD else "", first_source, captions)
        hardware = [*device_args(piece), *decode_args(True)]
    elif has_motion(piece):
        graph = cpu_motion_graph(piece, route.backend, size, blur_regions(spec, piece, size), first_source, captions)
        hardware = [*route.backend.device, *route.backend.decode]
    else:
        regions = blur_regions(spec, piece, route.frame_size)
        graph = backend_graph.composite(route.backend, piece, regions, route.frame_size, size, first_source, captions)
        hardware = [*route.backend.device, *route.backend.decode]
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *hardware, "-ss", f"{seek:.6f}", *ffio.user_input_args(source),
            *png_input(piece, first, frames_dir),
            *(matte_inputs(piece, first, frames_dir.with_name(frames_dir.name + ".behind"), WORK / "mask" / f"{piece['base']}.mkv", seek_of(WORK / "mask" / f"{piece['base']}.mkv"))
              if piece.get("matte") else []),
            *(png_input(piece, first, captions_dir) if captions else []),
            # The mask's own timestamps drift from the source's (27 ms by frame 74 424): seeked on the source's, it ran a frame late.
            *(["-ss", f"{seek_of(WORK / piece['faces']):.6f}", "-i", str(WORK / piece["faces"])] if piece.get("faces") else []),
            "-filter_complex", graph, "-map", "[v]", "-frames:v", str(piece["frames"]),
            "-fps_mode", "passthrough", *encoder, *BT709_TAGS, "-an", "-progress", str(out.with_suffix(".progress")), str(out)]


def png_input(edl, first, frames_dir):
    """An overlay PNG sequence on the edited-frame grid, its first file frame `first`."""
    return ["-thread_queue_size", "512", "-framerate", f"{edl['fps_num']}/{edl['fps_den']}", "-start_number", str(first),
            "-i", str(frames_dir / "%05d.png")]


def frames_written(report):
    """The last frame count in an ffmpeg -progress file (0 before its first block)."""
    return ffio.last_progress_value(report, "frame")


def count_frames(path):
    result = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets",
                             "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return int(json.loads(result.stdout)["streams"][0]["nb_read_packets"])


def intro_command(intro, edl, size, encoder, out, route):
    """The brand pre-roll as a chunk of its own, scaled and encoded exactly like the edit's chunks so the stream-copy join
    takes it."""
    scale, device = (gpu_scale_png(size, "yuv420p"), []) if route.on_gpu else (backend_graph.intro_filter(route.backend, size), route.backend.device)
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *device, "-framerate", f"{edl['fps_num']}/{edl['fps_den']}", "-start_number", "0",
            "-i", str(intro["frames_dir"] / "%05d.png"), "-vf", scale, "-frames:v", str(intro["frames"]),
            "-fps_mode", "passthrough", *encoder, *BT709_TAGS, "-an", "-progress", str(out.with_suffix(".progress")), str(out)]


def join_command(listing, audio_path, encoder, part, intro_audio=None, at_sample=None):
    """The chunks joined by stream copy (no re-encode) and muxed with the soundtrack. A pre-roll's track is spliced into it
    at `at_sample` as PCM, so the one AAC encode has no seam; 10 ms fades either side keep the cut from clicking."""
    tag = encoder[encoder.index("-tag:v"):][:2] if "-tag:v" in encoder else []
    if intro_audio:
        fade = AUDIO_RATE // 100
        graph = (f"[2:a]asplit[m0][m1];[m0]atrim=end_sample={at_sample},afade=t=out:start_sample={at_sample - fade}:nb_samples={fade}[a0];"
                 f"[m1]atrim=start_sample={at_sample},asetpts=PTS-STARTPTS,afade=t=in:nb_samples={fade}[a1];[a0][1:a][a1]concat=n=3:v=0:a=1[a]")
        sound = ["-i", str(intro_audio), "-i", str(audio_path), "-map", "0:v", "-filter_complex", graph, "-map", "[a]"]
    else:
        sound = ["-i", str(audio_path), "-map", "0:v", "-map", "1:a"]
    return [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", *ffio.concat_input_args(listing), *sound,
            "-c:v", "copy", *tag, *BT709_TAGS, "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", str(part)]


def graph_from_file(command, path):
    """The command's -filter_complex read from `path` (ffmpeg's -/option form): Linux refuses any one argument over
    128 KiB, and a long edit's per-frame crop expressions pass that."""
    if "-filter_complex" not in command:
        return command
    at = command.index("-filter_complex")
    path.write_text(command[at + 1], encoding="utf-8")
    return [*command[:at], "-/filter_complex", str(path), *command[at + 2:]]


def run_chunks(commands, logs, report_progress):
    """Every chunk at once, each one's ffmpeg errors in its log; a failure names the first failed chunk's last line."""
    running = []
    for command, log in zip(commands, logs):
        with open(log, "w", encoding="utf-8") as handle:
            running.append(subprocess.Popen(graph_from_file(command, log.with_suffix(".graph")), stderr=handle, **LOW_PRIORITY))
    while any(job.poll() is None for job in running):
        report_progress()
        time.sleep(2)
    if failed := [(job.returncode, log) for job, log in zip(running, logs) if job.returncode]:
        lines = [line for line in failed[0][1].read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
        # The first error is the cause; ffmpeg's last line ("nothing was written") is its consequence.
        cause = next((line for line in lines if re.search(r"error|invalid|no such|unable|failed", line, re.I)), lines[-1] if lines else "ffmpeg wrote no error")
        sys.exit(f"chunk render failed (exit codes {[code for code, _ in failed]}): {cause}; "
                 f"chunks kept in {failed[0][1].parent}")


def render_chunks(edl, spec, source, route, size, encoder, frames_dir, audio_path, part, intro=None, report=None):
    """The backend's RENDER_JOBS chunks rendered at once (a brand pre-roll as one more, at its insert), joined and muxed
    with the audio."""
    chunk_dir = part.with_name(f"{part.stem}-chunks")
    shutil.rmtree(chunk_dir, ignore_errors=True)
    chunk_dir.mkdir()
    jobs = backends.render_jobs(route.backend)
    before, after = intro_bounds(edl["frames"], intro["at"], jobs) if intro else (chunk_bounds(edl["frames"], jobs), [])
    chunks, commands = [], []  # (output, frames), joined in this order
    for index, (first, last) in enumerate(before + after):
        if intro and index == len(before):
            chunks.append((chunk_dir / "intro.mp4", intro["frames"]))
            commands.append(intro_command(intro, edl, size, encoder, chunks[-1][0], route))
        chunks.append((chunk_dir / f"{index:02d}.mp4", last - first))
        commands.append(chunk_command(edl_slice(edl, first, last), first, spec, source, route, size, encoder, frames_dir, chunks[-1][0]))
    for command in commands:
        gates.check_command(command)
    print(f"rendering {len(before + after)} chunks at once on {route.backend.name}{' + the brand intro' if intro else ''}", flush=True)
    progress_of = lambda: report and report(sum(frames_written(out.with_suffix(".progress")) for out, _ in chunks))  # noqa: E731
    run_chunks(commands, [out.with_suffix(".log") for out, _ in chunks], progress_of)
    for out, count in chunks:
        if count_frames(out) != count:
            sys.exit(f"{out.name}: {count_frames(out)} frames, expected {count}")
    listing = chunk_dir / "chunks.txt"
    listing.write_text(ffio.concat_listing(out for out, _ in chunks), encoding="utf-8")
    splice = (intro["audio"], frame_to_sample(intro["at"], edl)) if intro else ()
    join = join_command(listing, audio_path, encoder, part, *splice)
    gates.check_command(join)
    subprocess.run(join, check=True)
    total = sum(count for _, count in chunks)
    if count_frames(part) != total:
        sys.exit(f"{part.name}: {count_frames(part)} frames after the join, expected {total}")
    shutil.rmtree(chunk_dir)


def parse_flags(flags):
    draft, uhd = "--draft" in flags, "--4k" in flags
    if draft and uhd:
        sys.exit("--draft and --4k are exclusive: --4k always runs the full-quality encode")
    return draft, uhd


PNG_RGBA = 6  # IHDR colour type


def png_header(path):
    """(width, height, colour type) from a PNG's IHDR chunk, without decoding the image."""
    with open(path, "rb") as png:
        head = png.read(26)
    return (*struct.unpack(">II", head[16:24]), head[25])


def check_overlay_frames(frames_dir, frames):
    """One 1080x1920 RGBA PNG per edited frame, or why not: a kit change once rendered the overlays 1920x1080 (review r6),
    and an opaque frame saved as RGB changes the PNG input's format mid-chunk, which crashed overlay_cuda."""
    pngs = sorted(frames_dir.glob("*.png"))
    if len(pngs) != frames:
        return f"{len(pngs)} overlay PNGs but the edit has {frames} frames; re-run hf/render.js"
    if pngs and (size := png_header(pngs[0])[:2]) != OUTPUT:
        return f"overlay PNGs are {'x'.join(map(str, size))}, not 1080x1920; re-run hf/render.js"
    if flat := next((png for png in pngs if png_header(png)[2] != PNG_RGBA), None):
        return f"{flat.name} is not RGBA (an opaque frame saved without alpha); re-run the overlay render"
    return None


def track_fits(path, frames, edl):
    with wave.open(str(path)) as track:
        return track.getnframes() == frame_to_sample(frames, edl)


def intro_of(video, edl):
    """The brand pre-roll hf/build.js declared in edl/<v>.sfx.json, checked against its frames and track; None without one."""
    events = WORK / "edl" / f"{video}.sfx.json"
    intro = json.loads(events.read_text(encoding="utf-8")).get("intro") if events.exists() else None
    if not intro:
        return None
    if not isinstance(intro.get("at"), int):
        sys.exit(f"{video}: the brand intro has no insert point in {events.name}; re-run sfx.py {video}")
    drawn = WORK / "frames" / f"{video}.insert.json"
    if not drawn.exists() or json.loads(drawn.read_text(encoding="utf-8"))["at"] != intro["at"]:
        sys.exit(f"{video}: the overlay frames were not drawn for the brand intro at frame {intro['at']}; re-run hf/render.js")
    frames_dir, track = WORK / "frames" / f"{video}.intro", intro_track(video)
    if problem := check_overlay_frames(frames_dir, intro["frames"]):
        sys.exit(f"{video}: brand intro: {problem}")
    if not track.exists() or track.stat().st_mtime < events.stat().st_mtime:
        sys.exit(f"{video}: {track.name} is missing or older than {events.name}; re-run sfx.py {video}")
    if not track_fits(track, intro["frames"], edl):
        sys.exit(f"{video}: {track.name} does not match the intro's {intro['frames']} frames; re-run sfx.py {video}")
    return {"frames": intro["frames"], "frames_dir": frames_dir, "audio": track, "at": intro["at"]}


@functools.cache
def has_opencl():
    """The GPU composite needs the NVIDIA OpenCL platform; without it the render takes the CPU path."""
    probe = [ffio.ffmpeg_bin(), "-v", "error", *OPENCL_DEVICE, "-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.04",
             "-vf", "format=yuv420p,hwupload,hwdownload,format=yuv420p", "-f", "null", "-"]
    return subprocess.run(probe, capture_output=True).returncode == 0


def spec_files(video):
    """The spec set the master is rendered from: snapshotted at start, checked before the master replaces the old one."""
    return [path for path in (spec_file(WORK, f"cuts/{video}.json"), WORK / "edl" / f"{video}.json", WORK / "edl" / f"{video}.sfx.json") if path.exists()]


def main(video, draft=False, uhd=False):
    edl, spec = load_edl(video), load_cuts(video)
    specs = spec_files(video)
    digest = gates.snapshot(specs)
    frames_dir = WORK / "frames" / video
    behind_dir = frames_dir.with_name(f"{video}.behind")
    if edl.get("matte"):
        if behind_dir.is_dir() and (problem := check_overlay_frames(behind_dir, edl["frames"])):
            sys.exit(f"{video}: behind layer: {problem}; re-run hf/render.js with --layer behind")
        if not (WORK / "mask" / f"{edl['base']}.mkv").is_file():
            sys.exit(f"{video}: mask/{edl['base']}.mkv is missing; run matte.py {video}")
    if problem := check_overlay_frames(frames_dir, edl["frames"]):
        sys.exit(f"{video}: {problem}")
    captions_dir = frames_dir.with_name(f"{video}.cc")
    if captions_dir.is_dir() and (problem := check_overlay_frames(captions_dir, edl["frames"])):
        sys.exit(f"{video}: caption layer: {problem}; re-run caption_layer.py")
    audio_path = soundtrack(video)
    with wave.open(str(audio_path)) as track:
        gates.check_counts(edl["frames"], len(list(frames_dir.glob("*.png"))), track.getnframes(), (edl["fps_num"], edl["fps_den"]))
    intro = intro_of(video, edl)
    out_dir = WORK / "out"
    out_dir.mkdir(exist_ok=True)
    size, suffix = (UHD, "-4k") if uhd else (OUTPUT, "-draft" if draft else "")
    output = out_dir / f"{video}{suffix}.mp4"
    part = output.with_suffix(".part.mp4")  # a crashed encode never sits under the deliverable's name
    source = source_path(spec)
    route = route_for(source, backends.active())
    encoder = route.backend.uhd if uhd else route.backend.master(draft)
    with progress.job(video, "master", frames=edl["frames"]) as stage:
        with slot("gpu", f"render_final {video}{suffix} ({WORK})", on_wait=stage.wait):
            stage.begin(edl["frames"] + (intro["frames"] if intro else 0))
            encode_master(video, edl, spec, source, route, size, encoder, frames_dir, audio_path, part, intro, stage.update)
        assert_upright(part, size)
        gates.check_snapshot(specs, digest)
        part.replace(output)
    note = f", the brand intro at frame {intro['at']}" if intro else ""
    print(f"rendered {output} ({audio_path.name}{note})")


def refuse_off_gpu(video, edl, route):
    """Motion runs on the NVIDIA routes only (libplacebo, else CPU filters between NVDEC and NVENC): the other
    backends' decode and upload were never rendered with it."""
    if route.backend.name != "nvidia" and has_motion(edl):
        sys.exit(f"{video}: zooms, reframes, focus, the matte and the bystander face blur render only on NVIDIA; this source takes "
                 f"{route.backend.name}'s CPU-filter graph")


def band_crop(band, reframe):
    """The reframe's 9:16 window inside one picture band [x, y, w, h], as fractions of the UHD canvas."""
    bx, by, bw, bh = band
    if bh >= UHD[1]:
        raise SpecError(f"reframe at edited frame {reframe['start']}: the picture already fills 9:16 ({bw}x{bh}); drop the reframe")
    height = bh / reframe["scale"]
    width = height * UHD[0] / UHD[1]
    x = min(max(bx + reframe["cx"] * bw - width / 2, bx), bx + bw - width)
    y = min(max(by + reframe["cy"] * bh - height / 2, by), by + bh - height)
    return {"x": x / UHD[0], "y": y / UHD[1], "w": width / UHD[0], "h": height / UHD[1]}


def reframe_crops(edl, bands):
    """Each reframe (edited frames) split at every cut and picture-band boundary it crosses, each piece cropped from its
    own band (bands.json: [at, end) seconds of the source)."""
    rate = edl["fps_num"] / edl["fps_den"]
    crops = []
    for reframe in edl["reframes"]:
        for seg in edl["segments"]:
            start, end = max(reframe["start"], seg["target"]), min(reframe["end"], seg["target"] + seg["out"] - seg["in"])
            offset = seg["in"] - seg["target"]  # source frame = edited frame + offset
            for entry in bands:
                first, last = max(start, round(entry["at"] * rate) - offset), min(end, round(entry["end"] * rate) - offset)
                if last > first:
                    crops.append({"start": first, "end": last, **band_crop(entry["band"], reframe)})
    return crops


def with_crops(edl, source):
    """The EDL with its reframes resolved against the source's picture bands, which join_sources writes beside it."""
    if not edl.get("reframes"):
        return edl
    path = Path(source).with_suffix(".bands.json")
    if not path.is_file():
        raise SpecError(f"reframes need {path.name}, the picture bands join_sources writes beside the source; re-run join_sources")
    return {**edl, "crops": reframe_crops(edl, json.loads(path.read_text(encoding="utf-8")))}


def preflight(video):
    """render_master's check before the overlay frames, so a route or reframe that cannot composite fails in seconds."""
    edl = load_edl(video)
    if edl.get("faces") and not (WORK / edl["faces"]).is_file():
        sys.exit(f"{video}: {edl['faces']} is missing; render again so the edit stage writes it")
    if has_motion(edl) or edl.get("reframes"):
        source = source_path(load_cuts(video))
        refuse_off_gpu(video, with_crops(edl, source), route_for(source, backends.active()))


def encode_master(video, edl, spec, source, route, size, encoder, frames_dir, audio_path, part, intro=None, report=None):
    edl = with_crops(edl, source)
    refuse_off_gpu(video, edl, route)
    if not route.on_gpu:
        print(f"{video}: compositing with CPU filters between {route.backend.name} decode and encode", flush=True)
    render_chunks(edl, spec, source, route, size, encoder, frames_dir, audio_path, part, intro, report)


if __name__ == "__main__":
    main(sys.argv[1], *parse_flags(sys.argv[2:]))
