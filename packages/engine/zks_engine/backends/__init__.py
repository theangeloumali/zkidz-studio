# Created by The Angelo Umali.
# Render backends (plan §7): the GPU probe's result picks one profile, which every render stage decodes and encodes with.
# A backend counts only after it encodes frames; results are cached per ffmpeg build and driver version.
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .. import ffio
from ..home import data_dir
from . import amf, cpu, graph, nvidia, qsv, vaapi, videotoolbox

PROBE_ORDER = ("nvidia", "videotoolbox", "qsv", "amf", "vaapi", "cpu")
BACKENDS = {module.BACKEND.name: module.BACKEND for module in (nvidia, videotoolbox, qsv, amf, vaapi, cpu)}
PROBE_TIMEOUT_S = 20
PROBE_FRAMES = 8
PROBE_REVISION = "round-trip-1"  # part of the cache key, so a cached pass from an older, weaker probe runs again
PROBE_SIZE = (320, 240)
PROBE_EDL = {"fps_num": 30, "fps_den": 1, "segments": [{"in": 0, "out": PROBE_FRAMES, "target": 0, "zoom": 1.0}],
             "punch_crop": "crop=w=296:h=222"}


def get(name):
    return BACKENDS[name]


def select(attempts):
    """The first backend, in probe order, whose test encode passed; cpu when none did."""
    passed = {attempt["backend"] for attempt in attempts if attempt.get("ok")}
    return get(next((name for name in PROBE_ORDER if name in passed), "cpu"))


def from_doctor(check):
    """A `zks doctor --json` gpu check: {id, status, detail, data: {attempts}}."""
    return select(check.get("data", {}).get("attempts", []))


def probe_commands(backend, ffmpeg, sample):
    """Encode 8 testsrc2 frames, then decode them with the backend and run the render's composite into its encoder:
    a machine whose encoder works but whose hwaccel decode or filter graph fails must fall back, not fail mid-render."""
    preamble = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", *backend.device]
    width, height = PROBE_SIZE
    encode = [*preamble, "-y", "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate=30", "-frames:v", str(PROBE_FRAMES),
              "-vf", backend.upload.lstrip(",") or "format=yuv420p", "-c:v", backend.probe_encoder, str(sample)]
    round_trip = [*preamble, *backend.decode, "-i", str(sample),
                  "-f", "lavfi", "-i", f"color=c=black@0:size={width}x{height}:rate=30,format=rgba,trim=end_frame=1",
                  "-filter_complex", graph.composite(backend, PROBE_EDL, size=PROBE_SIZE), "-map", "[v]",
                  "-frames:v", str(PROBE_FRAMES), "-c:v", backend.probe_encoder, "-f", "null", "-"]
    return encode, round_trip


def fingerprint():
    """ffmpeg's SHA-256 and the NVIDIA driver version: either changing can change which encoders work."""
    ffmpeg = shutil.which(ffio.ffmpeg_bin()) or ffio.ffmpeg_bin()
    digest = hashlib.sha256()
    with open(ffmpeg, "rb") as binary:
        for block in iter(lambda: binary.read(1 << 20), b""):
            digest.update(block)
    driver = ""
    if shutil.which("nvidia-smi"):
        query = subprocess.run(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"], capture_output=True, text=True)
        driver = query.stdout.strip().splitlines()[0] if query.returncode == 0 and query.stdout.strip() else ""
    return f"{digest.hexdigest()}|{driver}"


def run_probe(backend):
    with tempfile.TemporaryDirectory(prefix="zks-probe-") as scratch:
        try:
            return all(subprocess.run(command, capture_output=True, timeout=PROBE_TIMEOUT_S).returncode == 0
                       for command in probe_commands(backend, ffio.ffmpeg_bin(), Path(scratch) / "sample.mkv"))
        except (OSError, subprocess.TimeoutExpired):
            return False


def probe_attempts(refresh=False):
    """Every backend's test encode (verify:gpu needs them all, not just the first), cached per fingerprint()."""
    cache = data_dir("cache") / "gpu-probe.json"
    key = f"{fingerprint()}|{PROBE_REVISION}"
    try:
        known = json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        known = {}
    if not refresh and key in known:
        return known[key]
    attempts = [{"backend": name, "encoder": get(name).probe_encoder, "ok": run_probe(get(name))} for name in PROBE_ORDER]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({key: attempts}, indent=2), encoding="utf-8")
    return attempts


def active():
    """ZKS_BACKEND pins a backend; otherwise the probe decides."""
    if pin := os.environ.get("ZKS_BACKEND"):
        if pin not in BACKENDS:
            sys.exit(f"ZKS_BACKEND={pin} is not one of {', '.join(PROBE_ORDER)}")
        return get(pin)
    return select(probe_attempts())


def render_jobs(backend, cores=None):
    """Parallel encodes: RENDER_JOBS overrides the profile's count."""
    if os.environ.get("RENDER_JOBS"):
        return max(1, int(os.environ["RENDER_JOBS"]))
    return backend.jobs(cores or os.cpu_count() or 1)
