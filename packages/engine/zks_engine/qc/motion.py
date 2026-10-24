# Created by The Angelo Umali.
# The moving-footage gate (ep25): a shot whose original moves but whose rendered subject is frozen fails the edit.
import numpy as np

MIN_SHOT_FRAMES = 45
SAMPLES, STRIDE = 12, 2
# ASSUMPTION: the subject sits mid-frame on the 1080x1920 grid, between the cards' top band (to y 880) and the caption plates
# (from y 1280 at the legacy bottom 1430), so overlays add neither motion nor match error here.
SUBJECT_REGION = (240, 880, 600, 380)
MOVING_ORIGINAL = 0.1  # mean |frame diff| (0-255) above which the original counts as moving
FROZEN_RATIO, FROZEN_CHANGE = 0.15, 0.04


def motion_stats(frames):
    """raw: mean pixel change; structural: change after normalising each frame, so a fade or grade does not count."""
    raw = float(np.abs(np.diff(frames, axis=0)).mean())
    centred = frames - frames.mean(axis=(1, 2), keepdims=True)
    normalised = centred / np.maximum(1, centred.std(axis=(1, 2), keepdims=True))
    return {"raw": raw, "structural": float(np.abs(np.diff(normalised, axis=0)).mean())}


def is_frozen(reference, actual):
    """An original that does not move (an intentional still) never fails."""
    ratio = actual["structural"] / max(0.001, reference["structural"])
    return reference["raw"] > MOVING_ORIGINAL and (ratio < FROZEN_RATIO or actual["raw"] < FROZEN_CHANGE)


def shots(edl):
    return [seg for seg in edl["segments"] if seg["out"] - seg["in"] >= MIN_SHOT_FRAMES]


def sample_offset(length):
    """Frames into a shot where its sample starts: a third in, clear of the cut."""
    return max(0, min(length // 3, length - SAMPLES * STRIDE))
