# Created by The Angelo Umali.
# Validates spec JSON against the schemas exported from the shared zod contracts (packages/shared/schema).
import functools
import json
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "shared" / "schema"
SPEC_KINDS = ("cut-spec", "reel-spec", "cue-sheet", "reel-cue-patches", "caption-entries", "caption-phrases", "insert-spec")


class SpecError(ValueError):
    """A spec the engine refuses; the message says which field and why, for the agent to fix."""


@functools.cache
def validator(kind):
    if kind not in SPEC_KINDS:
        raise SpecError(f"unknown spec kind {kind!r}; expected one of {', '.join(SPEC_KINDS)}")
    return Draft202012Validator(json.loads((SCHEMA_DIR / f"{kind}.json").read_text(encoding="utf-8")))


def field_path(parts):
    text = ""
    for part in parts:
        text += f"[{part}]" if isinstance(part, int) else f".{part}" if text else str(part)
    return text or "(root)"


def describe(error):
    # best_match descends into a oneOf miss and picks the deepest branch: the cue variant whose `kind` fitted.
    best = best_match([error])
    return f"{field_path(best.absolute_path)}: {best.message}"


def validate(kind, data):
    errors = sorted(validator(kind).iter_errors(data), key=lambda error: list(map(str, error.absolute_path)))
    if errors:
        raise SpecError(f"{kind} invalid: " + "; ".join(describe(error) for error in errors[:5]))
    return data


def load_spec(kind, path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SpecError(f"{Path(path).name}: {error}") from error
    try:
        return validate(kind, data)
    except SpecError as error:
        raise SpecError(f"{Path(path).name}: {error}") from error
