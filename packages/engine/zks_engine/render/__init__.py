# Created by The Angelo Umali.
# render_master (plan §6.8): the overlays and SFX mix, then render_final's chunked master, then the frame and loudness gates.
# 4K is HEVC on the NVIDIA composite; every other backend delivers a 1080 master (plan §14 Phase 5).
import subprocess

from .. import backends, pipeline, qc, render_final, sfx
from ..pipeline import HF_DIR, loudness
from ..qc import inputs
from ..specs import gates
from ..specs.gates import GateFailed
from .stages import edit_stage

UHD_BACKEND = "nvidia"


def master_flags(backend_name, quality):
    """(draft, uhd) for render_final."""
    return quality == "draft", quality == "4k" and backend_name == UHD_BACKEND


def master_path(work, video, draft, uhd):
    return work / "out" / f"{video}{'-4k' if uhd else '-draft' if draft else ''}.mp4"


def cue_sheet_names(video, work):
    """The cue sheets render.js draws for a video, in order: the main sheet, a reel's own overrides, then the captions."""
    base = inputs.read_json(work / "edl" / f"{video}.json").get("base", video)
    names = [base, *([video] if video != base else []), f"{base}-cc"]
    return [name for name in names if pipeline.spec_file(work, f"cues/{name}.json").exists()]


def draw_overlays(video):
    """The SFX sheet first, since sfx.py picks the intro's insert that the overlay frames are then drawn around."""
    target = f"{video}:{'+'.join(cue_sheet_names(video, pipeline.WORK))}"
    subprocess.run(["node", str(HF_DIR / "render.js"), target, "--events"], check=True)
    sfx.main(video)
    subprocess.run(["node", str(HF_DIR / "render.js"), target], check=True)


def render_master(video, quality, source, backend=None, edit=edit_stage, overlays=draw_overlays, encode=render_final.main, work=None):
    """-> {path (relative to the work dir), frames, lufs, truePeak, bytes, master, inputs}; GateFailed when the master misses the EDL or -14 LUFS.
    The edit stage runs first, so the master's frame and loudness gates judge the current cut spec."""
    work = work or pipeline.WORK
    draft, uhd = master_flags((backend or backends.active()).name, quality)
    edit(video, source)
    overlays(video)
    encode(video, draft, uhd)
    path = master_path(work, video, draft, uhd)
    master = qc.master_record(path, work)
    intro = inputs.intro_of(video, work)
    expected = inputs.read_json(work / "edl" / f"{video}.json")["frames"] + (intro["frames"] if intro else 0)
    frames = render_final.count_frames(path)
    if frames != expected:
        raise GateFailed(f"{path.name} has {frames} frames; the EDL needs {expected}")
    lufs, true_peak = loudness(path)
    gates.check_loudness(lufs, true_peak)
    return {"path": master["relPath"], "frames": frames, "lufs": lufs, "truePeak": true_peak, "bytes": master["size"], "master": master,
            "inputs": inputs.render_inputs(video, work)}
