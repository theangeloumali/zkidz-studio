# Created by The Angelo Umali.
# Render backends (plan §7): the GPU probe's result picks one profile, which every render stage decodes and encodes with.
# A backend counts only after it encodes frames; results are cached per ffmpeg build and driver version.
import hashlib
import json
import os
import shutil
import subprocess
import sys

from .. import ffio
from ..home import data_dir
from . import amf, cpu, nvidia, qsv, vaapi, videotoolbox

PROBE_ORDER = ("nvidia", "videotoolbox", "qsv", "amf", "vaapi", "cpu")
BACKENDS = {module.BACKEND.name: module.BACKEND for module in (nvidia, videotoolbox, qsv, amf, vaapi, cpu)}
PROBE_TIMEOUT_S = 20


def get(name):
    return BACKENDS[name]


def select(attempts):
    """The first backend, in probe order, whose test encode passed; cpu when none did."""
    passed = {attempt["backend"] for attempt in attempts if attempt.get("ok")}
    return get(next((name for name in PROBE_ORDER if name in passed), "cpu"))


def from_doctor(check):
    """A `zks doctor --json` gpu check: {id, status, detail, data: {attempts}}."""
    return select(check.get("data", {}).get("attempts", []))


def probe_command(backend, ffmpeg):
    upload = backend.upload.lstrip(",") or "format=yuv420p"
    return [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", *backend.device, "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=1",
            "-vf", upload, "-c:v", backend.probe_encoder, "-f", "null", "-"]


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
    try:
        return subprocess.run(probe_command(backend, ffio.ffmpeg_bin()), capture_output=True, timeout=PROBE_TIMEOUT_S).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def probe_attempts(refresh=False):
    """Every backend's test encode (verify:gpu needs them all, not just the first), cached per fingerprint()."""
    cache = data_dir("cache") / "gpu-probe.json"
    key = fingerprint()
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
