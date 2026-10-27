# Created by The Angelo Umali.
# Privacy blur for render_final: cut-spec boxes mapped to edited frames, drawn as one soft layer under one frame-gated mask.
# A split -> crop -> overlay chain per region took v5 (18 regions) from 145 fps to 2.6 fps; this graph's cost stays flat.
import math

from .pipeline import FRAME_EPSILON, OUTPUT, map_interval

# At 4K. 24 left ~70 px screen text readable when the camera sat close to a monitor (v7 WakaTime project list, 2026-09-28).
BLUR_SIGMA = 64
BLUR_DOWN = 8  # the soft layer and mask are drawn at 1/8 size
EXPR_GROUP = 40  # ffmpeg's expression parser fails past ~100 chained terms; parenthesised groups stay shallow


def ranges_expr(ranges):
    terms = [f"between(n,{start},{end - 1})" for start, end in ranges]
    groups = ["+".join(terms[index:index + EXPR_GROUP]) for index in range(0, len(terms), EXPR_GROUP)]
    return groups[0] if len(groups) == 1 else "+".join(f"({group})" for group in groups)


def even_clamp(value, limit):
    return min(max(0, round(value / 2) * 2), limit)


def blur_regions(spec, edl, frame_size):
    """Cut-spec blur spans as (x, y, w, h, edited frame ranges) on an upright frame of frame_size. Boxes are authored on the
    1080-wide upright grid, so they scale, clamp inside the frame (crop fails outside it) and snap even for 4:2:0."""
    width, height = frame_size
    scale, rate = width / 1080, edl["fps_num"] / edl["fps_den"]
    regions = []
    for at, end, x, y, w, h, _reason in spec.get("blur", []):
        ranges = [(math.floor(start * rate + FRAME_EPSILON), min(edl["frames"], math.ceil(stop * rate - FRAME_EPSILON)))
                  for start, stop in map_interval(at, end, edl)]
        left, top = even_clamp(x * scale, width), even_clamp(y * scale, height)
        right, bottom = even_clamp((x + w) * scale, width), even_clamp((y + h) * scale, height)
        if ranges and right > left and bottom > top:
            regions.append((left, top, right - left, bottom - top, ranges))
    return regions


def overlap(ranges, others):
    return [(max(a, c), min(b, d)) for a, b in ranges for c, d in others if max(a, c) < min(b, d)]


def outside(ranges, others):
    kept = []
    for start, end in ranges:
        for other_start, other_end in sorted(others):
            if other_start < end and other_end > start:
                if other_start > start:
                    kept.append((start, other_start))
                start = max(start, other_end)
        if start < end:
            kept.append((start, end))
    return kept


def output_regions(regions, punched, punch, size=OUTPUT):
    """Boxes on the output grid: as authored on unpunched frames, scaled and shifted where the punch-in is on."""
    width, height = size
    big_w, big_h, left_offset, top_offset = punch
    scale_x, scale_y = big_w / width, big_h / height
    placed = []
    for x, y, w, h, ranges in regions:
        if plain := outside(ranges, punched):
            placed.append((x, y, w, h, plain))
        if zoomed := overlap(ranges, punched):
            left, top = even_clamp(x * scale_x - left_offset, width), even_clamp(y * scale_y - top_offset, height)
            right, bottom = even_clamp((x + w) * scale_x - left_offset, width), even_clamp((y + h) * scale_y - top_offset, height)
            if right > left and bottom > top:
                placed.append((left, top, right - left, bottom - top, zoomed))
    return placed


def small_box(x, y, w, h):
    """A region on the 1/BLUR_DOWN grid, one cell wider on every side: the bilinear upscale ramps the mask's edge over
    about a cell, and that ramp must fall outside the box, not over the text it hides."""
    left, top = max(0, x // BLUR_DOWN - 1), max(0, y // BLUR_DOWN - 1)
    return left, top, -(-(x + w) // BLUR_DOWN) + 1 - left, -(-(y + h) // BLUR_DOWN) + 1 - top


def mask_boxes(regions):
    return ",".join(f"drawbox=x={bx}:y={by}:w={bw}:h={bh}:color=white:t=fill:enable='{ranges_expr(ranges)}'"
                    for x, y, w, h, ranges in regions for bx, by, bw, bh in [small_box(x, y, w, h)])


def blur_graph(regions, label, frame_size):
    """CPU form, on the upright source before the punch-in split."""
    if not regions:
        return "", label
    width, height = frame_size
    boxes = mask_boxes(regions)
    any_region = ranges_expr(sorted(span for *_, ranges in regions for span in ranges))
    return (f"[{label}]split[sharp][soften];"
            f"[soften]scale={width // BLUR_DOWN}:{height // BLUR_DOWN}:flags=area,gblur=sigma={BLUR_SIGMA / BLUR_DOWN},"
            "format=yuv420p,split[soft][mask];"
            f"[mask]format=gray,lut=c0=0,{boxes}[boxes];"
            # Left to negotiation, the alpha branch dropped to grey and the blurred boxes lost their colour.
            f"[soft][boxes]alphamerge,format=yuva420p,scale={width}:{height}:flags=bilinear,format=yuva420p[veil];"
            f"[sharp][veil]overlay=0:0:format=yuv420:enable='{any_region}'[blurred];"), "blurred"


def gpu_blur_graph(regions, source, tone, size=OUTPUT):
    """The veil from the CUDA frames at [source]: a 1/8 soft copy, toned like the graded frame, under a frame-gated mask,
    uploaded to the render's OpenCL device as [veil]. Outside every region the mask is empty, so the veil is transparent."""
    width, height = size
    small_w, small_h = width // BLUR_DOWN, height // BLUR_DOWN
    boxes = mask_boxes(regions)
    return (f"[{source}]scale_cuda={small_w}:{small_h}:interp_algo=lanczos,hwdownload,format=yuv420p,{tone},"
            f"gblur=sigma={BLUR_SIGMA * small_w / 2160},split[soft][mask];"
            f"[mask]format=gray,lut=c0=0,{boxes}[boxes];"
            f"[soft][boxes]alphamerge,format=yuva420p,scale={width}:{height}:flags=bilinear,format=yuva420p,hwupload[veil];")
