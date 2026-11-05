# Created by The Angelo Umali.
# The CPU-filter composite every backend can run between its hardware decode and its encoder: frames by decode index,
# restamped onto the overlay PNGs' grid, blurred on the upright source, punched in, graded, then the animation layer.
from ..blur import blur_graph, ranges_expr
from ..pipeline import DROP_ROTATION, OUTPUT, chain

# The learning grade lifts the blacks to navy and warms the highlights (the v2 Live Motion look).
GRADES = {
    "house": "eq=contrast=1.03:saturation=1.05",
    "learning": ("curves=r='0/0 0.149/0.082 0.243/0.17 0.506/0.50 0.906/0.875 1/0.985':"
                 "g='0/0 0.129/0.071 0.212/0.15 0.478/0.47 0.906/0.85 1/0.965':"
                 "b='0/0 0.075/0.035 0.173/0.13 0.31/0.30 0.757/0.735 1/0.955',eq=saturation=1.18,format=yuv420p"),
}
CPU_OVERLAY = "overlay=alpha=straight:eof_action=pass:repeatlast=0:ts_sync_mode=nearest"
# TV-range luma expanded to 0..255 and copied to all three planes: maskedmerge masks U/V with the mask's own chroma,
# so a gray-only mask merged them at 50% and the behind plate's colour showed through his face. The pinned format
# lets extractplanes negotiate after the CPU crop's scale, which leaves it open.
MASK_GRAY = "format=yuv420p,extractplanes=y,lut=c0='clip((val-16)*255/219,0,255)'"
BT709_TV = "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
UHD = (2160, 3840)
# The OpenCL CRISP pair on the CPU; unsharp caps the matrix at (lx/2 + ly/2) * 2 <= 25, so the wide pass is 13x13, not 17x17.
CPU_CRISP = "unsharp=5:5:0.6,unsharp=13:13:0.18"


def grade_of(edl):
    name = edl.get("grade", "house")
    if name not in GRADES:
        raise ValueError(f"unknown grade {name!r}; known: {', '.join(GRADES)}")
    return GRADES[name]


def three_planes(name):
    """A full-range gray mask on Y, U and V (yuv420p), labels prefixed `name`."""
    return (f"split=2[{name}_y][{name}_c];[{name}_c]scale=iw/2:ih/2,split=2[{name}_u2][{name}_v2];"
            f"[{name}_y][{name}_u2][{name}_v2]mergeplanes=0x001020:yuv420p")


def animation_layer(captions=None):
    """The cards (input 1), with the caption layer (input `captions`) laid over them at 1080 first."""
    return f"[1:v][{captions}:v]{CPU_OVERLAY}:format=rgb," if captions else "[1:v]"


def overlay_tail(backend, size, captions=None):
    """[base] under the animation layer, handed to the encoder."""
    return (f"{animation_layer(captions)}scale={size[0]}:{size[1]}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuva420p[ovl];"
            f"[base][ovl]{CPU_OVERLAY},format=yuv420p,{BT709_TV}{backend.upload}[v]")


def restamp(edl):
    """Footage frames onto the PNGs' exact grid. Never setpts=N*1001 alone: it is only right in a 1/30000 time base, and a
    joined .mkv is 1/1000 (frames landed 1.001 s apart)."""
    return f"settb={edl['fps_den']}/{edl['fps_num']},setpts=N"


def edit_ranges(edl, first_frame=0):
    keep = [(seg["in"] - first_frame, seg["out"] - first_frame) for seg in edl["segments"]]
    punched = [(seg["target"], seg["target"] + seg["out"] - seg["in"]) for seg in edl["segments"] if seg["zoom"] > 1]
    return keep, punched


def composite(backend, edl, regions=(), frame_size=None, size=OUTPUT, first_frame=0, captions=None):
    """The punch-in is two fixed branches switched by overlay enable: scale eval=frame + crop is not pixel-safe.
    regions sit on the upright source (frame_size); first_frame is where a chunk's seeked input starts counting n."""
    keep, punched = edit_ranges(edl, first_frame)
    punch_switch = f"overlay=enable='{ranges_expr(punched)}'" if punched else "overlay=enable=0"
    scale = f"scale={size[0]}:{size[1]}:flags=lanczos"
    blurs, base = blur_graph(regions, "upright", frame_size)
    # A hardware decode hands over nv12 and a CPU decode yuv420p; one format here keeps every backend's composite identical.
    decode = chain(f"select='{ranges_expr(keep)}'", restamp(edl), DROP_ROTATION, "format=yuv420p")
    return (
        f"[0:v]{decode}[upright];"
        f"{blurs}[{base}]split[a][b];"
        f"[a]{scale}[wide];"
        f"[b]{edl['punch_crop']},{scale}[punch];"
        f"[wide][punch]{chain(punch_switch, grade_of(edl), CPU_CRISP if size == UHD else '')}[base];"
        + overlay_tail(backend, size, captions)
    )


def intro_filter(backend, size):
    """The brand pre-roll's opaque PNGs, encoded like the edit's chunks so the stream-copy join takes them."""
    return f"format=rgba,scale={size[0]}:{size[1]}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,{BT709_TV}{backend.upload}"
