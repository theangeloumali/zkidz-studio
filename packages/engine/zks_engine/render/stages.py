# Created by The Angelo Umali.
# The studio's engine step before the master: the edit stage (EDL, edit audio, music bed, captions). Ingest and transcribe live in cli.py.
# Each wraps the pipeline modules the CLI-era edits ran one by one, and answers with a small JSON-ready report.
import contextlib
import json
import os
import sys

from .. import audio, captions, edl, face_mask, faces, make_reels, music_bed, pipeline, render_final, speakers
from ..qc import learning
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
    rows = make_reels.merged([[item["at"], item["end"], *(["pin"] if item.get("pin") else [])] for item in keep], spec["duration"])
    target = pipeline.derived_file(work, f"cuts/{video}.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(make_reels.reel_spec(base, spec, rows), indent=1), encoding="utf-8")


def reel_base(video):
    """The full edit a Reels video is cut from, or None for a full edit."""
    return video[:-1] if video.endswith("r") and pipeline.spec_file(work_dir(), f"reels/{video[:-1]}.json").exists() else None


def edit_stage_files(video):
    """Every work-relative file edit_stage may write for this video. Not the face scan's cache (faces/<base>.speakers.json):
    it is keyed to the proxy, not the edit, and setting it aside made each preview rescan the whole source."""
    owner = reel_base(video) or video
    return [f"edl/{video}.json", f"edl/{video}.js", f"edl/{video}.csv", f"edl/{owner}.source.json", f"audio/{video}_edit.wav", f"audio/{video}_bed.wav",
            f"{pipeline.DERIVED}/cuts/{video}.json", f"{pipeline.DERIVED}/cues/{owner}.json", f"{pipeline.DERIVED}/cues/{video}-cc.json",
            f"faces/{video}.people.json", f"mask/{video}.faces.mkv"]


def people_stage(video, spec, segments, source_frames, write_mask=True):
    """#44 #45: who is on screen, from the kept footage. A learning edit of footage with anyone besides the speaker needs
    the creator's blur answer; `follow` frames each kept second without a reframe on whoever speaks; `blur_faces: others`
    writes the mask every face but the creator's is blurred under (mask/<video>.faces.mkv), except for a preview's stills."""
    asked = spec.get("follow") or spec.get("blur_faces") == "others"
    if not asked and (spec.get("blur_faces") or not learning.is_learning()):
        return spec
    base = spec.get("base", video)
    kept = [[segment["in"] / pipeline.FPS, segment["out"] / pipeline.FPS] for segment in segments]
    words = [{"at": at, "end": end, "text": text} for at, end, text in captions.transcript_words(base)]
    found = speakers.analyse(base, kept, words)
    others = {entry["track"] for sample in found["samples"] for entry in sample["faces"]} - set(found["creator"])
    if others and not spec.get("blur_faces"):
        raise GateFailed(f"{video}: the footage shows people besides the speaker; ask the user whether their faces are blurred, then set blurFaces")
    (pipeline.WORK / "faces" / f"{video}.people.json").write_text(json.dumps(found["identities"]), encoding="utf-8")
    band_at = lambda at: faces.recorded_band(pipeline.WORK, base, at) or [0, 0, *pipeline.OUTPUT]  # noqa: E731
    # A joined source can mix letterboxed and full-frame clips: only turns on a letterboxed one need a window.
    boxed = [turn for turn in found["turns"] if band_at(turn["at"])[3] < pipeline.OUTPUT[1]]
    if spec.get("follow") and boxed:
        spec = {**spec, "reframes": spec.get("reframes", []) + speakers.follow_reframes(boxed, band_at, spec.get("reframes", []))}
    if spec.get("blur_faces") == "others" and write_mask:
        face_mask.write(video, found["samples"], set(found["creator"]), segments, source_frames)
    return spec


def edit_stage(video, source, with_audio=True):
    """The EDL, the edit's -14 LUFS audio and its music bed, and, once set_captions wrote them, the caption cues (word captions
    for the learning theme), from the studio's cut spec.
    source: the file the cut spec's sourceAssetId names (the server resolves it). -> {frames, segments, captions}"""
    work = work_dir()
    base = reel_base(video)
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
        base = spec.get("base", video)
        segments, frames = edl.build(spec, pipeline.load_energy(work / "audio" / f"{base}.wav"), captions.word_spans(base))
        spec = people_stage(video, spec, segments, source_frames, write_mask=with_audio)
        edl.write_outputs(video, spec, segments, frames)
        if with_audio:
            audio.main(video)
            music_bed.main(video)
        caption_count = 0
        if pipeline.spec_file(work, f"captions/{video}.json").exists():
            captions.emit_cues(video, words=captions.word_style(work))
            caption_count = len(json.loads(pipeline.derived_file(work, f"cues/{video}-cc.json").read_text(encoding="utf-8")))
    return {"frames": frames, "segments": len(segments), "captions": caption_count}
