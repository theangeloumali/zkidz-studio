# Created by The Angelo Umali.
# Checks that this machine can run the engine.
# Usage: python -m zks_engine.doctor [--fetch] [--render]
#   --fetch   download missing whisper models      --render  only the overlay/composite prerequisites
# Exit 1 when a required check fails.
import functools
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from .pipeline import HF_DIR, VAD_MODEL, WHISPER_MODEL, has_cuda, models_dir

MODEL_URLS = {
    WHISPER_MODEL: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    VAD_MODEL: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
}
OVERLAY_PAGE = HF_DIR / "overlay" / "overlay.html"
CHROME_NAMES = ("google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser")
CHROME_PATHS = (Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
                Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))


def run(command):
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None


def kit_files():
    """Every script overlay.html loads; HyperFrames draws through them (hf/brand/canvas.js)."""
    page = OVERLAY_PAGE.read_text(encoding="utf-8")
    return sorted({(OVERLAY_PAGE.parent / src).resolve() for src in re.findall(r'<script src="([^"]+)"', page)})


def check_ffmpeg():
    return (True, "ffmpeg on PATH") if shutil.which("ffmpeg") else (False, "ffmpeg not on PATH")


def check_whisper():
    whisper = run(["ffmpeg", "-hide_banner", "-h", "filter=whisper"]) if shutil.which("ffmpeg") else None
    if not whisper or "Filter whisper" not in whisper.stdout:
        return False, "ffmpeg lacks the whisper filter (needs ffmpeg 8+ built with --enable-whisper, e.g. the gyan.dev full build)"
    return True, "ffmpeg whisper filter"


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


def check_models(fetch):
    folder = models_dir()
    missing = [name for name in MODEL_URLS if not (folder / name).exists()]
    if missing and fetch:
        folder.mkdir(parents=True, exist_ok=True)
        for name in missing:
            print(f"  downloading {name} -> {folder}", flush=True)
            # Download beside the target and rename, so an interrupted fetch never looks complete.
            partial = folder / f"{name}.part"
            urllib.request.urlretrieve(MODEL_URLS[name], partial)
            partial.replace(folder / name)
        missing = [name for name in MODEL_URLS if not (folder / name).exists()]
    if missing:
        return False, f"missing {missing} in {folder} (re-run with --fetch; the turbo model is 1.6 GB)"
    return True, f"whisper models in {folder}"


def main(fetch, render_only):
    results = [("ffmpeg", *check_ffmpeg()), ("overlay kit", *check_kit()), ("chrome", *check_chrome())]
    if not render_only:
        results += [("whisper", *check_whisper()), ("numpy", *check_numpy()), ("models", *check_models(fetch))]
        results.append(("gpu", True, "CUDA decode + NVENC" if has_cuda() else "no CUDA: CPU decode, slower but identical output"))
    results.append(("hyperframes", *check_hyperframes()))
    for name, ok, detail in results:
        print(f"{'OK  ' if ok else 'FAIL'} {name:12} {detail}")
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main("--fetch" in sys.argv[1:], "--render" in sys.argv[1:]))
