# Created by The Angelo Umali.
# Cue validation for add_cue / update_cue: the kind's schema, text-slot widths and the anchor word (plan §7.6, §7.7).
import functools
import re

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

from .schema import SpecError, field_path, validator

# The chip clips past 27 chars on the 1080-wide safe zone; a theme manifest replaces these. Keys are `kind` or `kind:tone`.
DEFAULT_MAX_CHARS = {"keyword:chip": {"text": 27}}
# A cue may lead its word slightly and land up to 1.8 s after it (§7.7).
ANCHOR_EARLY_S, ANCHOR_LATE_S = 0.2, 1.8
FLOAT_SLACK = 1e-6
# Written by set_captions or derived from the cut spec, so they have no authored anchor.
DERIVED_KINDS = {"caption", "censor", "cutaway"}


@functools.cache
def kind_validators():
    variants = validator("cue-sheet").schema["items"]["oneOf"]
    return {variant["properties"]["kind"]["const"]: Draft202012Validator(variant) for variant in variants}


def check_cue(cue, max_chars=None):
    """The cue against its own kind's schema (not the whole union, so the message is about this kind), then its widths."""
    kind = cue.get("kind") if isinstance(cue, dict) else None
    if kind not in kind_validators():
        raise SpecError(f"unknown cue kind {kind!r}; expected one of {', '.join(kind_validators())}")
    if error := best_match(kind_validators()[kind].iter_errors(cue)):
        raise SpecError(f"{kind} cue invalid: {field_path(error.absolute_path)}: {error.message}")
    if cue["end"] <= cue["at"]:
        raise SpecError(f"{kind} cue at {cue['at']}: end {cue['end']} must be after at")
    check_widths(cue, DEFAULT_MAX_CHARS if max_chars is None else max_chars)
    return cue


def check_widths(cue, max_chars):
    limits = max_chars.get(f"{cue['kind']}:{cue.get('tone')}") or max_chars.get(cue["kind"], {})
    for slot, limit in limits.items():
        value = cue.get(slot)
        texts = [(slot, value)] if isinstance(value, str) else [(f"{slot}[{index}]", text) for index, text in enumerate(value or [])]
        for name, text in texts:
            if len(text) > limit:
                raise SpecError(f"{cue['kind']} {name} is {len(text)} chars; this slot fits {limit}: {text!r}")


def words_of(text):
    return re.findall(r"[\w']+", text.lower().replace("’", "'"))


def anchor_word(anchor, words):
    """Start (seconds) of transcript word `wordIndex`; `phrase` must read from that word, so a stale index fails loudly."""
    index = anchor["wordIndex"]
    if index >= len(words):
        raise SpecError(f"anchor wordIndex {index} is past the transcript's {len(words)} words")
    expected = words_of(anchor["phrase"])
    heard = words_of(" ".join(word["text"] for word in words[index : index + len(expected)]))
    if heard != expected:
        raise SpecError(f"anchor phrase {anchor['phrase']!r} does not match the transcript at word {index}: {' '.join(heard)!r}")
    return words[index]["start"] / 1000


def check_anchor(cue, words):
    if "anchor" not in cue:
        if cue["kind"] in DERIVED_KINDS:
            return
        raise SpecError(f"{cue['kind']} cue at {cue['at']} needs an anchor {{phrase, wordIndex}} from the transcript")
    offset = cue["at"] - anchor_word(cue["anchor"], words)
    if offset < -ANCHOR_EARLY_S - FLOAT_SLACK:
        raise SpecError(f"{cue['kind']} cue starts {-offset:.2f} s before its anchor word; allowed {ANCHOR_EARLY_S} s")
    if offset > ANCHOR_LATE_S + FLOAT_SLACK:
        raise SpecError(f"{cue['kind']} cue starts {offset:.2f} s after its anchor word; allowed {ANCHOR_LATE_S} s")


def validate_add_cue(cue, words, max_chars=None):
    """What add_cue runs before storing: schema, widths, then the anchor against the transcript words (ms, source time)."""
    check_cue(cue, max_chars)
    check_anchor(cue, words)
    return cue


def validate_update_cue(stored, patch, words, max_chars=None):
    """The stored cue with the patch merged (a null removes a field), validated as a whole; `stored` is left untouched."""
    merged = {**stored, **patch}
    return validate_add_cue({key: value for key, value in merged.items() if value is not None}, words, max_chars)
