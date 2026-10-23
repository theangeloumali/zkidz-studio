# Created by The Angelo Umali.
# Checks that this machine can run the engine.
# Usage: python -m zks_engine.doctor [--render]   (--render: only the overlay/composite prerequisites)
# Installs nothing: `pnpm zks doctor --fetch` downloads the tools.lock.json pins and verifies each SHA-256.
# Exit 1 when a required check fails.
import functools
import importlib.util
import json
import os
import re
import shutil
import sys
from pathlib import Path

from . import backends, ffio
from .pipeline import HF_DIR
from .transcribe import whispercpp

FETCH_MOVED = "doctor --fetch moved to `pnpm zks doctor --fetch`, which installs the tools.lock.json pins and verifies each SHA-256"
OVERLAY_PAGE = HF_DIR / "overlay" / "overlay.html"
CHROME_NAMES = ("google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser")
CHROME_PATHS = (Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
                Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))


def kit_files():
    """Every script overlay.html loads; HyperFrames draws through them (hf/brand/canvas.js)."""
    page = OVERLAY_PAGE.read_text(encoding="utf-8")
    return sorted({(OVERLAY_PAGE.parent / src).resolve() for src in re.findall(r'<script src="([^"]+)"', page)})


def check_ffmpeg():
    found = shutil.which(ffio.ffmpeg_bin())
    return (True, f"ffmpeg at {found}") if found else (False, f"ffmpeg not found ({ffio.ffmpeg_bin()})")


def check_whisper():
    """The pinned ffmpeg is built --disable-whisper (spike 04); transcription runs whisper.cpp's whisper-cli."""
    try:
        return True, f"whisper-cli at {whispercpp.cli_path()}"
    except ffio.ToolMissing as missing:
        return False, str(missing)


def check_numpy():
    return (True, "numpy importable") if importlib.util.find_spec("numpy") else (False, "numpy missing (python3 -m pip install numpy)")


def check_kit():
    missing = [file.name for file in kit_files() if not file.exists()]
    if missing:
        return False, f"the overlay kit in {HF_DIR} is missing {missing[:3]}"
    return True, f"overlay kit in {HF_DIR}"


@functools.cache
def check_chrome():
    """HyperFrames captures frames in Chrome; ZKS_CHROME names one outside the usual places."""
    found = os.environ.get("ZKS_CHROME") or next(filter(None, map(shutil.which, CHROME_NAMES)), None)
    found = found or next((str(path) for path in CHROME_PATHS if path.exists()), None)
    return (True, f"Chrome at {found}") if found else (False, "no Chrome found (set ZKS_CHROME)")


def check_hyperframes():
    """The HyperFrames renderer's pinned CLI, GSAP and fontkit (hf/package.json), installed by the workspace pnpm install."""
    wanted = json.loads((HF_DIR / "package.json").read_text(encoding="utf-8"))["dependencies"]
    found = {}
    for name in wanted:
        manifest = HF_DIR / "node_modules" / name / "package.json"
        found[name] = json.loads(manifest.read_text(encoding="utf-8"))["version"] if manifest.exists() else None
    if found != wanted:
        return False, f"hf has {found}, package.json pins {wanted} (run pnpm install at the repo root)"
    return True, " + ".join(f"{name} {version}" for name, version in wanted.items())


def check_models():
    try:
        return True, f"whisper model {whispercpp.model_path()}"
    except ffio.ToolMissing as missing:
        return False, str(missing)


def check_gpu():
    """The probed render backend; every profile renders, so the check passes and only names the path."""
    backend = backends.active()
    proof = "" if backend.hardware_tested else ", untested on hardware"
    return True, f"{backend.name} ({backend.probe_encoder}), {backends.render_jobs(backend)} render jobs{proof}"


def main(render_only):
    results = [("ffmpeg", *check_ffmpeg()), ("overlay kit", *check_kit()), ("chrome", *check_chrome())]
    if not render_only:
        results += [("whisper", *check_whisper()), ("numpy", *check_numpy()), ("models", *check_models())]
        results.append(("gpu", *check_gpu()))
    results.append(("hyperframes", *check_hyperframes()))
    for name, ok, detail in results:
        print(f"{'OK  ' if ok else 'FAIL'} {name:12} {detail}")
    return 0 if all(ok for _, ok, _ in results) else 1


def cli(argv):
    if "--fetch" in argv:
        sys.exit(FETCH_MOVED)
    return main("--render" in argv)


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
