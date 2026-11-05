# Created by The Angelo Umali.
# The learning theme's people gates (#44 #45). framed: on footage that does not fill 9:16, every kept second sits in a
# reframe window or under a full-frame cover, so the letterboxed room never shows. facesBlurred: when the creator asked
# for everyone else blurred, no one else's face can be read on the master, sharp or through a weak frost.
import numpy as np

from .. import faces, speakers
from ..pipeline import OUTPUT
from . import inputs, timeline

BLURRED_FPS = 2
READABLE = 120  # Laplacian variance of a face at 64 px: unblurred faces measured 250-1900, a see-through frost 5-21
GAP_FRAMES = 1  # a one-frame seam between windows is rounding, not the room


def framed_problems(edl, covers):
    rate = timeline.rate(edl)
    covered = sorted([(w["start"], w["end"]) for w in edl.get("reframes", [])] + [(round(a * rate), round(b * rate)) for a, b in covers])
    gaps, cursor = [], 0
    for start, end in covered + [(edl["frames"], edl["frames"])]:
        if start - cursor > GAP_FRAMES:
            gaps.append((cursor, start))
        cursor = max(cursor, end)
    listed = ", ".join(f"{a / rate:.1f}-{b / rate:.1f}s" for a, b in gaps[:10]) + (", …" if len(gaps) > 10 else "")
    return [f"the whole room shows at {listed}; set the cut spec's follow: \"speaker\" or add reframes"] if gaps else []


def blurred_problems(found, identities):
    """found: [(master seconds, [(face embedding, detail), …])]. A sharp face fails when it is nearer someone else than
    the creator. A frosted face (under READABLE) that YuNet still finds fails unless it is his: a face blurred right is no
    longer found, and a see-through frost kept eyes and nose readable though SFace could not name them."""
    creator, others = (np.array(identities[key] or np.zeros((0, 1))) for key in ("creator", "others"))
    problems = []
    for t, embeddings in found:
        for vector, detail in embeddings:
            near_other = max((float(row @ vector) for row in others), default=0.0)
            near_creator = max((float(row @ vector) for row in creator), default=0.0)
            if detail < READABLE and near_creator < speakers.SAME_PERSON:
                problems.append(f"a face the creator asked to blur shows through its blur at {t:.1f}s")
                break
            if detail >= READABLE and near_other >= speakers.SAME_PERSON and near_other > near_creator:
                problems.append(f"a face the creator asked to blur reads at {t:.1f}s")
                break
    return problems


def face_detail(image, box):
    """How much feature detail a face carries, at one size so near and far faces compare: Laplacian variance at 64 px."""
    import cv2

    x, y, w, h = (max(0, int(value)) for value in box)
    gray = cv2.cvtColor(image[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32), cv2.CV_32F).var()) if gray.size else 0.0


def master_embeddings(master):
    """(master seconds, [(SFace embedding, detail) of each face YuNet finds]) at BLURRED_FPS."""
    detector, sface = faces.detector(OUTPUT), speakers.recognizer()
    found = []
    for index, image in enumerate(faces.frames(master, BLURRED_FPS, size=OUTPUT)):
        _, rows = detector.detect(np.ascontiguousarray(image))
        seen = []
        for row in [] if rows is None else rows:
            vector = sface.feature(sface.alignCrop(image, row))[0]
            seen.append((vector / np.linalg.norm(vector), face_detail(image, row[:4])))
        found.append((index / BLURRED_FPS, seen))
    return found


def full_frame_spans(edl, bands):
    """Edited-second spans whose source clip fills 9:16 (bands: faces.recorded_bands): no room to frame there."""
    rate, spans = timeline.rate(edl), []
    for segment in edl["segments"]:
        for clip in bands:
            if round(clip["band"][3] * faces.CANVAS_SCALE) < OUTPUT[1]:
                continue
            start, end = max(segment["in"], round(clip["at"] * rate)), min(segment["out"], round(clip["end"] * rate))
            if start < end:
                spans.append(((segment["target"] + start - segment["in"]) / rate, (segment["target"] + end - segment["in"]) / rate))
    return spans


def gates(video, master, edl, sheet):
    """The people gates qc_master runs on a learning edit: framed when any source clip is letterboxed, facesBlurred when
    asked."""
    bands = faces.recorded_bands(inputs.work(), edl.get("base", video))
    result = {}
    if any(round(clip["band"][3] * faces.CANVAS_SCALE) < OUTPUT[1] for clip in bands):
        result["framed"] = lambda: framed_problems(edl, inputs.cover_spans(sheet(), edl) + full_frame_spans(edl, bands))
    if edl.get("faces"):
        identities = inputs.read_json(inputs.work() / "faces" / f"{video}.people.json")
        result["facesBlurred"] = lambda: blurred_problems(master_embeddings(master), identities)[:10]
    return result
