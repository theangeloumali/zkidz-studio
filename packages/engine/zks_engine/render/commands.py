# Created by The Angelo Umali.
# The studio's engine CLI commands after ingest and transcribe (cli.py): edit, render-master, qc-master, check-motion,
# make-covers and qc-status, each printing one JSON report.
# Every path argument must sit under the project (pipeline.command_input), like a spec path.
import contextlib
import json
import os

from .. import covers, pipeline, qc
from ..pipeline import command_input, snapshot_input
from ..qc.motion import SUBJECT_REGION
from ..specs.gates import GateFailed
from . import render_master, stages
from .stages import engine_steps

QUALITIES = ("draft", "final", "4k")


def clip_at(value):
    """PATH@SECONDS: an original clip and the source second where the join starts it."""
    path, _, at = value.rpartition("@")
    return command_input(path), float(at)


def region_box(value):
    """x,y,w,h on the 1080x1920 grid."""
    x, y, w, h = (int(part) for part in value.split(","))
    return x, y, w, h


def edit_payload(args):
    return stages.edit_stage(args.video, args.source)


def render_master_payload(args):
    with engine_steps():
        return render_master(args.video, args.quality, args.source)


def work_input(path, folder=None):
    """A work-relative (or absolute) path from the server, under the project like a spec path, and under work/<folder> if named."""
    resolved = pipeline.project_input(pipeline.WORK / path)
    if folder and pipeline.WORK.resolve() / folder not in resolved.parents:
        raise GateFailed(f"{path} is not under work/{folder}")
    return resolved


def specs_snapshot(value):
    """The render job's own spec snapshot (snapshots/<sha>): QC judges the specs the master was drawn from, not the live ones."""
    folder = work_input(value, "snapshots")
    if not folder.is_dir():
        raise GateFailed(f"spec snapshot {value} does not exist")
    return folder


def render_inputs_arg(value):
    """The render report's inputs, passed back verbatim: {work-relative path: sha256}."""
    try:
        recorded = json.loads(value)
    except json.JSONDecodeError as error:
        raise GateFailed(f"--render-inputs is not JSON: {error}") from error
    if not isinstance(recorded, dict) or not all(isinstance(key, str) and isinstance(digest, str) for key, digest in recorded.items()):
        raise GateFailed("--render-inputs must be a JSON object of path -> sha256")
    return recorded


@contextlib.contextmanager
def reading_specs(folder):
    saved = os.environ.get("ZKS_SPECS")
    os.environ["ZKS_SPECS"] = str(folder)
    try:
        yield
    finally:
        if saved is None:
            os.environ.pop("ZKS_SPECS", None)
        else:
            os.environ["ZKS_SPECS"] = saved


def qc_master_payload(args):
    """Judges exactly the master, source and spec snapshot the server names; never "the latest master" or the live cut spec."""
    master, source, snapshot = work_input(args.master, "out"), work_input(args.source), specs_snapshot(args.specs)
    if not master.is_file():
        raise GateFailed(f"{args.master} does not exist")
    words = json.loads(command_input(args.words).read_text(encoding="utf-8"))
    recorded = render_inputs_arg(args.render_inputs)
    with reading_specs(snapshot):
        return qc.qc_master(args.video, master, source, words, qc.whisper_transcriber(args.language, args.model), qc.work_relative(snapshot), recorded)


def check_motion_payload(args):
    regions = args.region or [SUBJECT_REGION]
    if args.stage == "source":
        return qc.check_motion_source(command_input(args.source), args.clip, regions)
    return qc.check_motion_master(args.video, qc.latest_master(args.video), command_input(args.source), regions)


def make_covers_payload(args):
    sheet = snapshot_input(args.cover_sheet) if args.cover_sheet else None
    caption = snapshot_input(args.post_caption) if args.post_caption else None
    with engine_steps():
        made = {"covers": covers.make_covers(args.video, args.at, sheet)}
    if caption:
        made["postCaption"] = covers.write_post_caption(args.video, caption)
    return made


def qc_status_payload(args):
    return {"ok": True, **qc.assert_exportable(args.video)}


def register(commands):
    """Adds the commands to zks-engine's subparsers; each prints JSON only."""
    edit = commands.add_parser("edit", help="the EDL, the edit's -14 LUFS audio and the caption cues from the studio's cut spec")
    edit.add_argument("--source", required=True, help="the file the cut spec's sourceAssetId names")
    edit.set_defaults(handler=edit_payload)
    master = commands.add_parser("render-master", help="the edit stage, overlays, SFX and the master, gated on EDL frames and -14 LUFS")
    master.add_argument("--quality", choices=QUALITIES, required=True)
    master.add_argument("--source", required=True, help="the file the cut spec's sourceAssetId names")
    master.set_defaults(handler=render_master_payload)
    check = commands.add_parser("qc-master", help="every QC gate on the named master; writes work/qc/<video>.json")
    check.add_argument("--master", required=True, help="the master to judge, under work/out (work-relative)")
    check.add_argument("--source", required=True, help="the source the render job cut that master from")
    check.add_argument("--specs", required=True, help="the render job's spec snapshot, under work/snapshots (work-relative)")
    check.add_argument("--render-inputs", required=True, help="the render-master report's inputs object, as JSON")
    check.add_argument("--words", required=True, help="the kept transcript as JSON [{at, end, text}] in source seconds")
    check.add_argument("--language", default="auto")
    check.add_argument("--model", help="whisper model for the re-transcription (default: the best installed)")
    check.set_defaults(handler=qc_master_payload)
    motion = commands.add_parser("check-motion", help="per-shot motion against the original; FAIL on frozen footage")
    motion.add_argument("--stage", choices=("source", "master"), required=True)
    motion.add_argument("--source", required=True)
    motion.add_argument("--clip", type=clip_at, action="append", default=[], help="source stage: PATH@SECONDS per joined clip")
    motion.add_argument("--region", type=region_box, action="append", help="x,y,w,h on the 1080x1920 grid; default: the subject mid-frame")
    motion.set_defaults(handler=check_motion_payload)
    cover = commands.add_parser("make-covers", help="cover stills at edited times, with the cut spec's blur applied")
    cover.add_argument("--at", type=float, action="append", required=True, help="edited seconds, one per cover")
    cover.add_argument("--cover-sheet", help="the cover's own cue sheet (JSON)")
    cover.add_argument("--post-caption", help="the post's caption and hashtags (UTF-8 text), written as covers/<edit>-caption.txt")
    cover.set_defaults(handler=make_covers_payload)
    status = commands.add_parser("qc-status", help="fails unless the latest QC report passed: export runs it first")
    status.set_defaults(handler=qc_status_payload)
    for command in (edit, master, check, motion, cover, status):
        command.add_argument("--video", required=True)
        command.add_argument("--json", action="store_true", required=True, help="print JSON (the only output format)")
