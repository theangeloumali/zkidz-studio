# Created by The Angelo Umali.
# make_covers (plan §6.8): HyperFrames stills of the edit at each time, then the cut spec's blur boxes live at that frame.
# Stills skip render_final's blur, so without this pass a cover would leak what the master hides.
import shutil
import string
import subprocess
from pathlib import Path

from .. import ffio, pipeline
from ..qc import inputs, timeline
from ..render import cue_sheet_names, render_stills
from ..specs import gates
from ..specs.gates import GateFailed

BLUR_SIGMA = 32  # on the 1080 grid; render_final's 64 is at 4K
GRID_WIDTH = 1080


def source_seconds(edited_s, edl):
    frame = timeline.source_frame(round(edited_s * timeline.rate(edl)), edl)
    if frame is None:
        raise ValueError(f"{edited_s:.2f} s is past the end of the edit")
    return frame / timeline.rate(edl)


def active_boxes(spec, at_s):
    """(x, y, w, h) on the 1080 grid of every box live at a source second, from either cut-spec form."""
    rows = spec.get("blur") or [[box["at"], box["end"], box["x"], box["y"], box["w"], box["h"], box["reason"]] for box in spec.get("blurBoxes", [])]
    return [tuple(row[2:6]) for row in rows if row[0] <= at_s < row[1]]


def cover_name(video, index):
    return f"{video}-cover-{string.ascii_lowercase[index]}.png"


def blur_command(still, out, boxes, width):
    """One crop -> gblur -> overlay per box over the still; a cover holds a handful of boxes, so the chain stays short."""
    scale = width / GRID_WIDTH
    placed = [tuple(round(value * scale / 2) * 2 for value in box) for box in boxes]
    labels = "".join(f"[b{index}]" for index in range(len(placed)))
    graph = [f"[0:v]split={len(placed) + 1}[base]{labels}"]
    current = "base"
    for index, (x, y, w, h) in enumerate(placed):
        graph.append(f"[b{index}]crop={w}:{h}:{x}:{y},gblur=sigma={BLUR_SIGMA * scale:g}[s{index}]")
        graph.append(f"[{current}][s{index}]overlay={x}:{y}:format=gbrp[o{index}]")
        current = f"o{index}"
    return [ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-y", "-i", str(still), "-filter_complex", ";".join(graph), "-map", f"[{current}]",
            "-frames:v", "1", str(out)]


def blur_still(still, out, boxes):
    if not boxes:
        shutil.copyfile(still, out)
        return
    width = int(subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", str(still)],
                               capture_output=True, text=True, check=True).stdout.strip())
    command = blur_command(still, out, boxes, width)
    gates.check_command(command)
    subprocess.run(command, check=True)


def draw_stills(video, times, names):
    """{time: png} of those cue sheets. --settled refuses a time that catches a title still animating in (a half-drawn rule
    and its ring read as a second node)."""
    folder = render_stills(video, names, [f"{at:g}" for at in times], "--settled")
    return {at: folder / f"t{at:g}.png" for at in times}


def make_covers(video, times, cover_sheet=None, draw_stills=draw_stills, work=None):
    """times: edited seconds. cover_sheet: the cover's own cues (the spec store's cues_cover file), drawn over the edit's."""
    work = work or pipeline.WORK
    spec = inputs.cut_spec_of(video, work)
    if spec is None:  # fail closed: no spec means no blur boxes, and the cover would show what the master hides
        raise GateFailed(f"{video} has no cut spec to take the blur from; call set_cuts first")
    names = cue_sheet_names(video, work)
    if cover_sheet:
        names.append(f"{video}-cover")
        copy = pipeline.derived_file(work, f"cues/{video}-cover.json")
        copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cover_sheet, copy)
    stills = draw_stills(video, times, names)
    edl = inputs.read_json(work / "edl" / f"{video}.json")
    (work / "covers").mkdir(exist_ok=True)
    made = []
    for index, at in enumerate(times):
        boxes = active_boxes(spec, source_seconds(at, edl))
        out = work / "covers" / cover_name(video, index)
        blur_still(Path(stills[at]), out, boxes)
        made.append({"path": out.relative_to(work).as_posix(), "at": at, "blurBoxes": len(boxes)})
    return made


def write_post_caption(video, text_path, work=None):
    """The post's caption.txt, written once per edit: a Reels cut (base in its EDL) shares its full edit's file."""
    work = work or pipeline.WORK
    lines = [line.rstrip() for line in Path(text_path).read_text(encoding="utf-8").splitlines()]
    text = "\n".join(lines).strip()
    if not text:
        raise GateFailed(f"{video}'s post caption is empty")
    base = inputs.read_json(work / "edl" / f"{video}.json", {}).get("base", video)
    out = work / "covers" / f"{base}-caption.txt"
    out.parent.mkdir(exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8", newline="\n")
    return out.relative_to(work).as_posix()
