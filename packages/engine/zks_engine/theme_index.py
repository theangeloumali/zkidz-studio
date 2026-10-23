# Created by The Angelo Umali.
# themes/<id>/index.json from theme.json's component manifest (plan §7.8): the short list an agent filters by tier and
# purpose (list_cue_kinds) before it opens any component schema, and the maxChars table add_cue enforces (max_chars).
import json
import re
from pathlib import Path

THEMES_DIR = Path(__file__).resolve().parents[3] / "themes"
# Same rule as hf/theme.js: lowercase ids only, so themes/_blueprint (the copy-me starter) is never indexed or loaded.
THEME_ID = re.compile(r"[a-z0-9][a-z0-9-]*")
TIERS = ("core", "accent", "special")
INDEX_VERSION = 1


class ThemeError(ValueError):
    pass


def theme_dir(theme_id, themes_root=None):
    root = Path(themes_root or THEMES_DIR)
    if not isinstance(theme_id, str) or not THEME_ID.fullmatch(theme_id):
        raise ThemeError(f"{theme_id!r} is not a theme id (lowercase letters, digits and -)")
    folder = root / theme_id
    if not (folder / "theme.json").is_file():
        raise ThemeError(f"no theme {theme_id} in {root.name}/")
    return folder


def slot_limits(slots, where):
    limits = {}
    for slot, spec in (slots or {}).items():
        limit = spec.get("maxChars") if isinstance(spec, dict) else None
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
            raise ThemeError(f"{where}.{slot}.maxChars must be a positive integer, not {limit!r}")
        limits[slot] = limit
    return limits


def index_entry(kind, component):
    tier, purpose = component.get("tier"), component.get("purpose")
    if tier not in TIERS:
        raise ThemeError(f"{kind}.tier is core, accent or special, not {tier!r}")
    if not isinstance(purpose, str) or not purpose.strip():
        raise ThemeError(f"{kind}.purpose must say what the kind is for")
    entry = {"kind": kind, "tier": tier, "purpose": purpose, "slots": slot_limits(component.get("slots"), f"{kind}.slots")}
    if tones := component.get("tones"):
        entry["tones"] = {tone: slot_limits(slots, f"{kind}.tones.{tone}") for tone, slots in tones.items()}
    return entry


def build_index(theme_id, themes_root=None):
    theme = json.loads((theme_dir(theme_id, themes_root) / "theme.json").read_text(encoding="utf-8"))
    if theme.get("id") != theme_id:
        raise ThemeError(f"themes/{theme_id}/theme.json says its id is {theme.get('id')!r}")
    entries = [index_entry(kind, component) for kind, component in theme.get("components", {}).items()]
    entries.sort(key=lambda entry: (TIERS.index(entry["tier"]), entry["kind"]))
    return {"version": INDEX_VERSION, "id": theme_id, "name": theme.get("name", theme_id), "components": entries}


def write_index(theme_id, themes_root=None):
    path = theme_dir(theme_id, themes_root) / "index.json"
    path.write_text(json.dumps(build_index(theme_id, themes_root), indent=2) + "\n", encoding="utf-8")
    return path


def write_all(themes_root=None):
    root = Path(themes_root or THEMES_DIR)
    return [write_index(folder.name, root) for folder in sorted(root.iterdir()) if THEME_ID.fullmatch(folder.name) and (folder / "theme.json").is_file()]


def read_index(theme_id, themes_root=None):
    path = theme_dir(theme_id, themes_root) / "index.json"
    if not path.is_file():
        raise ThemeError(f"themes/{theme_id}/index.json is missing; run zks-engine theme-index --json")
    return json.loads(path.read_text(encoding="utf-8"))


def list_cue_kinds(theme_id, tier=None, purpose=None, themes_root=None):
    """The theme's kinds, optionally only one tier, and only those whose purpose mentions every word of `purpose`."""
    if tier is not None and tier not in TIERS:
        raise ThemeError(f"tier is core, accent or special, not {tier!r}")
    words = (purpose or "").lower().split()
    return [
        entry
        for entry in read_index(theme_id, themes_root)["components"]
        if (tier is None or entry["tier"] == tier) and all(word in entry["purpose"].lower() for word in words)
    ]


def max_chars(theme_id, themes_root=None):
    """{kind or kind:tone: {slot: limit}}, the table zks_engine.specs check_widths takes."""
    limits = {}
    for entry in read_index(theme_id, themes_root)["components"]:
        if entry["slots"]:
            limits[entry["kind"]] = entry["slots"]
        for tone, slots in entry.get("tones", {}).items():
            limits[f"{entry['kind']}:{tone}"] = slots
    return limits


def theme_index_payload(_args):
    return {"themes": [path.parent.name for path in write_all()]}
