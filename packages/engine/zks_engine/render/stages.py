# Created by The Angelo Umali.
# The studio's engine step before the master: the edit stage (EDL, edit audio, captions). Ingest and transcribe live in cli.py.
# Each wraps the pipeline modules the CLI-era edits ran one by one, and answers with a small JSON-ready report.
import contextlib
import json
import os
import sys
from pathlib import Path

from .. import audio, captions, edl, make_reels, pipeline, render_final
from ..specs import SpecError
from ..specs.gates import GateFailed


def work_dir():
    return pipeline.WORK


@contextlib.contextmanager
def engine_steps():
    """The pipeline modules print progress and sys.exit on failure: stdout must carry only the JSON report (fd 1 goes to stderr,
    children included), and an exit becomes a gate failure the CLI reports."""
    sys.stdout.flush()
    saved_stdout = os.dup(1)
    os.dup2(2, 1)
    try:
        yield
    except SystemExit as stop:
        raise GateFailed(str(stop.code)) from stop
    finally:
        sys.stdout.flush()
        os.dup2(saved_stdout, 1)
        os.close(saved_stdout)


def write_reel_cuts(video, base):
    """derived/cuts/<v>r.json from the base's spec narrowed to set_reel's keep ranges, as make_reels.py builds it."""
    work = work_dir()
    keep = json.loads(pipeline.spec_file(work, f"reels/{base}.json").read_text(encoding="utf-8"))["keep"]
    spec = pipeline.load_cuts(base)
    rows = make_reels.merged([[item["at"], item["end"]] for item in keep], spec["duration"])
    target = pipeline.derived_file(work, f"cuts/{video}.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(make_reels.reel_spec(base, spec, rows), indent=1), encoding="utf-8")


def edit_stage(video, source):
    """The EDL, the edit's -14 LUFS audio and, once set_captions wrote them, the caption cues, from the studio's cut spec.
    source: the file the cut spec's sourceAssetId names (the server resolves it). -> {frames, segments, captions}"""
    work = work_dir()
    base = video[:-1] if video.endswith("r") and pipeline.spec_file(work, f"reels/{video[:-1]}.json").exists() else None
    spec_owner = base or video
    if not pipeline.spec_file(work, f"cuts/{spec_owner}.json").exists():
        raise SpecError(f"{spec_owner} has no cut spec; call set_cuts first")
    source_path = str(pipeline.command_input(source))
    pipeline.source_record(spec_owner).parent.mkdir(exist_ok=True)
    pipeline.source_record(spec_owner).write_text(json.dumps({"source": source_path}), encoding="utf-8")
    if not pipeline.spec_file(work, f"cues/{spec_owner}.json").exists():  # render.js needs the main sheet even before add_cue wrote one
        placeholder = pipeline.derived_file(work, f"cues/{spec_owner}.json")
        placeholder.parent.mkdir(parents=True, exist_ok=True)
        placeholder.write_text("[]", encoding="utf-8")
    if base:
        write_reel_cuts(video, base)
    spec = pipeline.load_cuts(video)
    # The spec's durationS is the clip's rounded length; an EDL past the source's last frame fails the master's frame gate.
    source_frames = render_final.count_frames(pipeline.source_path(spec))
    spec = {**spec, "duration": min(spec["duration"], source_frames / pipeline.FPS)}
    with engine_steps():
        segments, frames = edl.build(spec, pipeline.load_energy(work / "audio" / f"{spec.get('base', video)}.wav"))
        edl.write_outputs(video, spec, segments, frames)
        audio.main(video)
        caption_count = 0
        if pipeline.spec_file(work, f"captions/{video}.json").exists():
            captions.emit_cues(video)
            caption_count = len(json.loads(pipeline.derived_file(work, f"cues/{video}-cc.json").read_text(encoding="utf-8")))
    return {"frames": frames, "segments": len(segments), "captions": caption_count}
