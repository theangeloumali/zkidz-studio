# Created by The Angelo Umali.
# Composites one finished TikTok edit: 4K source cut by the EDL, privacy blur, punch-ins, overlays, edited audio.
# Usage (from the work dir): python -m zks_engine.render_final v1 [--draft | --4k]
#   With CUDA the whole render runs on the GPU (decode, scale, punch-in, blur, overlays, NVENC); x264 only without one.
#   --draft = faster encoder preset for review. --4k = sharpened 2160x3840 HEVC at quality, not size (CUDA only).
#   A brand pre-roll declared in edl/<v>.sfx.json (hf/build.js) renders as its own chunk, spliced in at its insert (sfx.py).
# Graph choices follow the pipeline review: select on frame index n, then RESTAMP onto the overlay PNGs' own 1001/30000
# grid, punch-in as two fixed branches switched by overlay enable (scale eval=frame + crop is not pixel-safe).
import functools
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import wave

from . import ffio
from .blur import blur_graph, blur_regions, gpu_blur_graph, output_regions, ranges_expr
from .edl import FACECAM_ZOOM, PUNCH_TOP
from . import progress
from .slots import slot
from .pipeline import (AUDIO_RATE, CUDA_LANCZOS, CUDA_TV_RANGE, DROP_ROTATION, OUTPUT, WORK, assert_upright, chain, decode_args, frame_to_sample, has_cuda, intro_track, load_cuts, load_edl,
                      orientation_filter, source_path, split_orientation, upright_size)

GRADE = "eq=contrast=1.03:saturation=1.05"
# overlay_cuda needs both inputs tagged alike; otherwise ffmpeg 9 inserts a CPU converter on a CUDA link and fails.
BT709_TV = "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
GPU_SCALE = CUDA_LANCZOS + ":format=yuv420p," + BT709_TV  # reads the TV-range frames decode hands on
UHD = (2160, 3840)
# Footage only (the animation layer goes on after): fine detail, then a wide low-strength clarity pass; no halos at 2x zoom.
CRISP = "unsharp_opencl=lx=5:ly=5:la=0.6,unsharp_opencl=lx=17:ly=17:la=0.18"
# Named by platform: OpenCL device 0 can be the Intel iGPU.
OPENCL_DEVICE = ["-init_hw_device", "opencl=ocl:,platform_name=NVIDIA CUDA", "-filter_hw_device", "ocl"]
MASTER_MAX_BPS = 12_000_000  # the 1080p H.264 master's cap; the boiling linework needs it
# p7 + lookahead + AQ + B-frame refs: shared by the H.264 master and the HEVC 4K export.
NVENC_QUALITY = ["-preset", "p7", "-tune", "hq", "-rc-lookahead", "32", "-spatial-aq", "1", "-temporal-aq", "1", "-bf", "3",
                 "-b_ref_mode", "middle"]


def restamp(edl):
    """Footage frames onto the PNGs' exact grid. Never setpts=N*1001 alone: it is only right in a 1/30000 time base, and a
    joined .mkv is 1/1000 (frames landed 1.001 s apart); N*1001/(30000*TB) rounds to whole ms, a frame early vs the PNGs."""
    return f"settb={edl['fps_den']}/{edl['fps_num']},setpts=N"


def punch_frame(width=OUTPUT[0], height=OUTPUT[1]):
    """The 1.08x frame the GPU punch-in reads from, and where the output window sits inside it (same framing as PUNCH_CROP)."""
    big_w, big_h = round(width * FACECAM_ZOOM / 2) * 2, round(height * FACECAM_ZOOM / 2) * 2
    return big_w, big_h, (big_w - width) // 2, round(big_h * PUNCH_TOP)


def edit_ranges(edl):
    keep = [(seg["in"], seg["out"]) for seg in edl["segments"]]
    punched = [(seg["target"], seg["target"] + seg["out"] - seg["in"]) for seg in edl["segments"] if seg["zoom"] > 1]
    return keep, punched


