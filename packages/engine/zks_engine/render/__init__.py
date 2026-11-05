# Created by The Angelo Umali.
# render_master (plan §6.8): the overlays and SFX mix, then render_final's chunked master, then the frame and loudness gates.
# 4K is HEVC on the NVIDIA composite; every other backend delivers a 1080 master (plan §14 Phase 5).
import subprocess
import sys

from .. import backends, caption_layer, pipeline, qc, render_final, sfx
from ..pipeline import HF_DIR, loudness
from ..qc import inputs, learning, text_gates
from ..specs import gates
from ..specs.gates import GateFailed
from .stages import edit_stage

UHD_BACKEND = "nvidia"


def master_flags(backend_name, quality):
    """(draft, uhd) for render_final."""
    return quality == "draft", quality == "4k" and backend_name == UHD_BACKEND


def master_path(work, video, draft, uhd):
    return work / "out" / f"{video}{'-4k' if uhd else '-draft' if draft else ''}.mp4"


def style_flags():
    """--style when the project set one (work/style.json, written by the server); in a job, the copy its snapshot took."""
    style = pipeline.spec_file(pipeline.WORK, "style.json")
    return ["--style", str(style)] if style.exists() else []


def render_stills(video, names, times, *flags):
    """hf/render.js --stills of those cue sheets, composited on the proxy, into stills/<names>.hf/t<at>.png. A refusal
    (a cover title still animating in) is a gate naming its reason."""
    command = ["node", str(HF_DIR / "render.js"), f"{video}:{'+'.join(names)}", "--stills", *times, *flags, *style_flags()]
    result = subprocess.run(command, stderr=subprocess.PIPE, text=True)
    sys.stderr.write(result.stderr)
    if result.returncode:
        lines = result.stderr.strip().splitlines()
        raise GateFailed(f"stills: {lines[-1] if lines else f'render.js exit {result.returncode}'}")
    return pipeline.WORK / "stills" / f"{'+'.join(names)}.hf"


def cue_sheet_names(video, work):
    """The cue sheets render.js draws for a video, in order: the main sheet, a reel's own overrides, then the captions."""
    base = inputs.read_json(work / "edl" / f"{video}.json").get("base", video)
    names = [base, *([video] if video != base else []), f"{base}-cc"]
    return [name for name in names if pipeline.spec_file(work, f"cues/{name}.json").exists()]


def run_step(command, name):
    """One overlay step; a failure raises its own last error line (a word too wide, a missing clip), not an exit code, so
    the job and the agent see what to fix."""
    result = subprocess.run(command, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.stderr:
        sys.stderr.write(result.stderr)
    if result.returncode:
        lines = [line for line in (result.stderr or "").splitlines() if line.strip()]
        raise GateFailed(f"{name}: {lines[-1] if lines else f'exit {result.returncode}'}")


def draw_overlays(video):
    """The SFX sheet first, since sfx.py picks the intro's insert that the overlay frames are then drawn around; the
    footage cards' clips before the frames that play them; then the behind layer, his matte and the caption layer."""
    target = f"{video}:{'+'.join(cue_sheet_names(video, pipeline.WORK))}"
    style = style_flags()
    render_js = ["node", str(HF_DIR / "render.js"), target]
    run_step([*render_js, "--events", *style], "render.js")
    if learning.is_learning():  # text never overlaps text (#43): seconds here, against a frame render and a QC
        run_step([*render_js, "--boxes", *style], "render.js")
        text_gates.check(video)
    sfx.main(video)
    if learning.is_learning():  # density and variety from the sheet: seconds here, against a 20-min render and a QC
        learning.check_sheet(video)
    run_step([sys.executable, "-m", "zks_engine.cardclip", target, *style], "cardclip")
    run_step([*render_js, *style], "render.js")
    run_step([*render_js, "--layer", "behind", *style], "render.js")
    frames = pipeline.WORK / "frames"
    if inputs.read_json(pipeline.WORK / "edl" / f"{video}.json").get("matte"):
        run_step([sys.executable, "-m", "zks_engine.matte", video], "matte")
    elif (frames / f"{video}.behind").is_dir():
        raise GateFailed(f'{video}: a depth "behind" cue draws under him only inside a matte window; add matteRanges over it or drop the depth')
    caption_layer.build(video)  # also clears the last render's caption frames when this edit has none


def render_master(video, quality, source, backend=None, edit=edit_stage, preflight=render_final.preflight, overlays=draw_overlays,
                  encode=render_final.main, work=None):
    """-> {path (relative to the work dir), frames, lufs, truePeak, bytes, master, inputs}; GateFailed when the master misses the EDL or -14 LUFS.
    The edit stage runs first, so the master's frame and loudness gates judge the current cut spec."""
    work = work or pipeline.WORK
    draft, uhd = master_flags((backend or backends.active()).name, quality)
    edit(video, source)
    preflight(video)
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
