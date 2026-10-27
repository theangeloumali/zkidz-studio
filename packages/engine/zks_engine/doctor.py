# Created by The Angelo Umali.
# Checks that this machine can run the engine.
# Usage: python -m zks_engine.doctor [--render]   (--render: only the overlay/composite prerequisites)
# Installs nothing: `pnpm zks doctor --fetch` downloads the tools.lock.json pins and verifies each SHA-256.
# Exit 1 when a required check fails.
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
# HyperFrames' own lookup when ZKS_CHROME is unset (a dev checkout): its cache, then puppeteer's.
CHROME_CACHES = (Path(".cache", "hyperframes", "chrome"), Path(".cache", "puppeteer"))


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


def check_chrome():
    """The Chrome the overlay renderer launches: the pinned ZKS_CHROME, else the newest headless shell in HyperFrames' cache."""
    if os.environ.get("ZKS_CHROME"):
        chrome = Path(os.environ["ZKS_CHROME"])
        return (True, f"Chrome at {chrome}") if chrome.is_file() else (False, f"no Chrome at ZKS_CHROME={chrome}; run pnpm zks setup")
    for cache in CHROME_CACHES:
        shells = sorted((path for path in (Path.home() / cache).glob("chrome-headless-shell/*/*/chrome-headless-shell*") if path.is_file()), reverse=True)
        if shells:
            return True, f"Chrome at {shells[0]}"
    return False, "no Chrome for the overlay renderer; run pnpm zks setup"


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
