# Created by The Angelo Umali.
# zks-engine <cmd> --json: JSON on stdout and an exit code, the contract the server spawns against.
import argparse
import json
import platform
import sys

from . import __version__, ffio, theme_index

EXIT_REJECTED = 3
EXIT_TOOL_MISSING = 4
EXIT_THEME_INVALID = 5


def version_payload(_args):
    return {"name": "zks-engine", "version": __version__, "python": platform.python_version()}


def probe_payload(args):
    return ffio.probe(args.file)


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
    for command in (version, probe, index):
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
    print(json.dumps(payload))
    return code


if __name__ == "__main__":
    sys.exit(main())
