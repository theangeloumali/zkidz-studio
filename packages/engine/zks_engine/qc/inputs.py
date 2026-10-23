# Created by The Angelo Umali.
# What the QC gates read from the work dir: the EDL, the brand intro's insert, the cut spec and the cue sheet.
import json

from .. import pipeline

WORK = pipeline.WORK


def work():
    """Read at call time, so tests can point the gates at a scratch work dir."""
    return WORK


def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def load_edl(video):
    return read_json(work() / "edl" / f"{video}.json")


def cut_spec_of(video, work_dir=None):
    """The cut spec holding a video's blur and face-cam ranges; a Reels cut (v1r) without its own draws from its full edit's."""
    paths = [pipeline.spec_file(work_dir or work(), f"cuts/{name}.json") for name in ([video, video[:-1]] if video.endswith("r") else [video])]
    return next((read_json(path) for path in paths if path.exists()), None)


def load_spec(video):
    return cut_spec_of(video) or {}


def caption_cues(video):
    return [cue for cue in read_json(pipeline.spec_file(work(), f"cues/{video}.json"), []) if cue.get("kind") == "caption"]


def fps_of(edl):
    return edl["fps_num"], edl["fps_den"]


def intro_of(video, work_dir=None):
    """The brand intro's insert frame and length, from the SFX sheet; None for an edit without one."""
    intro = read_json((work_dir or work()) / "edl" / f"{video}.sfx.json", {}).get("intro")
    return {"at": intro["at"], "frames": intro["frames"]} if intro and isinstance(intro.get("at"), int) else None


def facecam_spans(spec):
    """Both cut-spec forms: the engine's positional `facecam` and the JSON spec's `faceCamRanges`."""
    return spec.get("facecam") or [[span["at"], span["end"]] for span in spec.get("faceCamRanges", [])]
