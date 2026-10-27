# Created by The Angelo Umali.
# The CPU-filter composite every backend can run between its hardware decode and its encoder: frames by decode index,
# restamped onto the overlay PNGs' grid, blurred on the upright source, punched in, graded, then the animation layer.
from ..blur import blur_graph, ranges_expr
from ..pipeline import DROP_ROTATION, OUTPUT, chain

GRADE = "eq=contrast=1.03:saturation=1.05"
BT709_TV = "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
UHD = (2160, 3840)
# The OpenCL CRISP pair on the CPU; unsharp caps the matrix at (lx/2 + ly/2) * 2 <= 25, so the wide pass is 13x13, not 17x17.
CPU_CRISP = "unsharp=5:5:0.6,unsharp=13:13:0.18"


def restamp(edl):
    """Footage frames onto the PNGs' exact grid. Never setpts=N*1001 alone: it is only right in a 1/30000 time base, and a
    joined .mkv is 1/1000 (frames landed 1.001 s apart)."""
    return f"settb={edl['fps_den']}/{edl['fps_num']},setpts=N"


def edit_ranges(edl, first_frame=0):
    keep = [(seg["in"] - first_frame, seg["out"] - first_frame) for seg in edl["segments"]]
    punched = [(seg["target"], seg["target"] + seg["out"] - seg["in"]) for seg in edl["segments"] if seg["zoom"] > 1]
    return keep, punched


def composite(backend, edl, regions=(), frame_size=None, size=OUTPUT, first_frame=0):
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
        f"[wide][punch]{chain(punch_switch, GRADE, CPU_CRISP if size == UHD else '')}[base];"
        f"[1:v]{scale}:out_color_matrix=bt709:out_range=tv,format=yuva420p[ovl];"
        f"[base][ovl]overlay=alpha=straight:eof_action=pass:repeatlast=0:ts_sync_mode=nearest,format=yuv420p,{BT709_TV}{backend.upload}[v]"
    )


def intro_filter(backend, size):
    """The brand pre-roll's opaque PNGs, encoded like the edit's chunks so the stream-copy join takes them."""
    return f"format=rgba,scale={size[0]}:{size[1]}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,{BT709_TV}{backend.upload}"
