# Created by The Angelo Umali.
# Where a clip was filmed, from its own GPS, and what viewers call that place (v2 rule 8, from zkidz-films 1a6508a):
# QuickTime/Android tags, photo EXIF or the Insta360 trailer, plus an offline GeoNames lookup. Coordinates stay on this
# machine; nothing here prints them. The gazetteer and the home circle live in ZKS_HOME/geo, device-local and optional.
import collections
import json
import math
import re
import struct
import subprocess
from pathlib import Path

from . import ffio
from .home import data_dir

INSTA_MAGIC = b"8db42d694ccc418790edff439fe026bf"
PHOTOS = (".jpg", ".jpeg", ".png")
MAX_FIXES = 120
NAMES_FILE = Path(__file__).parent / "data" / "place-names.json"


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def iso6709(text):
    m = re.match(r"([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)", text or "")
    return [float(m.group(1)), float(m.group(2))] if m else None


def insta_fixes(path):
    """Insta360 trailer GPS as [unix_s, lat, lon]; None when the file has no trailer. Layout per ExifTool's ProcessInsta360."""
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        if size < 78:
            return None
        f.seek(size - 78)
        tail = f.read(78)
        if tail[-32:] != INSTA_MAGIC:
            return None
        trailer_len = struct.unpack("<I", tail[38:42])[0]
        rec_id, rec_len = struct.unpack("<HI", tail[:6])
        if rec_id != 0 or not rec_len:
            return []
        f.seek(size - 78 - rec_len)
        table = f.read(rec_len)
        fixes = []
        for k in range(0, len(table) - 9, 10):  # directory rows: id, size, offset from the trailer start
            tid, tsize, toff = struct.unpack("<HII", table[k:k + 10])
            if tid not in (0x7, 0x700) or not tsize:
                continue
            f.seek(size - trailer_len + toff)
            data = f.read(tsize)
            for q in range(0, tsize - 52, 53):
                t, _, _, valid, lat_b, ns, lon_b, ew = struct.unpack("<IIHc8sc8sc", data[q:q + 29])
                if valid != b"A" or ns not in (b"N", b"S") or ew not in (b"E", b"W", b"O"):
                    continue
                lat, lon = struct.unpack("<d", lat_b)[0], struct.unpack("<d", lon_b)[0]
                fixes.append([t, -abs(lat) if ns == b"S" else lat, lon if ew == b"E" else -abs(lon)])
        return fixes


def exif_gps(path):
    from PIL import Image

    def dms(v, ref):
        d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
        return -d if ref in ("S", "W") else d

    gps = Image.open(path).getexif().get_ifd(0x8825)
    return [round(dms(gps[2], gps.get(1)), 5), round(dms(gps[4], gps.get(3)), 5)] if gps.get(2) and gps.get(4) else None


def tag_gps(path):
    try:
        run = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-show_entries", "format_tags", "-of", "json", str(path)],
                             capture_output=True, text=True, encoding="utf-8")
    except FileNotFoundError as error:
        raise RuntimeError("ffprobe is missing: GPS tags cannot be read") from error
    tags = {k.lower(): v for k, v in json.loads(run.stdout or "{}").get("format", {}).get("tags", {}).items()}
    return iso6709(tags.get("com.apple.quicktime.location.iso6709") or tags.get("location") or tags.get("location-eng"))


def gps_points(path):
    """Every [lat, lon] the clip's own metadata proves (one for a tag or photo, a thinned track for Insta360); [] when none."""
    path = Path(path)
    if not path.exists():
        return []
    try:
        if path.suffix.lower() in PHOTOS:
            point = exif_gps(path)
            return [point] if point else []
        fixes = insta_fixes(path)
        if fixes:
            step = max(1, len(fixes) // MAX_FIXES)
            return [[a, o] for _, a, o in fixes[::step]]
        point = tag_gps(path)
        return [point] if point else []
    except RuntimeError:
        raise
    except Exception:  # an unreadable file is evidence too: no GPS
        return []


def load_home():
    """{"lat","lon","radius_km"} from ZKS_HOME/geo/home.json, or None. Local only, never committed, never printed."""
    path = data_dir("geo") / "home.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def is_home(point, home):
    return bool(home) and km(point, (home["lat"], home["lon"])) <= home.get("radius_km", 9)


def cluster(points, radius_km=3.0):
    """Single-link groups of points within radius_km; each group's centre is its mean."""
    groups = []
    for point in points:
        near = [g for g in groups if any(km(point, q) <= radius_km for q in g)]
        merged = [point] + [q for g in near for q in g]
        groups = [g for g in groups if g not in near] + [merged]
    return [[sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)] for g in groups]


class Gazetteer:
    def __init__(self, path):
        self.cells = collections.defaultdict(list)
        with open(path, encoding="utf-8") as f:
            for line in f:
                c = line.split("\t")
                lat, lon = float(c[4]), float(c[5])
                self.cells[(math.floor(lat), math.floor(lon))].append((lat, lon, c[1]))

    def near(self, point, max_km=60):
        best = None
        for dl in (-1, 0, 1):
            for do in (-1, 0, 1):
                for lat, lon, name in self.cells.get((math.floor(point[0]) + dl, math.floor(point[1]) + do), ()):
                    d = km(point, (lat, lon))
                    if d <= max_km and (best is None or d < best[0]):
                        best = (d, name)
        return best[1] if best else None


def load_gazetteer():
    """GeoNames cities1000 from ZKS_HOME/geo/, or None (the caller degrades to declared places)."""
    path = data_dir("geo") / "cities1000.txt"
    return Gazetteer(path) if path.exists() else None


def label_of(name, names=None):
    """The name a viewer knows for a geotag name."""
    names = names if names is not None else json.loads(NAMES_FILE.read_text(encoding="utf-8"))
    return names.get(name, name)