def build_graph(edl, cuda, orientation="", regions=(), frame_size=None):
    """CPU composite, used only without CUDA: blur on the upright source, punch-in as two branches switched by overlay."""
    keep, punched = edit_ranges(edl)
    punch_switch = f"overlay=enable='{ranges_expr(punched)}'" if punched else "overlay=enable=0"
    gpu_turn, cpu_turn = split_orientation(orientation)
    download = chain(gpu_turn, "hwdownload,format=nv12") if cuda else ""
    decode = chain(f"select='{ranges_expr(keep)}'", restamp(edl), download, cpu_turn, DROP_ROTATION)
    blurs, base = blur_graph(regions, "upright", frame_size)
    return (
        f"[0:v]{decode}[upright];"
        f"{blurs}[{base}]split[a][b];"
        "[a]scale=1080:1920:flags=lanczos[wide];"
        f"[b]{edl['punch_crop']},scale=1080:1920:flags=lanczos[punch];"
        f"[wide][punch]{punch_switch},{GRADE}[base];"
        "[1:v]scale=out_color_matrix=bt709:out_range=tv,format=yuva420p[ovl];"
        "[base][ovl]overlay=alpha=straight:eof_action=pass:repeatlast=0:ts_sync_mode=nearest,format=yuv420p[v]"
    )


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
}


def zoom_factor(preset, k, n, item=None):
    curve = ZOOM_CURVES[preset][1]
    return curve(k, n, item["to"]) if preset == "portal" else curve(k, n)


def scale_expr(edl):
    """Per-frame footage scale in t (seconds from the chunk's first frame): the 1.08x punch-in times every zoom window."""
    rate = edl["fps_num"] / edl["fps_den"]
    frame = f"(t*{rate:.10f})"
    inside = lambda start, end: f"gte({frame},{start - 0.5})*lt({frame},{end - 0.5})"  # noqa: E731
    _, punched = edit_ranges(edl)
    punch = "".join(f"+{FACECAM_ZOOM - 1:g}*{inside(a, b)}" for a, b in punched)
    zoom = ""
    for item in edl.get("zooms", []):
        n = item["end"] - item["start"]
        # k clamps at 0: before its window a curve's exp() would overflow, and inf times the 0 gate is NaN (a libplacebo crash).
        curve = ZOOM_CURVES[item["preset"]][0].format(k=f"max({frame}-{item['start']},0)", n=n, n1=max(n - 1, 1), to=item.get("to", 1))
        zoom += f"+({curve}-1)*{inside(item['start'], item['end'])}"
    return f"(1{punch})*(1{zoom})"


def centre_expr(edl, axis, default):
    """The crop centre (fraction of the frame) on one axis: each zoom window's own, the punch-in framing elsewhere."""
    rate = edl["fps_num"] / edl["fps_den"]
    frame = f"(t*{rate:.10f})"
    moves = "".join(f"+{item[axis] - default:g}*gte({frame},{item['start'] - 0.5})*lt({frame},{item['end'] - 0.5})"
                    for item in edl.get("zooms", []) if item[axis] != default)
    return f"({default:g}{moves})"


def zoom_crop(edl, size):
    """libplacebo crops and scales each frame on Vulkan; the expressions are evaluated per frame (measured on a 4K HLG
    clip: a 1.0x to 1.3x snap in 5 frames, frame-exact)."""
    scale = scale_expr(edl)
    cx, cy = centre_expr(edl, "cx", 0.5), centre_expr(edl, "cy", PUNCH_TOP + 0.5 / FACECAM_ZOOM)
    return (f"libplacebo=w={size[0]}:h={size[1]}:crop_w='iw/({scale})':crop_h='ih/({scale})'"
            f":crop_x='clip({cx}*iw-cw/2,0,iw-cw)':crop_y='clip({cy}*ih-ch/2,0,ih-ch)'"
            ":upscaler=ewa_lanczos:downscaler=ewa_lanczos:format=yuv420p:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv")


