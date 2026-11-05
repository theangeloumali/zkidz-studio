# Created by The Angelo Umali.
# Builds a frame-exact edit decision list from a hand-written cut spec.
# Usage: python -m zks_engine.edl v1   (reads cuts/v1.json, writes edl/v1.json, edl/v1.js, edl/v1.csv)
import csv
import json
import sys

import numpy as np

from .pipeline import ENERGY_WINDOW, FPS, FPS_DEN, FPS_NUM, OUTPUT, WORK, load_cuts, load_energy, map_interval

SNAP_RADIUS = 0.15  # seconds searched either side of a cut for the quietest window
FACECAM_ZOOM = 1.08
FACECAM_SLACK_FRAMES = 1
MIN_SEGMENT = 0.2
WORD_PAD = 0.06  # whisper's word starts run up to ~0.1 s late: an edge moved off a word stops this far clear of it
# The one definition of the punch-in: both renderers apply it verbatim, at 4K or at 1080p.
# Crop biased 110/3840 of the height upward so the face stays centred.
PUNCH_TOP = 110 / 3840  # the punch-in window sits this fraction of the frame height from the top
PUNCH_CROP = f"crop=w=round(iw/{FACECAM_ZOOM}/2)*2:h=round(ih/{FACECAM_ZOOM}/2)*2:x=(iw-ow)/2:y=round(ih*{PUNCH_TOP * 3840:g}/3840)"


def quietest(energy_db, seconds):
    low = max(0, int((seconds - SNAP_RADIUS) / ENERGY_WINDOW))
    high = min(len(energy_db), int((seconds + SNAP_RADIUS) / ENERGY_WINDOW) + 1)
    return (low + int(np.argmin(energy_db[low:high]))) * ENERGY_WINDOW


def overlaps(start, end, ranges):
    return any(start < range_end and end > range_start for range_start, range_end in ranges)


def quiet_runs(energy_db, threshold_db):
    """(first, end) energy-window indexes of each run below threshold_db, end exclusive."""
    runs, run_start = [], None
    for index, is_quiet in enumerate(np.append(energy_db < threshold_db, False)):
        if is_quiet and run_start is None:
            run_start = index
        elif not is_quiet and run_start is not None:
            runs.append((run_start, index))
            run_start = None
    return runs


def word_free(start, end, words):
    """The stretches of [start, end] no word overlaps: a soft 'oo' or 'ah' can sit below the pause threshold."""
    stretches, cursor = [], start
    for at, word_end in sorted(words):
        if word_end > cursor and at < end:
            if at > cursor:
                stretches.append((cursor, at))
            cursor = max(cursor, word_end)
    return stretches + ([(cursor, end)] if cursor < end else [])


def find_pauses(energy_db, spec, removals, words=()):
    """Long pauses inside kept talk get their middle removed, leaving `keep` seconds of air, around any word in them."""
    rule = spec["trim_pauses"]
    pauses = []
    for first, last in quiet_runs(energy_db, rule["threshold_db"]):
        for start, end in word_free(first * ENERGY_WINDOW, last * ENERGY_WINDOW, words):
            if end - start < rule["min"] or overlaps(start, end, rule["exclude"] + removals):
                continue
            half = rule["keep"] / 2
            pauses.append([start + half, end - half, f"pause {end - start:.2f}s"])
    return pauses


def padded(words):
    """Each word widened by WORD_PAD, or half the gap to its neighbour when that is less: never joined, so an edge moved
    off a word goes at most to the middle of a gap, never to the end of a sentence."""
    ordered = sorted(words)
    spans = []
    for index, (at, end) in enumerate(ordered):
        before = at - ordered[index - 1][1] if index else WORD_PAD * 2
        after = ordered[index + 1][0] - end if index + 1 < len(ordered) else WORD_PAD * 2
        spans.append((at - min(WORD_PAD, max(0.0, before) / 2), end + min(WORD_PAD, max(0.0, after) / 2)))
    return spans


def off_words(seconds, spans):
    """`seconds`, or the nearer edge of the padded word it falls inside: a cut keeps a word whole or removes it whole."""
    inside = next(((at, end) for at, end in spans if at < seconds < end), None)
    return seconds if inside is None else min(inside, key=lambda edge: abs(edge - seconds))


