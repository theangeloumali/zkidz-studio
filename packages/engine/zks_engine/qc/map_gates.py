# Created by The Angelo Umali.
# The learning theme's map gate (v2 rule 8, from zkidz-films 1a6508a): every place the edit visits beyond home has a
# routeMap pin within PIN_KM. Places come from each raw clip's own GPS (the join records them in sources/<v>.bands.json)
# and the cut spec's declared `places`; home is dropped and never printed. A WARN (no proof either way) passes.
import json

from .. import geo_proof
from . import inputs

PIN_KM = 25.0


def pins_of(cues):
    """[lon, lat] of every routeMap stop."""
    return [[stop["lon"], stop["lat"]] for cue in cues if cue.get("kind") == "routeMap" for stop in cue.get("stops") or []
            if isinstance(stop.get("lon"), (int, float)) and isinstance(stop.get("lat"), (int, float))]


def places_of(clips, places, home=None, gaz=None):
    """([(name, [lat, lon])], warnings, clips without GPS): the places the edit visits, home removed."""
    warnings, found, points, unproven = [], [], [], 0
    for clip in clips:
        clip_points = geo_proof.gps_points(clip)
        unproven += not clip_points
        points += [point for point in clip_points if not geo_proof.is_home(point, home)]
    if points and gaz is None:
        warnings.append("no gazetteer: GPS places are unnamed")
    names = json.loads(geo_proof.NAMES_FILE.read_text(encoding="utf-8"))
    for centre in geo_proof.cluster(points):
        name = gaz.near(centre) if gaz else None
        found.append((geo_proof.label_of(name, names) if name else f"place near {centre[0]:.1f},{centre[1]:.1f}", centre))
    found += [(place["name"], [place["lat"], place["lon"]]) for place in places if not geo_proof.is_home([place["lat"], place["lon"]], home)]
    return found, warnings, unproven


def check(clips, places, cues, home=None, gaz=None):
    """(PASS | FAIL | WARN, the line it reports)."""
    found, warnings, unproven = places_of(clips, places, home, gaz)
    seen, unique = set(), []
    for name, centre in found:
        key = (name, round(centre[0], 1), round(centre[1], 1))
        if key not in seen:
            seen.add(key)
            unique.append((name, centre))
    pins = pins_of(cues)
    missing = [name for name, (lat, lon) in unique if not any(geo_proof.km((lat, lon), (y, x)) <= PIN_KM for x, y in pins)]
    note = "".join(f" (WARN {warning})" for warning in warnings)
    if missing:
        return "FAIL", f"{', '.join(missing)} not pinned{note}"
    if unique:
        return "PASS", f"{len(unique)} places, {len(unique)} pinned{note}"
    if unproven:
        return "WARN", f"{unproven} source(s) carry no GPS and the cut spec declares no places; add places to prove them{note}"
    return "PASS", f"home only, no map needed{note}"


def map_problems(clips, places, cues):
    status, line = check(clips, places, cues, geo_proof.load_home(), geo_proof.load_gazetteer())
    return ([line] if status == "FAIL" else []), line


def raw_clips(video, edl):
    """The raw clips the joined source was made from, else the source itself."""
    bands = inputs.read_json(inputs.work() / "sources" / f"{edl.get('base', video)}.bands.json", [])
    clips = [band["clip"] for band in bands if band.get("clip")]
    record = inputs.read_json(inputs.work() / "edl" / f"{edl.get('base', video)}.source.json", {})
    return clips or ([record["source"]] if record.get("source") else [])