def device_args(edl):
    """The OpenCL device every composite uses, plus a Vulkan one for libplacebo when the edit zooms."""
    return (["-init_hw_device", "vulkan=vk"] if edl.get("zooms") else []) + OPENCL_DEVICE


def zoom_graph(edl, gpu_turn, regions, size, finish, first_frame):
    """An edit with animated zooms: the footage leaves CUDA once, libplacebo applies the punch-in and every zoom."""
    if regions:
        sys.exit("blur boxes with animated zooms are not supported yet: the boxes would not follow the moving crop")
    keep, _ = edit_ranges(edl)
    keep = [(start - first_frame, end - first_frame) for start, end in keep]
    select = chain(f"select='{ranges_expr(keep)}'", restamp(edl))
    footage = f"[0:v]{chain(select, gpu_turn, CUDA_TV_RANGE)},hwdownload,format=nv12,{zoom_crop(edl, size)}"
    if edl.get("matte"):
        # Behind layer over the footage, then the footage back wherever the matte says he is. The mask is TV-range luma
        # (matte.py) and takes the footage's exact crop, then expands to 0..255 for maskedmerge.
        footage += (f",split[near][far];[2:v]{gpu_scale_png(size, 'yuva420p')}[behind];[far][behind]overlay=format=yuv420[backed];"
                    f"[3:v]{select},{zoom_crop(edl, size)},extractplanes=y,lut=c0='clip((val-16)*255/219,0,255)'[mask];"
                    "[backed][near][mask]maskedmerge")
    return (
        f"{footage},{chain(DROP_ROTATION, GRADE)},{chain('hwupload', finish)}[graded];"
        f"[1:v]{overlay_upload(size)}[ovl];"
        f"[graded][ovl]overlay_opencl,hwdownload,format=yuv420p,{BT709_TV}[v]"
    )


def matte_inputs(piece, first, behind_dir, mask, seek):
    """The behind layer's PNGs (on the overlay's frame grid) and the source-space mask (seeked like the footage)."""
    return ["-thread_queue_size", "512", "-framerate", f"{piece['fps_num']}/{piece['fps_den']}", "-start_number", str(first),
            "-i", str(behind_dir / "%05d.png"), "-ss", f"{seek:.6f}", "-i", str(mask)]


