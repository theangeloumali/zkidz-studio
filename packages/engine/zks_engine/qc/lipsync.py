# Created by The Angelo Umali.
# Lip sync at each cut (herk gate 4): where the post-cut master frames match the source, and where its audio does.
# The two offsets must agree within half a frame, so a one-frame audio slip fails.
import numpy as np

REACH = 3  # frames searched each way
MATCH_FRAMES = 8
LEAD_IN = 2  # frames after the cut, past the audio crossfade
AUDIO_S = 0.5
SYNC_TOLERANCE = 0.5  # frames
MIN_CORRELATION = 0.3
DISTINCT = 0.6  # the best video match must beat the runner-up by this factor, or the shot is too still to time


def video_offset(master, source, reach=REACH):
    """master: n frames; source: n + 2*reach frames from `reach` before. (offset in frames, confident)."""
    count = len(master)
    errors = np.array([np.abs(source[shift:shift + count] - master).mean() for shift in range(2 * reach + 1)])
    best, runner_up = np.sort(errors)[:2]
    return int(np.argmin(errors)) - reach, bool(best < DISTINCT * runner_up)


def audio_offset(master, source, rate, reach_s, fps):
    """master: samples; source: the same span plus reach_s each side. (offset in frames, confident)."""
    reach = (len(source) - len(master)) // 2
    centred = master - master.mean()
    products = np.correlate(source - source.mean(), centred, "valid")
    energy = np.convolve((source - source.mean()) ** 2, np.ones(len(master)), "valid")
    scores = products / np.sqrt(np.maximum(energy * float(centred @ centred), 1e-12))
    best = int(np.argmax(scores))
    return (best - reach) / rate * fps, bool(scores[best] > MIN_CORRELATION)


def is_slipped(video_offset, audio_offset):
    return abs(audio_offset - video_offset) >= SYNC_TOLERANCE
