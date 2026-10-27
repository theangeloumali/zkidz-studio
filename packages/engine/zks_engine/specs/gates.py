# Created by The Angelo Umali.
# The §7.6 traps as gates the render step calls; each raises GateFailed with what to fix.
import hashlib
import re
from pathlib import Path

AUDIO_RATE = 48000
NTSC = (30000, 1001)
TARGET_LUFS, LUFS_TOLERANCE, MAX_TRUE_PEAK = -14.0, 1.0, -1.0
BOUNDED = ("-t", "-frames:v", "-frames", "-to")
GRAPH_OPTIONS = ("-filter_complex", "-vf", "-af", "-filter:v", "-filter:a")
MAX_CAPTION_LINES = 2


class GateFailed(RuntimeError):
    """A render-blocking QC failure."""


def check_graph(graph):
    """Filter-graph lints for two traps: frames spaced 1.001 s on 1/1000 sources, and racing CUDA contexts."""
    if re.search(r"setpts\s*=\s*N\s*\*", graph):
        raise GateFailed("setpts=N*… is only right in a 1/30000 time base; restamp with settb=1001/30000,setpts=N")
    if "hwupload_cuda" in graph and "overlay_cuda" in graph:
        raise GateFailed("hwupload_cuda and overlay_cuda in one graph race their CUDA contexts; let the backend builder own device setup")


def input_groups(args):
    """(options, input) per `-i`: ffmpeg input options apply only to the next -i, then reset."""
    groups, options = [], []
    for index, arg in enumerate(args):
        if arg == "-i" and index + 1 < len(args):
            groups.append((options, args[index + 1]))
            options = []
        elif index == 0 or args[index - 1] != "-i":
            options.append(arg)
    return groups


def check_looping_inputs(args):
    """A looping still with no -framerate defaults to 25 fps and froze ep25's footage; one with no bound never ends."""
    for options, source in input_groups(args):
        if "-loop" in options and options[options.index("-loop") + 1] != "0":
            if "-framerate" not in options:
                raise GateFailed(f"looping input {source} needs -framerate set to the footage rate before its -i")
            if not any(flag in options for flag in BOUNDED):
                raise GateFailed(f"looping input {source} must be bounded (-t or -frames) before its -i")


def check_command(args):
    """Every graph and looping input of one ffmpeg command; the engine calls it on each command before spawning it."""
    for option, value in zip(args, args[1:]):
        if option in GRAPH_OPTIONS:
            check_graph(value)
    check_looping_inputs(args)


def check_counts(edl_frames, overlay_frames, audio_samples, fps=NTSC, audio_rate=AUDIO_RATE):
    if overlay_frames != edl_frames:
        raise GateFailed(f"overlay has {overlay_frames} frames; the edit has {edl_frames}")
    expected = round(edl_frames * audio_rate * fps[1] / fps[0])
    if audio_samples != expected:
        raise GateFailed(f"audio has {audio_samples} samples; {edl_frames} frames need {expected}")


def check_loudness(lufs, true_peak):
    if abs(lufs - TARGET_LUFS) > LUFS_TOLERANCE:
        raise GateFailed(f"master is {lufs:.1f} LUFS; it must be {TARGET_LUFS:g} ±{LUFS_TOLERANCE:g}")
    if true_peak > MAX_TRUE_PEAK:
        raise GateFailed(f"master true peak is {true_peak:.1f} dBTP; it must be ≤ {MAX_TRUE_PEAK:g}")


def check_captions(entries, phrases):
    """A group whose phrases sit in different reel keeps (or FULL-only beside a keep) straddles a keep edge; text wider than
    the plate's two lines, by its font metrics, wraps to a third. Phrase ids are positions in the phrase file."""
    from ..captions import line_count  # captions.py runs this gate, so its import must wait

    for entry in entries:
        unknown = [phrase_id for phrase_id in entry["ids"] if not 0 <= phrase_id < len(phrases)]
        if unknown:
            raise GateFailed(f"caption ids {unknown} are not phrases of this edit")
        if len({phrases[phrase_id]["reel"] for phrase_id in entry["ids"]}) > 1:
            raise GateFailed(f"caption ids {entry['ids']} cross a Reels keep edge")
        if (lines := line_count(entry.get("en", ""))) > MAX_CAPTION_LINES:
            raise GateFailed(f"caption ids {entry['ids']} wrap to {lines} lines: {entry['en'].strip()!r}; split it")


def snapshot(paths):
    """Content hash of the spec set at job start; the job renders this snapshot, never specs an agent is still writing."""
    digest = hashlib.sha256()
    for path in sorted(map(Path, paths)):
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def check_snapshot(paths, expected):
    if snapshot(paths) != expected:
        raise GateFailed("spec files changed after the render snapshot; re-run the job on the new specs")


def check_no_pid_probe(source, name):
    """A signal-0 os.kill probe terminates the process on Windows instead of probing it."""
    if re.search(r"os\.kill\([^,()]+,\s*0\s*\)", source):
        raise GateFailed(f"{name}: a signal-0 os.kill probe kills on Windows; use slots.alive()")
