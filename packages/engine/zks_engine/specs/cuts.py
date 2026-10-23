# Created by The Angelo Umali.
# Cut specs as objects ({at, end, reason, pin}) and the bridge to and from the positional arrays edl.py reads.
from .schema import validate

LEGACY_FPS = {"num": 30000, "den": 1001}  # every pre-JSON edit was 29.97
DEFAULT_CENTRE_X = 0.5  # edl.ZOOM_CENTRE's x; only needed when a zoom names cy alone


def spans(items):
    return [[item["at"], item["end"]] for item in items]


def zoom_row(zoom):
    row = [zoom["at"], zoom["end"], zoom["preset"]]
    if "cy" in zoom:
        return row + [zoom.get("cx", DEFAULT_CENTRE_X), zoom["cy"]]
    return row + [zoom["cx"]] if "cx" in zoom else row


def flat_corners(corners):
    return [value for corner in corners for value in (corner["x"], corner["y"])]


def cut_spec_to_engine(spec):
    """A validated JSON cut spec in the dict shape edl.build / blur / make_reels read. No `source`: the caller resolves the asset."""
    validate("cut-spec", spec)
    pauses = spec.get("trimPauses")
    engine = {
        "duration": spec["durationS"],
        "remove": [[cut["at"], cut["end"], cut["reason"], *(["pin"] if cut.get("pin") else [])] for cut in spec["removals"]],
        "trim_pauses": (
            {"threshold_db": pauses["thresholdDb"], "min": pauses["minS"], "keep": pauses["keepS"], "exclude": spans(pauses["exclude"])}
            if pauses
            # No rule: a minimum pause longer than the clip never matches, and stays JSON-serialisable (no Infinity).
            else {"threshold_db": -90, "min": spec["durationS"] + 1, "keep": 0, "exclude": []}
        ),
        "facecam": spans(spec.get("faceCamRanges", [])),
        "bleep": [[bleep["at"], bleep["end"], bleep["x"], bleep["y"]] for bleep in spec.get("bleeps", [])],
        "blur": [[box["at"], box["end"], box["x"], box["y"], box["w"], box["h"], box["reason"]] for box in spec.get("blurBoxes", [])],
        "zooms": [zoom_row(zoom) for zoom in spec.get("zooms", [])],
        "portals": [[portal["at"], portal["end"], *flat_corners(portal["corners"])] for portal in spec.get("portals", [])],
        "matte": spans(spec.get("matteRanges", [])),
        "cutaways": spec.get("cutaways", []),
    }
    if "baseVideoId" in spec:
        engine["base"] = spec["baseVideoId"]
    if spec.get("isReel"):
        engine["reel"] = True
    return engine


def objects(rows):
    return [{"at": row[0], "end": row[1]} for row in rows]


def migrate_zoom(row):
    at, end, preset, *centre = row
    return {"at": at, "end": end, "preset": preset, **dict(zip(("cx", "cy"), centre))}


def migrate_cuts(legacy, source_asset_id):
    """A legacy cuts/vN.json as a JSON cut spec. The `source` path becomes the registered asset id the caller passes."""
    rule = legacy.get("trim_pauses")
    spec = {
        "schemaVersion": 1,
        "sourceAssetId": source_asset_id,
        "durationS": legacy["duration"],
        "fps": dict(LEGACY_FPS),
        "removals": [{"at": at, "end": end, "reason": reason, **({"pin": True} if "pin" in flags else {})} for at, end, reason, *flags in legacy["remove"]],
        "faceCamRanges": objects(legacy.get("facecam", [])),
        "cutaways": legacy.get("cutaways", []),
        "bleeps": [{"at": at, "end": end, "x": x, "y": y} for at, end, x, y in legacy.get("bleep", [])],
        "blurBoxes": [{"at": at, "end": end, "x": x, "y": y, "w": w, "h": h, "reason": reason} for at, end, x, y, w, h, reason in legacy.get("blur", [])],
        "zooms": [migrate_zoom(row) for row in legacy.get("zooms", [])],
        "portals": [{"at": at, "end": end, "corners": [{"x": x, "y": y} for x, y in zip(xy[0::2], xy[1::2])]} for at, end, *xy in legacy.get("portals", [])],
        "matteRanges": objects(legacy.get("matte", [])),
    }
    if rule:
        spec["trimPauses"] = {"thresholdDb": rule["threshold_db"], "minS": rule["min"], "keepS": rule["keep"], "exclude": objects(rule["exclude"])}
    if "base" in legacy:
        spec["baseVideoId"] = legacy["base"]
    if legacy.get("reel"):
        spec["isReel"] = True
    return validate("cut-spec", spec)
