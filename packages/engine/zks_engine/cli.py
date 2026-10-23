# Created by The Angelo Umali.
# zks-engine <cmd> --json: JSON on stdout and an exit code, the contract the server spawns against.
import argparse
import json
import platform
import sys

from . import __version__, ffio, specs, theme_index

EXIT_REJECTED = 3
EXIT_TOOL_MISSING = 4
EXIT_THEME_INVALID = 5
EXIT_SPEC_INVALID = 6


def version_payload(_args):
    return {"name": "zks-engine", "version": __version__, "python": platform.python_version()}


def probe_payload(args):
    return ffio.probe(args.file)


def cue_kinds_payload(args):
    return {"theme": args.theme, "kinds": theme_index.list_cue_kinds(args.theme, args.tier, args.purpose)}


def read_json(source):
    try:
        return json.loads(sys.stdin.read() if source == "-" else open(source, encoding="utf-8").read())
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
    for command in (version, probe, index, kinds, validate):
        command.add_argument("--json", action="store_true", required=True, help="print JSON (the only output format)")
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        payload, code = args.handler(args), 0
    except ffio.MediaRejected as error:
        payload, code = {"error": {"code": "media_rejected", "message": str(error)}}, EXIT_REJECTED
    except ffio.ToolMissing as error:
        payload, code = {"error": {"code": "tool_missing", "message": str(error)}}, EXIT_TOOL_MISSING
    except theme_index.ThemeError as error:
        payload, code = {"error": {"code": "theme_invalid", "message": str(error)}}, EXIT_THEME_INVALID
    except specs.SpecError as error:
        payload, code = {"error": {"code": "spec_invalid", "message": str(error)}}, EXIT_SPEC_INVALID
    print(json.dumps(payload))
    return code


if __name__ == "__main__":
    sys.exit(main())
