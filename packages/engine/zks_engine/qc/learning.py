# Created by The Angelo Umali.
# The learning theme's gates on the cue sheet (v2-vlog "max creativity"): a new visual every 2 s in the hook and 4 s in the
# body, and no technique over 30 % of the headline beats or three in a row. Other themes skip them.
import functools
import json
import math
import subprocess

from .. import pipeline
from ..pipeline import HF_DIR, cue_spans
from ..specs.gates import GateFailed
from . import face_gates, inputs, map_gates, people_gates, text_gates, timeline

THEME = "learning"
LIMITS = {"hook": 2.0, "body": 4.0}  # longest stretch without a new visual (s)
HOOK_SECONDS = 14  # the hook of an edit with no brand intro (s)
VARIETY_SHARE, VARIETY_RUN = 0.30, 3
NOT_BEATS = ("caption", "chipRail", "paperScene")  # labels and grounds that ride along with the headline device
BIG_WORD_MOVES = (("strikeAt", "strike"), ("scribbleAt", "scribble"), ("drop", "drop"), ("tumble", "tumble"), ("count", "count"),
                  ("steps", "count"), ("slot", "slot"))
SHEET_SCRIPT = ("const [cuesJs, introJs, work, ...names] = process.argv.slice(1);"
                "try { const { loadCueSheet } = require(cuesJs); const { INTRO } = require(introJs);"
                "console.log(JSON.stringify({ cues: loadCueSheet(work, names), split: INTRO.split })); }"
                "catch (error) { process.stderr.write(error.message); process.exit(1); }")


def is_learning():
    style = inputs.read_json(pipeline.spec_file(inputs.work(), "style.json"), {})
    return isinstance(style, dict) and style.get("theme") == THEME


def load_sheet(video):
    """(cues in source seconds, the brand intro's split in seconds), read by hf's own loader so patches apply as render.js does."""
    from ..render import cue_sheet_names  # render imports qc, so this waits for call time

    work = inputs.work()
    scripts = [str(HF_DIR / "cues.js"), str(HF_DIR / "components" / "intro.js")]
    result = subprocess.run(["node", "-e", SHEET_SCRIPT, *scripts, str(work), *cue_sheet_names(video, work)], capture_output=True, text=True)
    if result.returncode:
        raise GateFailed(f"the cue sheet would not load: {result.stderr.strip() or 'node failed'}")
    sheet = json.loads(result.stdout)
    return sheet["cues"], sheet["split"]


def visual_events(events, edl, cues=()):
    """Edited times where something new appears: every sound the build gave a cue, every cue start (a tumble bigWord
    makes no sound), and every zoom."""
    times = [time for event in events for time in (event["time"], event["cueStart"])]
    shown = [cue for cue in cues if cue["kind"] != "caption"]  # captions ride along with the speech, not new visuals
    times += [spans[0][0] for cue in shown if (spans := cue_spans(cue["at"], cue.get("end", cue["at"] + 0.1), edl))]
    times += [zoom["start"] / timeline.rate(edl) for zoom in edl.get("zooms", [])]
    return sorted({round(time, 6) for time in times})


def gaps_by_part(times, hook_end, total):
    """Every gap in the hook and in the body as (gap, start), longest (then earliest) first; a gap belongs to the part it starts in, and the
    wait from the first frame counts, so an edit with no visuals fails."""
    points = [0, *times, total]
    gaps = {"hook": [], "body": []}
    for start, stop in zip(points, points[1:]):
        gaps["hook" if start < hook_end else "body"].append((stop - start, start))
    return {part: sorted(found, key=lambda gap: (-gap[0], gap[1])) or [(0, 0)] for part, found in gaps.items()}


def hook_end(intro, edl):
    """Where the hook ends (s): the brand intro's insert, else HOOK_SECONDS, never past the edit (films d176181)."""
    total = edl["frames"] / timeline.rate(edl)
    return min(intro["at"] / timeline.rate(edl) if intro else HOOK_SECONDS, total)


