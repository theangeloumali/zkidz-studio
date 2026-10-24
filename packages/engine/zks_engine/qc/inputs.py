# Created by The Angelo Umali.
# What the QC gates read from the work dir: the EDL, the brand intro's insert, the cut spec and the cue sheet.
import hashlib
import json
from pathlib import Path

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
    """Captions from the video's own sheet and the caption sheet the edit stage derives (<base>-cc), which hf draws last."""
    base = (load_edl(video) or {}).get("base", video)
    sheets = [read_json(pipeline.spec_file(work(), f"cues/{name}.json"), []) for name in (video, f"{base}-cc")]
    return [cue for sheet in sheets for cue in sheet if isinstance(cue, dict) and cue.get("kind") == "caption"]


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def render_inputs(video, work_dir=None):
    """{work-relative path: sha256} of every engine-written file QC reads for a video. render_master records it after the encode,
    and QC refuses a live set that differs: a later render's edit stage rewrites them even when it never reaches its encode."""
    folder = work_dir or work()
    base = (read_json(folder / "edl" / f"{video}.json") or {}).get("base", video)
    names = [f"edl/{video}.json", f"edl/{video}.sfx.json", f"edl/{base}.source.json", f"{pipeline.DERIVED}/cuts/{video}.json",
             f"{pipeline.DERIVED}/cues/{base}.json", f"{pipeline.DERIVED}/cues/{base}-cc.json"]
    found = {name: file_sha256(folder / name) for name in names if (folder / name).is_file()}
    frames = folder / "frames" / video
    if frames.is_dir():  # the mouth gate reads these; their listing stands in for hashing every PNG
        listing = sorted((entry.name, entry.stat().st_size, entry.stat().st_mtime_ns) for entry in frames.iterdir())
        found[f"frames/{video}/"] = hashlib.sha256(json.dumps(listing).encode("utf-8")).hexdigest()
    return found


def render_input_problems(recorded, live):
    changed = sorted(name for name in recorded.keys() | live.keys() if recorded.get(name) != live.get(name))
    return [f"{', '.join(changed)} changed since the render that made this master"] if changed else []


def fps_of(edl):
    return edl["fps_num"], edl["fps_den"]


def intro_of(video, work_dir=None):
    """The brand intro's insert frame and length, from the SFX sheet; None for an edit without one."""
    intro = read_json((work_dir or work()) / "edl" / f"{video}.sfx.json", {}).get("intro")
    return {"at": intro["at"], "frames": intro["frames"]} if intro and isinstance(intro.get("at"), int) else None


def facecam_spans(spec):
    """Both cut-spec forms: the engine's positional `facecam` and the JSON spec's `faceCamRanges`."""
    return spec.get("facecam") or [[span["at"], span["end"]] for span in spec.get("faceCamRanges", [])]
