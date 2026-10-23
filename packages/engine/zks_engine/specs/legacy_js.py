# Created by The Angelo Umali.
# Migrates a legacy cues/vN.js sheet to JSON by parsing its CUE_SHEET literal as data. Nothing is ever executed:
# an identifier (BRAND.ink) becomes an unresolved value that is dropped, and a call or operator is refused.
import re

from .cues import check_cue, kind_validators
from .schema import SpecError

TOKEN = re.compile(
    r"""(?P<space>\s+|//[^\n]*|/\*.*?\*/)
      | (?P<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)
      | (?P<number>-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)
      | (?P<name>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)
      | (?P<punct>[\[\]{},:;=()])""",
    re.S | re.X,
)
ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "0": "\0", "v": "\v"}
LITERALS = {"true": True, "false": False, "null": None, "undefined": None}


class Unresolved(str):
    """A name the literal referenced (a kit constant); its value lives in code the migrator refuses to run."""


def tokenize(source, position):
    """Lazily, so code after the literal (a reel file's splices) is never even scanned."""
    while position < len(source):
        match = TOKEN.match(source, position)
        line = source.count("\n", 0, position) + 1
        if not match:
            raise SpecError(f"line {line}: {source[position : position + 20]!r} is not literal data")
        if match.lastgroup != "space":
            yield match.lastgroup, match.group(), line
        position = match.end()


def unescape(match):
    escape = match.group(1)
    return chr(int(escape[1:], 16)) if escape[0] == "u" and len(escape) == 5 else ESCAPES.get(escape, escape)


def unquote(text, line):
    body = text[1:-1]
    if text[0] == "`" and "${" in body:
        raise SpecError(f"line {line}: a template with ${{}} is code, not data")
    return re.sub(r"\\(u[0-9a-fA-F]{4}|.)", unescape, body, flags=re.S)


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.ahead = next(tokens, None)

    def next(self):
        if self.ahead is None:
            raise SpecError("CUE_SHEET literal ends early")
        token, self.ahead = self.ahead, next(self.tokens, None)
        return token

    def peek(self):
        return self.ahead[1] if self.ahead else None

    def value(self):
        kind, text, line = self.next()
        if text in ("[", "{"):
            return self.sequence(text, line)
        if kind == "string":
            return unquote(text, line)
        if kind == "number":
            return float(text) if re.search(r"[.eE]", text) else int(text)
        if kind == "name":
            if self.peek() == "(":
                raise SpecError(f"line {line}: {text}() is a call; a migrated sheet holds data only")
            return LITERALS[text] if text in LITERALS else Unresolved(text)
        raise SpecError(f"line {line}: unexpected {text!r}")

    def sequence(self, opener, line):
        closer, items, fields = "]" if opener == "[" else "}", [], {}
        while self.peek() != closer:
            if opener == "[":
                items.append(self.value())
            else:
                kind, key, key_line = self.next()
                if kind not in ("name", "string", "number") or self.next()[1] != ":":
                    raise SpecError(f"line {key_line}: expected `key: value` in an object")
                fields[unquote(key, key_line) if kind == "string" else key] = self.value()
            if self.peek() == ",":
                self.next()
            elif self.peek() != closer:
                raise SpecError(f"line {self.ahead[2] if self.ahead else line}: expected ',' or {closer!r}")
        self.next()
        return items if opener == "[" else fields


def parse_cue_sheet(source):
    start = re.search(r"\bCUE_SHEET\s*=\s*(?=\[)", source)
    if not start:
        raise SpecError("no `CUE_SHEET = [...]` literal found")
    return Parser(tokenize(source, start.end())).value()


def prune(value, schema, where, dropped):
    """Keeps only what the schema allows, recording each dropped field: style props (size, color, rot) the JSON kinds left out."""
    if isinstance(value, dict) and "properties" in schema:
        kept = {}
        for key, field in value.items():
            path = f"{where}.{key}" if where else key
            if key not in schema["properties"] or isinstance(field, Unresolved):
                dropped.append(path)
            else:
                kept[key] = prune(field, schema["properties"][key], path, dropped)
        return kept
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        return [prune(item, schema["items"], f"{where}[{index}]", dropped) for index, item in enumerate(value)]
    return value


def migrate_cue(cue, warnings):
    kind = cue.get("kind")
    label = f"{kind}@{cue.get('at')}"
    if kind not in kind_validators():
        warnings.append(f"{label}: unknown kind, cue dropped")
        return None
    if kind == "pipeline" and "steps" in cue and "labels" not in cue:
        # The old wrong shape (steps: [{label, at}]); staggering is now component-internal.
        cue = {**{key: value for key, value in cue.items() if key != "steps"}, "labels": [step.get("label") for step in cue["steps"]]}
    dropped = []
    migrated = prune(cue, kind_validators()[kind].schema, "", dropped)
    if dropped:
        warnings.append(f"{label}: dropped {', '.join(dropped)}")
    try:
        return check_cue(migrated)
    except SpecError as error:
        warnings.append(f"{label}: cue dropped, {error}")
        return None


def migrate_cue_sheet(source):
    """(cues, warnings) from a legacy JS cue sheet; cues that cannot become valid JSON are dropped and named in warnings."""
    sheet = parse_cue_sheet(source)
    warnings = []
    cues = [migrated for cue in sheet if isinstance(cue, dict) and (migrated := migrate_cue(cue, warnings)) is not None]
    return cues, warnings
