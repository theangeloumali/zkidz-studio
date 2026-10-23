# Created by The Angelo Umali.
# The studio's engine CLI commands after ingest and transcribe (cli.py): edit, render-master, qc-master, check-motion,
# make-covers and qc-status, each printing one JSON report.
# Every path argument must sit under the project (pipeline.command_input), like a spec path.
import json

from .. import covers, qc
from ..pipeline import WORK, command_input
from ..qc.motion import SUBJECT_REGION
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


def master_relative(path):
    return path.relative_to(WORK).as_posix()


def edit_payload(args):
    return stages.edit_stage(args.video, args.source)


def render_master_payload(args):
    with engine_steps():
        return render_master(args.video, args.quality, args.source)


def qc_master_payload(args):
    master = qc.latest_master(args.video)
    words = json.loads(command_input(args.words).read_text(encoding="utf-8"))
    report = qc.qc_master(args.video, master, command_input(args.source), words, qc.whisper_transcriber(args.language, args.model))
    return {"master": master_relative(master), **report}


def check_motion_payload(args):
    regions = args.region or [SUBJECT_REGION]
    if args.stage == "source":
        return qc.check_motion_source(command_input(args.source), args.clip, regions)
    return qc.check_motion_master(args.video, qc.latest_master(args.video), command_input(args.source), regions)


def make_covers_payload(args):
    sheet = command_input(args.cover_sheet) if args.cover_sheet else None
    with engine_steps():
        made = {"covers": covers.make_covers(args.video, args.at, sheet)}
    if args.post_caption:
        made["postCaption"] = covers.write_post_caption(args.video, command_input(args.post_caption))
    return made


def qc_status_payload(args):
    qc.assert_exportable(args.video)
    return {"ok": True}


def register(commands):
    """Adds the commands to zks-engine's subparsers; each prints JSON only."""
    edit = commands.add_parser("edit", help="the EDL, the edit's -14 LUFS audio and the caption cues from the studio's cut spec")
    edit.add_argument("--source", required=True, help="the file the cut spec's sourceAssetId names")
    edit.set_defaults(handler=edit_payload)
    master = commands.add_parser("render-master", help="the edit stage, overlays, SFX and the master, gated on EDL frames and -14 LUFS")
    master.add_argument("--quality", choices=QUALITIES, required=True)
    master.add_argument("--source", required=True, help="the file the cut spec's sourceAssetId names")
    master.set_defaults(handler=render_master_payload)
    check = commands.add_parser("qc-master", help="every QC gate on the latest master; writes work/qc/<video>.json")
    check.add_argument("--source", required=True, help="the edit's source file")
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
