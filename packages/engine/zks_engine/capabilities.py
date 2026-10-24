# Created by The Angelo Umali.
# ZKS_HOME/capabilities.json (plan §7.2): the probed backend and what the engine can render with it on this machine.
# get_capabilities and the Render page read it; `pnpm zks doctor` writes it through `zks-engine capabilities --json`.
import importlib.util
import json
import os
import shutil

from . import backends, doctor, render_final
from .home import zks_home
from .render import UHD_BACKEND, master_flags

FILE_NAME = "capabilities.json"
# whisper.cpp is the only transcriber the engine runs: the pinned ffmpeg is built --disable-whisper (plan §7.4).
TRANSCRIBER = "whisper.cpp"


def summarize(backend, opencl, hyperframes, torch):
    """getCapabilities.output; zooms and the matte need render_final's zoom_graph: CUDA + OpenCL + libplacebo."""
    zoom_graph = backend.name == UHD_BACKEND and opencl and backend.libplacebo
    return {
        "profile": backend.name,
        "features": {"uhd": master_flags(backend.name, "4k")[1], "intro": hyperframes, "zoomExpr": zoom_graph, "matte": zoom_graph and torch},
        "transcribe": TRANSCRIBER,
    }


def machine_support(backend):
    """What the features need beyond the backend: OpenCL (asked only on nvidia), the HyperFrames renderer, torch for RVM."""
    return {
        "opencl": backend.name == UHD_BACKEND and render_final.has_opencl(),
        "hyperframes": bool(shutil.which("node")) and doctor.check_chrome()[0] and doctor.check_hyperframes()[0],
        "torch": importlib.util.find_spec("torch") is not None,
    }


def write(capabilities):
    """tmp + rename, owner-only like the rest of ZKS_HOME: a reader never sees half a file."""
    home = zks_home()
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = home / FILE_NAME
    tmp = path.with_name(f"{FILE_NAME}.{os.getpid()}.tmp")
    descriptor = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as file:
        json.dump(capabilities, file, indent=2)
    os.replace(tmp, path)
    return path


def probe(refresh=False):
    """The probe (cached per ffmpeg SHA-256 + driver unless refresh), a ZKS_BACKEND pin honoured, written to ZKS_HOME."""
    attempts = backends.probe_attempts(refresh)
    backend = backends.active()
    capabilities = summarize(backend, **machine_support(backend))
    return {"capabilities": capabilities, "path": str(write(capabilities)), "attempts": attempts}
