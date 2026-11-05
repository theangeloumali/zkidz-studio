# Created by The Angelo Umali.
# textClear (#43): no two cues' text shares space at the same moment. The boxes are where Chrome laid each cue's text out at
# rest (render.js --boxes → edl/<video>.text.json, edited seconds); render_master checks them before drawing a frame.
from ..specs.gates import GateFailed
from . import inputs

MARGIN = 8  # px on the 1080 grid two texts keep between them


def load_boxes(video):
    boxes = inputs.read_json(inputs.work() / "edl" / f"{video}.text.json")
    if boxes is None:
        raise GateFailed(f"{video} has no text measurement; run render.js {video} --boxes (render_master does)")
    return boxes


def label(cue):
    return f"'{cue['name']}' ({cue['kind']})" if cue.get("name") else f"{cue['kind']} {cue['clip']}"


def touching(first, second):
    (x1, y1, w1, h1), (x2, y2, w2, h2) = first, second
    return x1 < x2 + w2 + MARGIN and x2 < x1 + w1 + MARGIN and y1 < y2 + h2 + MARGIN and y2 < y1 + h1 + MARGIN


def text_clear_problems(cues):
    problems, ordered = [], sorted(cues, key=lambda cue: cue["at"])
    for index, first in enumerate(ordered):
        for second in ordered[index + 1:]:
            if second["at"] >= first["end"]:
                break  # sorted by start: no later cue overlaps this one
            # A words caption's states build one line in place, so caption against caption is the caption's own business.
            if first["kind"] == second["kind"] == "caption":
                continue
            start, end = max(first["at"], second["at"]), min(first["end"], second["end"])
            if start < end and any(touching(a, b) for a in first["boxes"] for b in second["boxes"]):
                problems.append(f"{label(first)} and {label(second)} at {start:.1f}s")
    return problems


def check(video):
    if problems := text_clear_problems(load_boxes(video)):
        listed = "; ".join(problems[:10]) + (f"; and {len(problems) - 10} more" if len(problems) > 10 else "")
        raise GateFailed(f"text overlaps text ({listed}); move one or drop it, then render again")
