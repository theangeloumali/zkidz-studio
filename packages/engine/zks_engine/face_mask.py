# Created by The Angelo Umali.
# The bystander blur's mask (#44): a padded ellipse over every face that is not the creator's, drawn on the proxy grid so
# mask frame n is source frame n, written only over the frames the edit keeps. render_final crops it like the footage, so
# the blur follows every reframe and zoom.
import bisect
import hashlib
import json

import numpy as np

from . import matte, pipeline

MASK_FORMAT = 3  # 1 stored faces at 30..218 (a 91 % blur); 2 drew only the nearest sample, so a turning head slipped out
HOLD_S = 1.0  # a face the detector missed for a moment stays blurred this long
PAD_W, PAD_H = 0.75, 0.85  # ellipse half-axes as shares of the face box: the hairline and chin stay covered


def track_index(samples):
    """{track: (times, boxes)} for nearest-observation lookups."""
    index = {}
    for sample in samples:
        for entry in sample["faces"]:
            times, boxes = index.setdefault(entry["track"], ([], []))
            times.append(sample["t"])
            boxes.append(entry["box"])
    return index


def draw(samples, t, creator, size=pipeline.OUTPUT, index=None):
    """The mask (0/255) at source time t: every face not the creator's that was seen within HOLD_S."""
    import cv2

    mask = np.zeros((size[1], size[0]), np.uint8)
    for track, (times, boxes) in (index or track_index(samples)).items():
        if track in creator:
            continue
        at = bisect.bisect_right(times, t)
        near = [i for i in (at - 1, at) if 0 <= i < len(times) and abs(times[i] - t) <= HOLD_S]
        if not near:
            continue
        # Both samples around t and the box between them: a face moving between samples stays covered on its way.
        drawn = [boxes[i] for i in near]
        if len(near) == 2 and times[near[1]] > times[near[0]]:
            share = (t - times[near[0]]) / (times[near[1]] - times[near[0]])
            drawn.append([a + (b - a) * share for a, b in zip(*drawn)])
        for x, y, w, h in drawn:
            cv2.ellipse(mask, (round(x + w / 2), round(y + h / 2)), (round(w * PAD_W), round(h * PAD_H)), 0, 0, 360, 255, -1)
    return mask


def mask_key(samples, creator, *frames):
    """What draws a mask: anything blurred under it is redone when this changes."""
    return hashlib.sha256(json.dumps([MASK_FORMAT, samples, sorted(creator), *frames, list(pipeline.OUTPUT), HOLD_S, PAD_W, PAD_H]).encode()).hexdigest()


def write(video, samples, creator, segments, total):
    """mask/<video>.faces.mkv: the kept source frames (EDL segments, source frames) drawn, everything else black. Named for
    the edit, not its source: a reel keeps other frames than its full edit."""
    index = track_index(samples)

    def frames(first, count):
        for frame in range(first, first + count):
            yield draw(samples, frame / pipeline.FPS, creator, index=index)

    runs = sorted({(segment["in"], segment["out"] - segment["in"]) for segment in segments})
    out = pipeline.WORK / "mask" / f"{video}.faces.mkv"
    out.parent.mkdir(exist_ok=True)
    # A cue-only fix keeps the faces and cuts: the mask (minutes on a long edit) is reused, keyed on what draws it.
    key = mask_key(samples, creator, runs, total)
    key_file = out.with_suffix(".key")
    if out.is_file() and key_file.is_file() and key_file.read_text(encoding="utf-8") == key:
        return out
    key_file.unlink(missing_ok=True)
    matte.write_mask(out, total, [(first, count, frames(first, count)) for first, count in runs])
    key_file.write_text(key, encoding="utf-8")
    return out