def density_problems(events, edl, cues=(), intro=None):
    """Every gap over its part's limit, so one refusal names all of them, not one per render."""
    times = visual_events(events, edl, cues)
    gaps = gaps_by_part(times, hook_end(intro, edl), edl["frames"] / timeline.rate(edl))
    problems = []
    for part, found in gaps.items():
        over = [(gap, start) for gap, start in found if gap > LIMITS[part]]
        if over:
            (gap, start), rest = over[0], over[1:]
            also = f"; also {', '.join(f'{gap:.2f}s from {start:.2f}s' for gap, start in rest)}" if rest else ""
            problems.append(f"{part}: longest gap {gap:.2f}s from {start:.2f}s (limit {LIMITS[part]}s){also}")
    summary = ", ".join(f"{part} longest gap {found[0][0]:.2f}s" for part, found in gaps.items())
    return problems, f"{summary} ({len(times)} visual events)"


def technique(cue):
    if cue["kind"] != "bigWord":
        return cue["kind"]
    return "bigWord:" + next((move for field, move in BIG_WORD_MOVES if cue.get(field)), "rise")


def beats(cues, edl):
    """The headline beats in edit order as (edited seconds, technique): every cue but labels and grounds, and each zoom."""
    found = []
    for cue in cues:
        if cue["kind"] in NOT_BEATS:
            continue
        if spans := cue_spans(cue["at"], cue.get("end", cue["at"] + 0.1), edl):
            found.append((round(spans[0][0], 2), technique(cue)))
    found += [(round(zoom["start"] / timeline.rate(edl), 2), f"zoom:{zoom['preset']}") for zoom in edl.get("zooms", [])]
    return sorted(found)


def variety_problems(beat_list):
    names = [name for _, name in beat_list]
    if not names:
        return ["no headline beats"], "no headline beats"
    top = max(set(names), key=names.count)
    share = names.count(top) / len(names)
    run = next((index for index in range(len(names) - VARIETY_RUN + 1) if len(set(names[index:index + VARIETY_RUN])) == 1), None)
    problems = [f"{top} {share:.0%} of beats"] if share > VARIETY_SHARE else []
    problems += [f"{names[run]} three in a row from {beat_list[run][0]}s"] if run is not None else []
    return problems, f"{len(names)} beats, {len(set(names))} techniques, top {top} {share:.0%}"


def check_sheet(video):
    """render_master's refusal before any frame is drawn: density and variety need only the EDL, the SFX sheet and the
    cues, so a thin sheet fails here in seconds instead of after a full render and a QC."""
    edl, cues = inputs.load_edl(video), load_sheet(video)[0]
    events = inputs.read_json(inputs.work() / "edl" / f"{video}.sfx.json", {}).get("events", [])
    found = [(name, problems) for name, (problems, _) in (("density", density_problems(events, edl, cues, inputs.intro_of(video))),
                                                         ("variety", variety_problems(beats(cues, edl)))) if problems]
    if found:
        raise GateFailed("; ".join(f"{name} ({'; '.join(problems)})" for name, problems in found) + "; fix the cue sheet, then render again")


def gates(video, master, edl, intro):
    """The learning gates for qc_master; the sheet and the master's faces are read once, by whichever gate runs first."""
    sheet = functools.cache(lambda: load_sheet(video))
    found = functools.cache(lambda: face_gates.master_faces(master, frosted_out=bool(edl.get("faces"))))  # his face is never blurred
    events = inputs.read_json(inputs.work() / "edl" / f"{video}.sfx.json", {}).get("events", [])
    # build.js splitFrames: one frame past the split, when the halves have cleared.
    split_frames = lambda: math.ceil(sheet()[1] * timeline.rate(edl)) + 1
    return {
        "density": lambda: density_problems(events, edl, sheet()[0], intro),
        "variety": lambda: variety_problems(beats(sheet()[0], edl)),
        "faceClear": lambda: face_gates.face_clear_problems(video, sheet()[0], edl, intro, split_frames(), found()),
        "faceWidth": lambda: face_gates.face_width_problems(found()),
        "textClear": lambda: text_gates.text_clear_problems(text_gates.load_boxes(video)),
        "map": lambda: map_gates.map_problems(map_gates.raw_clips(video, edl), inputs.load_spec(video).get("places", []), sheet()[0]),
        **people_gates.gates(video, master, edl, lambda: sheet()[0]),
    }