def snap_removal(energy_db, start, end, reason, *flags, words=()):
    """Each edge snaps to the quietest window, or stays where it was written under a "pin" flag; either way, off any word."""
    if "pin" not in flags:
        start, end = quietest(energy_db, start), quietest(energy_db, end)
    return off_words(start, words), off_words(end, words), reason


def on_facecam(segment, facecam):
    """The whole segment, not its midpoint: a screen shot sharing a segment with face-cam must not be zoomed.
    Range edges are hand-typed, so one frame of slack absorbs rounding (e.g. a range ending 0.04 s before the file)."""
    slack = FACECAM_SLACK_FRAMES
    return any(round(start * FPS) - slack <= segment["in"] and segment["out"] <= round(end * FPS) + slack for start, end in facecam)


def build(spec, energy_db, words=()):
    """words: [(at, end)] of the transcript, in source seconds; no cut lands inside one (QC's cutWords)."""
    snapped = [snap_removal(energy_db, *removal, words=padded(words)) for removal in spec["remove"]]
    # A removal shorter than 2*SNAP_RADIUS can snap inverted; clamp so it never replays frames.
    removals = [[start, max(start, end), reason] for start, end, reason in snapped]
    removals += find_pauses(energy_db, spec, [[start, end] for start, end, _ in removals], words)
    removals.sort()

    total_frames = int(round(spec["duration"] * FPS))
    segments, cursor = [], 0
    for start, end, reason in removals:
        cut_in, cut_out = int(round(start * FPS)), int(round(end * FPS))
        if cut_in > cursor:
            segments.append({"in": cursor, "out": cut_in, "cut_after": reason})
        cursor = max(cursor, cut_out)
    segments.append({"in": cursor, "out": total_frames, "cut_after": None})
    # A sliver under MIN_SEGMENT holds no word, only a visible flash between two cuts.
    segments = [segment for segment in segments if segment["out"] - segment["in"] >= MIN_SEGMENT * FPS]
    assert all(a["out"] <= b["in"] for a, b in zip(segments, segments[1:])), "EDL segments overlap"

    # Alternate punch-in across jump cuts inside a face-cam run so each cut reads as deliberate.
    previous_zoom, previous_facecam, target = 1.0, False, 0
    for segment in segments:
        is_facecam = on_facecam(segment, spec["facecam"])
        segment["zoom"] = (FACECAM_ZOOM if previous_zoom == 1.0 else 1.0) if is_facecam and previous_facecam else 1.0
        segment["facecam"] = is_facecam
        segment["target"] = target
        previous_zoom, previous_facecam = segment["zoom"], is_facecam
        target += segment["out"] - segment["in"]
    return segments, target


def pin_cutaways(cutaways, segments):
    """A cutaway authored at a cut starts on that cut's first kept frame, so no removed footage shows before it."""
    pinned = []
    for cutaway in cutaways:
        nearest = min(segments, key=lambda segment: abs(segment["in"] / FPS - cutaway["at"]))
        # The cut may move SNAP_RADIUS to a quiet point, then up to a frame onto the frame grid.
        at = nearest["in"] / FPS if abs(nearest["in"] / FPS - cutaway["at"]) <= SNAP_RADIUS + 2 / FPS else cutaway["at"]
        pinned.append({**cutaway, "at": at})
    return pinned


# Animated footage zooms render_final knows (zoom_factor); a cut-spec entry is [at, end, preset, cx?, cy?] in source seconds.
ZOOM_PRESETS = ("snap", "push", "lean", "reveal", "through-out", "through-in", "portal")
ZOOM_CENTRE = (0.5, PUNCH_TOP + 0.5 / FACECAM_ZOOM)  # the punch-in's framing, so a zoom on face-cam keeps the face placed


def edited_window(at, end, segments):
    """A source-seconds window as edited frames {start, end}: one crossing a cut spans both sides; None when nothing is kept."""
    timeline = {"fps_num": FPS_NUM, "fps_den": FPS_DEN, "segments": segments}
    spans = [span for span in map_interval(at, end, timeline) if round(span[1] * FPS) > round(span[0] * FPS)]
    return {"start": round(spans[0][0] * FPS), "end": round(spans[-1][1] * FPS)} if spans else None


