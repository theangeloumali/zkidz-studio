# Created by The Angelo Umali.
# Nothing over the mouth in the hook (herk gate 3): overlay alpha inside the mouth box, first 2.5 s of the face-cam frames.
from . import timeline

HOOK_S = 2.5
# ASSUMPTION: a portrait talking head with the punch-in framing puts the mouth here, below the cards' top band (y 270-880).
MOUTH_BOX = (380, 940, 320, 220)
MAX_COVERED = 0.02  # anti-aliased edges and glow spill stay under this
OPAQUE = 32


def covered_fraction(alpha, box):
    x, y, w, h = box
    return float((alpha[y:y + h, x:x + w] > OPAQUE).mean())


def hook_frames(edl, intro, facecam_spans):
    """Edited frames of the hook before the intro plays; only face-cam frames when the spec marks any."""
    count = min(round(HOOK_S * timeline.rate(edl)), edl["frames"], intro["at"] if intro else edl["frames"])
    if not facecam_spans:
        return list(range(count))
    face = set()
    for at, end in facecam_spans:
        face.update(range(round(at * timeline.rate(edl)), round(end * timeline.rate(edl))))
    return [frame for frame in range(count) if timeline.source_frame(frame, edl) in face]


def mouth_problems(alpha_frames, frames, edl, box=MOUTH_BOX):
    """alpha_frames: the overlay's alpha for edited frames 0..n, indexed by edited frame."""
    covered = [frame for frame in frames if covered_fraction(alpha_frames[frame], box) > MAX_COVERED]
    if not covered:
        return []
    return [f"an overlay covers the mouth on {len(covered)} hook frames, first at {covered[0] / timeline.rate(edl):.2f} s"]
