# Created by The Angelo Umali.
# zks-engine <cmd> --json: JSON on stdout and an exit code, the contract the server spawns against.
import argparse
import contextlib
import json
import platform
import sys

from . import __version__, backends, capabilities, ffio, join_sources, prepare, showcase, specs, theme_index, transcribe
from .pipeline import WORK
from .render import commands as render_commands
from .specs.gates import GateFailed
from .specs.paths import video_id

EXIT_ENGINE_ERROR = 1
EXIT_REJECTED = 3
EXIT_TOOL_MISSING = 4
EXIT_THEME_INVALID = 5
EXIT_SPEC_INVALID = 6
EXIT_GATE_FAILED = 7


def version_payload(_args):
    return {"name": "zks-engine", "version": __version__, "python": platform.python_version()}


def capabilities_payload(args):
    return capabilities.probe(args.refresh)


def probe_payload(args):
    return ffio.probe(args.file)


def cue_kinds_payload(args):
    return {"theme": args.theme, "kinds": theme_index.list_cue_kinds(args.theme, args.tier, args.purpose)}


def read_json(source):
    try:
        if source == "-":
            return json.loads(sys.stdin.read())
        with open(source, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        raise specs.SpecError(f"{source}: {error}") from error


def read_words(path):
    """Transcript words as JSONL {start, end, text}, milliseconds in source time."""
    try:
        with open(path, encoding="utf-8") as lines:
            return [json.loads(line) for line in lines if line.strip()]
    except (OSError, json.JSONDecodeError) as error:
        raise specs.SpecError(f"{path}: {error}") from error


def validate_cue_payload(args):
    cue, words, limits = read_json(args.cue), read_words(args.words), theme_index.max_chars(args.theme)
    if args.stored:
        return {"cue": specs.validate_update_cue(read_json(args.stored), cue, words, limits)}
    return {"cue": specs.validate_add_cue(cue, words, limits)}


def check_ingest_mode(args):
    if args.mode == "single" and len(args.clip) != 1:
        raise specs.SpecError(f"single mode takes exactly one clip, got {len(args.clip)}")
    if args.mode == "showcase" and (len(args.clip) != 1 or not args.inserts):
        raise specs.SpecError("showcase mode takes one camera clip and --inserts")
    if args.mode != "showcase" and args.inserts:
        raise specs.SpecError(f"{args.mode} mode takes no --inserts")


def engine_inserts(source):
    """The server's inserts file ({srcPath, srcAt, ...}) in showcase's own shape ({src, src_at, ...})."""
    try:
        return [{"at": insert["at"], "end": insert["end"], "src": insert["srcPath"], "src_at": insert["srcAt"], **({"panel": insert["panel"]} if "panel" in insert else {})}
                for insert in read_json(source)]
    except (KeyError, TypeError) as error:
        raise specs.SpecError(f"{source}: not a list of inserts ({error!r})") from error


def ingest_payload(args):
    video = video_id(args.video)
    check_ingest_mode(args)
    if args.mode == "showcase":
        clips = [showcase.main(video, args.clip[0], engine_inserts(args.inserts))]
    else:
        clips = join_sources.main(f"sources/{video}.mkv", args.clip)
    source = WORK / "sources" / f"{video}.mkv"
    prepare.build_audio(source, video)
    prepare.build_proxy(source, video, backends.active())
    joins, cursor = [], 0
    for index, clip in enumerate(clips):
        num, den = clip.fps
        joins.append({"clip": index, "at": cursor * den / num})
        cursor += clip.frames
    return {"sourcePath": f"sources/{video}.mkv", "frames": cursor, "joins": joins}


def transcribe_payload(args):
    video = video_id(args.video)
    if not (WORK / "audio" / f"{video}.wav").exists():
        raise specs.SpecError(f"no audio/{video}.wav: ingest {video} first")
    try:
        words, chunks = transcribe.main(f"audio/{video}.wav", f"transcripts/{video}_words.jsonl", 6, args.language, args.model)
    except ValueError as error:  # an unpinned model name
        raise specs.SpecError(str(error)) from error
    # The server's transcript shape: a JSON array in seconds, text trimmed.
    server_words = [{"at": word["start"] / 1000, "end": word["end"] / 1000, "text": word["text"].strip()} for word in words]
    (WORK / "transcripts" / f"{video}.words.json").write_text(json.dumps(server_words), encoding="utf-8")
    return {"wordsPath": f"transcripts/{video}.words.json", "words": len(server_words), "chunks": chunks}


def parser():
    root = argparse.ArgumentParser(prog="zks-engine")
    commands = root.add_subparsers(dest="command", required=True)
    version = commands.add_parser("version", help="engine and Python versions")
    version.set_defaults(handler=version_payload)
    probe = commands.add_parser("probe", help="ffprobe metadata of one local media file")
    probe.add_argument("file")
    probe.set_defaults(handler=probe_payload)
    index = commands.add_parser("theme-index", help="write themes/<id>/index.json for every theme pack")
    index.set_defaults(handler=theme_index.theme_index_payload)
    kinds = commands.add_parser("cue-kinds", help="the theme's cue kinds, optionally one tier and a purpose search")
    kinds.add_argument("--theme", required=True)
    kinds.add_argument("--tier", help="core, accent or special")
    kinds.add_argument("--purpose", help="words every listed purpose must mention")
    kinds.set_defaults(handler=cue_kinds_payload)
    validate = commands.add_parser("validate-cue", help="add_cue / update_cue checks: schema, theme widths and the anchor word")
    validate.add_argument("--theme", required=True)
    validate.add_argument("--cue", required=True, help="the cue (or, with --stored, the patch) as a JSON file, or - for stdin")
    validate.add_argument("--words", required=True, help="transcript words as JSONL {start, end, text} in ms")
    validate.add_argument("--stored", help="the stored cue the patch merges into")
    validate.set_defaults(handler=validate_cue_payload)
    ingest = commands.add_parser("ingest", help="build sources/<video>.mkv from the clips, then its 16 kHz audio and 1080 proxy")
    ingest.add_argument("--video", required=True)
    ingest.add_argument("--mode", required=True, choices=("single", "join", "showcase"))
    ingest.add_argument("--clip", required=True, action="append", help="a camera clip, path[@zoom]; repeat for a join")
    ingest.add_argument("--inserts", help="showcase only: the server's inserts JSON file")
    ingest.set_defaults(handler=ingest_payload)
    transcription = commands.add_parser("transcribe", help="whisper words for audio/<video>.wav -> transcripts/<video>.words.json")
    transcription.add_argument("--video", required=True)
    transcription.add_argument("--language", default="auto")
    transcription.add_argument("--model", help="a pinned whisper model; default the most accurate installed")
    transcription.set_defaults(handler=transcribe_payload)
    probed = commands.add_parser("capabilities", help="probe the render backends and write ZKS_HOME/capabilities.json")
    probed.add_argument("--refresh", action="store_true", help="probe again instead of reusing this ffmpeg + driver's cached result")
    probed.set_defaults(handler=capabilities_payload)
    for command in (version, probe, probed, index, kinds, validate, ingest, transcription):
        command.add_argument("--json", action="store_true", required=True, help="print JSON (the only output format)")
    render_commands.register(commands)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        # Module progress prints go to stderr: stdout carries only the JSON report.
        with contextlib.redirect_stdout(sys.stderr):
            payload, code = args.handler(args), 0
    except ffio.MediaRejected as error:
        payload, code = {"error": {"code": "media_rejected", "message": str(error)}}, EXIT_REJECTED
    except ffio.ToolMissing as error:
        payload, code = {"error": {"code": "tool_missing", "message": str(error)}}, EXIT_TOOL_MISSING
    except theme_index.ThemeError as error:
        payload, code = {"error": {"code": "theme_invalid", "message": str(error)}}, EXIT_THEME_INVALID
    except specs.SpecError as error:
        payload, code = {"error": {"code": "spec_invalid", "message": str(error)}}, EXIT_SPEC_INVALID
    except GateFailed as error:
        payload, code = {"error": {"code": "gate_failed", "message": str(error)}}, EXIT_GATE_FAILED
    except SystemExit as error:  # the pipeline modules sys.exit("why") on a failed step
        if not isinstance(error.code, str):
            raise
        payload, code = {"error": {"code": "engine_failed", "message": error.code}}, EXIT_ENGINE_ERROR
    except Exception as error:  # noqa: BLE001 - the server reads JSON; a traceback would reach the user as the error text
        payload, code = {"error": {"code": "engine_error", "message": f"{type(error).__name__}: {error}"}}, EXIT_ENGINE_ERROR
    print(json.dumps(payload))
    return code


if __name__ == "__main__":
    sys.exit(main())