def map_zooms(zooms, segments):
    mapped = []
    for at, end, preset, *centre in zooms:
        if preset not in ZOOM_PRESETS:
            sys.exit(f"zoom preset {preset!r} at {at}s is not one of {', '.join(ZOOM_PRESETS)}")
        if window := edited_window(at, end, segments):
            cx, cy = (list(centre) + list(ZOOM_CENTRE)[len(centre):])[:2]
            mapped.append({**window, "preset": preset, "cx": cx, "cy": cy})
    return mapped


def map_windows(windows, segments):
    """Matte windows (person-mask spans for the depth layer) as edited frames."""
    return [window for at, end in windows if (window := edited_window(at, end, segments))]


def map_focus(windows, segments):
    """Rack-focus windows [at, end, blur] (source seconds, blur in px on the 1080 grid) as edited frames."""
    return [{**window, "blur": blur} for at, end, blur in windows if (window := edited_window(at, end, segments))]


def map_reframes(reframes, segments):
    """Reframes [at, end, cx, cy, scale] as edited frames; render_final turns each into a crop of the source's picture band."""
    return [{**window, "cx": cx, "cy": cy, "scale": scale} for at, end, cx, cy, scale in reframes if (window := edited_window(at, end, segments))]


def map_portals(portals, segments):
    """A portal [at, end, x1, y1, ... x4, y4] (screen corners on the 1080 grid) becomes a zoom on the screen's centre that
    reaches the scale where the screen fills the frame; the insert that starts at `end` takes over on the cut."""
    zooms = []
    for at, end, *corners in portals:
        xs, ys = corners[0::2], corners[1::2]
        width, height = max(xs) - min(xs), max(ys) - min(ys)
        centre = ((min(xs) + max(xs)) / 2 / OUTPUT[0], (min(ys) + max(ys)) / 2 / OUTPUT[1])
        for zoom in map_zooms([[at, end, "portal", *centre]], segments):
            zooms.append({**zoom, "to": min(OUTPUT[0] / width, OUTPUT[1] / height)})
    return zooms


def write_outputs(video, spec, segments, frames):
    out_dir = WORK / "edl"
    out_dir.mkdir(exist_ok=True)
    bleeps = [{"at": start, "end": end, "x": x, "y": y} for start, end, x, y in spec.get("bleep", [])]
    # A Reels cut reuses its full edit's prepared audio and proxy (`base`); `reel` arms the overlay's cue clamp.
    payload = {"fps_num": FPS_NUM, "fps_den": FPS_DEN, "frames": frames, "punch_crop": PUNCH_CROP, "base": spec.get("base", video),
               "reel": bool(spec.get("reel")), "cutaways": pin_cutaways(spec.get("cutaways", []), segments), "bleeps": bleeps,
               "zooms": map_zooms(spec.get("zooms", []), segments) + map_portals(spec.get("portals", []), segments),
               "matte": map_windows(spec.get("matte", []), segments), "focus": map_focus(spec.get("focus", []), segments),
               "grade": spec.get("grade", "house"), "reframes": map_reframes(spec.get("reframes", []), segments), "segments": segments,
               "faces": f"mask/{video}.faces.mkv" if spec.get("blur_faces") == "others" else None}
    (out_dir / f"{video}.json").write_text(json.dumps(payload, indent=1), encoding="utf-8")
    (out_dir / f"{video}.js").write_text(f"window.EDL = {json.dumps(payload)};\n", encoding="utf-8")
    with open(out_dir / f"{video}.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["source_start", "source_end", "target_start", "reason_for_following_cut", "speed", "zoom", "audio_intent"])
        for segment in segments:
            writer.writerow([f"{segment['in'] / FPS:.3f}", f"{segment['out'] / FPS:.3f}", f"{segment['target'] / FPS:.3f}",
                             segment["cut_after"] or "end", "1.0", segment["zoom"], "dialogue + source ambience, 10 ms crossfade"])


if __name__ == "__main__":
    video_name = sys.argv[1]
    video_spec = load_cuts(video_name)
    video_segments, kept = build(video_spec, load_energy(WORK / "audio" / f"{video_spec.get('base', video_name)}.wav"))
    write_outputs(video_name, video_spec, video_segments, kept)
    removed = video_spec["duration"] - kept / FPS
    print(f"{video_name}: {len(video_segments)} segments, kept {kept / FPS:.2f}s of {video_spec['duration']:.2f}s (removed {removed:.2f}s)")