def gpu_graph(edl, gpu_turn, regions=(), size=OUTPUT, finish="", first_frame=0):
    """CUDA decodes, turns and scales: straight to the output and, for the punch-in, to 1.08x, whose window an overlay_cuda
    at a negative offset lays over the frame (both inputs share the decoder's context). After the CPU grade, finish (OpenCL
    filters), the blur veil and the animation layer composite on the one OpenCL device, whose uploads complete in order;
    a hwupload_cuda context raced overlay_cuda and composited random frames half-uploaded (QC r5).
    first_frame: the source frame a chunk's seeked input starts at, which select counts from."""
    if edl.get("zooms") or edl.get("matte"):
        return zoom_graph(edl, gpu_turn, regions, size, finish, first_frame)
    keep, punched = edit_ranges(edl)
    keep = [(start - first_frame, end - first_frame) for start, end in keep]
    big_w, big_h, left, top = punch = punch_frame(*size)
    placed = output_regions(regions, punched, punch, size)
    decode = chain(f"select='{ranges_expr(keep)}'", restamp(edl), gpu_turn, CUDA_TV_RANGE)
    return (
        f"[0:v]{decode},split[wide_src][big_src];"
        f"[wide_src]{GPU_SCALE.format(*size)}[wide];"
        f"[big_src]{GPU_SCALE.format(big_w, big_h)}[big];"
        f"[wide][big]overlay_cuda=x={-left}:y={-top}:enable='{ranges_expr(punched) if punched else 0}'"
        + (",split[framed][soften];" + gpu_blur_graph(placed, "soften", GRADE, size) if placed else "[framed];")
        + f"[1:v]{overlay_upload(size)}[ovl];"
        # Without DROP_ROTATION the source's display matrix rides along and the muxer tags the upright frame as rotated.
        + f"[framed]hwdownload,format=yuv420p,{chain(DROP_ROTATION, GRADE)},{chain('hwupload', finish)}[graded];"
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


def video_encoder(cuda, draft):
    cap = ["-maxrate", str(MASTER_MAX_BPS), "-bufsize", str(2 * MASTER_MAX_BPS)]
    if cuda:
        preset = ["-preset", "p4"] if draft else NVENC_QUALITY
        codec = ["-c:v", "h264_nvenc", *preset, "-rc", "vbr", "-cq", "19", "-b:v", "10M", *cap]
    elif sys.platform == "darwin":
        # -q:v is Apple-silicon only; a bitrate works on Intel too
        codec = ["-c:v", "h264_videotoolbox", "-b:v", str(MASTER_MAX_BPS)]
    else:
        speed = ["-preset", "veryfast", "-crf", "20"] if draft else ["-preset", "slow", "-crf", "18", *cap]
        codec = ["-c:v", "libx264", *speed, "-pix_fmt", "yuv420p"]
    return [*codec, "-profile:v", "high"]


# The apps re-compress every upload, so the 4K export spends bits on quality: screen text is what starves first.
UHD_ENCODER = ["-c:v", "hevc_nvenc", *NVENC_QUALITY, "-multipass", "fullres", "-rc", "vbr", "-cq", "17", "-b:v", "0",
               "-maxrate", "60M", "-bufsize", "120M", "-profile:v", "main", "-tag:v", "hvc1"]


# One job leaves the GPU ~75% idle (its CUDA, OpenCL and NVENC steps wait on each other), so edits render as chunks at
# once. Measured on v6 4K slices: 1 job 28.7 fps, 2 jobs 49.1, 4 jobs 66.0, 6 jobs 67.0 in total; ~1.2 CPU cores per job.
RENDER_JOBS = int(os.environ.get("RENDER_JOBS", "4"))
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
    def within(items):
        return [{**item, "start": max(item["start"], first) - first, "end": min(item["end"], last) - first}
                for item in items if item["end"] > first and item["start"] < last]

    return {**edl, "segments": segments, "frames": last - first, "zooms": within(edl.get("zooms", [])), "matte": within(edl.get("matte", []))}


def chunk_bounds(frames, jobs=RENDER_JOBS):
    count = max(1, min(jobs, frames // MIN_CHUNK_FRAMES))
    return [(frames * index // count, frames * (index + 1) // count) for index in range(count)]


def intro_bounds(frames, at, jobs=RENDER_JOBS):
    """The edit's chunks before the brand intro's insert and after it, sharing `jobs` by length."""
    before = chunk_bounds(at, min(jobs - 1, max(1, round(jobs * at / frames))))
    after = chunk_bounds(frames - at, jobs - len(before))
    return before, [(first + at, last + at) for first, last in after]


@functools.cache
def frame_times(source):
    """Presentation times (s) of every video frame, from the packet table: no decode."""
    result = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts,pts_time", "-of", "csv=p=0",
                             str(source)], capture_output=True, text=True, check=True)
    return sorted(float(line.split(",")[1]) for line in result.stdout.split() if "," in line and "N/A" not in line)


def chunk_command(piece, first, spec, source, gpu_turn, size, finish, encoder, frames_dir, out):
    """One chunk, its input seeked between its first kept frame and the one before: accurate seek makes that frame n=0.
    Real frame times, not index x 1001: an Insta360 clip's timestamps shifted half a frame mid-file and the grid seek
    landed a frame late. -frames:v ends it on time: overlay_opencl repeats the footage's last frame past its end."""
    first_source = piece["segments"][0]["in"]
    times = frame_times(source)
    seek = (times[first_source - 1] + times[first_source]) / 2 if first_source else 0.0
    graph = gpu_graph(piece, gpu_turn, blur_regions(spec, piece, size), size, finish, first_source)
    return ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *device_args(piece), *decode_args(True), "-ss", f"{seek:.6f}", "-i", str(source),
            "-thread_queue_size", "512", "-framerate", f"{piece['fps_num']}/{piece['fps_den']}", "-start_number", str(first),
            "-i", str(frames_dir / "%05d.png"),
            *(matte_inputs(piece, first, frames_dir.with_name(frames_dir.name + ".behind"), WORK / "mask" / f"{piece['base']}.mkv", seek)
              if piece.get("matte") else []),
            "-filter_complex", graph, "-map", "[v]", "-frames:v", str(piece["frames"]),
            "-fps_mode", "passthrough", *encoder, *BT709_TAGS, "-an", "-progress", str(out.with_suffix(".progress")), str(out)]


def frames_written(report):
    """The last frame count in an ffmpeg -progress file (0 before its first block)."""
    try:
        counts = re.findall(r"^frame=(\d+)", report.read_text(encoding="utf-8"), re.M)
    except OSError:
        return 0
    return int(counts[-1]) if counts else 0


def count_frames(path):
    result = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets",
                             "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return int(json.loads(result.stdout)["streams"][0]["nb_read_packets"])


def intro_command(intro, edl, size, encoder, out):
    """The brand pre-roll as a chunk of its own: its opaque PNGs scaled on the GPU, encoded exactly like the edit's chunks
    so the stream-copy join takes it."""
    return ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-framerate", f"{edl['fps_num']}/{edl['fps_den']}", "-start_number", "0",
            "-i", str(intro["frames_dir"] / "%05d.png"), "-vf", gpu_scale_png(size, "yuv420p"), "-frames:v", str(intro["frames"]),
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
    return ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *ffio.concat_input_args(listing), *sound,
            "-c:v", "copy", *tag, *BT709_TAGS, "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", str(part)]


def render_chunks(edl, spec, source, gpu_turn, size, finish, encoder, frames_dir, audio_path, part, intro=None, report=None):
    """Up to RENDER_JOBS chunks rendered at once (a brand pre-roll as one more, at its insert), joined and muxed with the
    audio."""
    chunk_dir = part.with_name(f"{part.stem}-chunks")
    shutil.rmtree(chunk_dir, ignore_errors=True)
    chunk_dir.mkdir()
    before, after = intro_bounds(edl["frames"], intro["at"]) if intro else (chunk_bounds(edl["frames"]), [])
    chunks, commands = [], []  # (output, frames), joined in this order
    for index, (first, last) in enumerate(before + after):
        if intro and index == len(before):
            chunks.append((chunk_dir / "intro.mp4", intro["frames"]))
            commands.append(intro_command(intro, edl, size, encoder, chunks[-1][0]))
        chunks.append((chunk_dir / f"{index:02d}.mp4", last - first))
        commands.append(chunk_command(edl_slice(edl, first, last), first, spec, source, gpu_turn, size, finish, encoder, frames_dir, chunks[-1][0]))
    print(f"rendering {len(before + after)} chunks at once{' + the brand intro' if intro else ''}", flush=True)
    jobs = [subprocess.Popen(command, **LOW_PRIORITY) for command in commands]
    while any(job.poll() is None for job in jobs):
        if report:
            report(sum(frames_written(out.with_suffix(".progress")) for out, _ in chunks))
        time.sleep(2)
    if codes := [job.returncode for job in jobs if job.returncode]:
        sys.exit(f"chunk render failed (exit codes {codes}); chunks kept in {chunk_dir}")
    for out, count in chunks:
        if count_frames(out) != count:
            sys.exit(f"{out.name}: {count_frames(out)} frames, expected {count}")
    listing = chunk_dir / "chunks.txt"
    listing.write_text(ffio.concat_listing(out for out, _ in chunks), encoding="utf-8")
    splice = (intro["audio"], frame_to_sample(intro["at"], edl)) if intro else ()
    subprocess.run(join_command(listing, audio_path, encoder, part, *splice), check=True)
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
    probe = ["ffmpeg", "-v", "error", *OPENCL_DEVICE, "-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.04",
             "-vf", "format=yuv420p,hwupload,hwdownload,format=yuv420p", "-f", "null", "-"]
    return subprocess.run(probe, capture_output=True).returncode == 0


def gpu_path(cuda, cpu_turn):
    return cuda and not cpu_turn and has_opencl()


def main(video, draft=False, uhd=False):
    edl, spec = load_edl(video), load_cuts(video)
    frames_dir = WORK / "frames" / video
    if edl.get("matte"):
        if problem := check_overlay_frames(frames_dir.with_name(f"{video}.behind"), edl["frames"]):
            sys.exit(f"{video}: behind layer: {problem}; re-run hf/render.js with --layer behind")
        if not (WORK / "mask" / f"{edl['base']}.mkv").is_file():
            sys.exit(f"{video}: mask/{edl['base']}.mkv is missing; run matte.py {video}")
    if problem := check_overlay_frames(frames_dir, edl["frames"]):
        sys.exit(f"{video}: {problem}")
    audio_path = soundtrack(video)
    if not track_fits(audio_path, edl["frames"], edl):
        sys.exit(f"{video}: {audio_path.name} does not match the edit; re-run audio.py (and sfx.py)")
    intro = intro_of(video, edl)
    out_dir = WORK / "out"
    out_dir.mkdir(exist_ok=True)
    size, finish, suffix = (UHD, CRISP, "-4k") if uhd else (OUTPUT, "", "-draft" if draft else "")
    output = out_dir / f"{video}{suffix}.mp4"
    part = output.with_suffix(".part.mp4")  # a crashed encode never sits under the deliverable's name
    cuda, source = has_cuda(), source_path(spec)
    gpu_turn, cpu_turn = split_orientation(orientation_filter(source, cuda))
    gpu = gpu_path(cuda, cpu_turn)
    encoder = UHD_ENCODER if uhd else video_encoder(gpu, draft)
    with progress.job(video, "master", frames=edl["frames"]) as stage:
        with slot("gpu", f"render_final {video}{suffix} ({WORK})", on_wait=stage.wait):
            stage.begin(edl["frames"] + (intro["frames"] if intro else 0))
            encode_master(video, uhd, gpu, cuda, source, edl, spec, gpu_turn, size, finish, encoder, frames_dir, audio_path, part, intro,
                          stage.update)
        assert_upright(part, size)
        part.replace(output)
    note = f", the brand intro at frame {intro['at']}" if intro else ""
    print(f"rendered {output} ({audio_path.name}{note})")


def encode_master(video, uhd, gpu, cuda, source, edl, spec, gpu_turn, size, finish, encoder, frames_dir, audio_path, part, intro=None,
                  report=None):
    if gpu:
        render_chunks(edl, spec, source, gpu_turn, size, finish, encoder, frames_dir, audio_path, part, intro, report)
    elif uhd:
        sys.exit(f"{video}: 4K renders only on the CUDA path")
    elif intro:
        sys.exit(f"{video}: the brand intro renders only on the CUDA path")
    else:
        print(f"{video}: no usable CUDA + OpenCL path; rendering on the CPU", flush=True)
        frame_size = upright_size(source)
        graph = build_graph(edl, cuda, orientation_filter(source, cuda), blur_regions(spec, edl, frame_size), frame_size)
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-stats", *decode_args(cuda), "-i", str(source),
            "-thread_queue_size", "512", "-framerate", f"{edl['fps_num']}/{edl['fps_den']}", "-start_number", "0", "-i", str(frames_dir / "%05d.png"),
            "-i", str(audio_path), "-filter_complex", graph, "-map", "[v]", "-map", "2:a", "-fps_mode", "passthrough", *encoder, *BT709_TAGS,
            "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", str(part),
        ], check=True, **LOW_PRIORITY)


if __name__ == "__main__":
    main(sys.argv[1], *parse_flags(sys.argv[2:]))
