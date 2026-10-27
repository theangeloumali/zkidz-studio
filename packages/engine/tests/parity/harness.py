# Created by The Angelo Umali.
# Builds a throwaway project from a fixture clip, renders it with render_final on one backend and scores frames by SSIM.
# Regenerate the committed media from packages/engine/tests: `python -m parity.harness fixtures` then `... golden`.
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

from support import make_edl, has_ffmpeg  # first: it sets a scratch ZKS_HOME
from zks_engine import ffio
from zks_engine.edl import FACECAM_ZOOM
from zks_engine.pipeline import OUTPUT, frame_to_sample

from . import MACHINE_LOCKS

REPO = Path(__file__).resolve().parents[4]
FIXTURES = REPO / "fixtures" / "parity"
GOLDEN = FIXTURES / "golden"
GOLDEN_SSIM = 0.97  # plan §10.3: the CPU render on any OS against the committed frames
PARITY_SSIM = 0.995  # plan §12: a hardware backend against the CPU render of the same spec
SOURCE_SIZE = (360, 640)  # the clips' upright size; frames are compared here, as the 1080p master holds no more detail
CLIP_SECONDS = 2
# The moving-footage gate (plan §10.3): testsrc2's diagonal sweep on SOURCE_SIZE, clear of the overlay box and the blur box.
MOTION_REGION = (120, 200, 180, 160)  # x, y, width, height
MOTION_FRAME = 10  # edited frame k and k + 1 sit in every clip's first keep, so they are source frames k and k + 1
MOTION_SHARE = 0.5  # a master must keep at least this share of its source's frame-to-frame change
# One privacy box (source seconds, 1080-grid box) so every backend's blur path is in the comparison.
BLUR = [[0.2, 1.0, 60, 1400, 400, 300, "parity fixture"]]


@dataclass(frozen=True)
class Clip:
    name: str  # fixture file stem and video id
    fps: tuple[int, int]
    keep: tuple[tuple[int, int], ...]  # source frame ranges; the second one is punched in
    golden: str  # whose golden frames the render must match: the rotated clip plays the NTSC clip's picture


CLIPS = {
    "ntsc": Clip("clip-2997", (30000, 1001), ((0, 24), (34, 59)), "clip-2997"),
    "film": Clip("clip-23976", (24000, 1001), ((0, 20), (28, 47)), "clip-23976"),
    "rotated": Clip("clip-rot-90", (30000, 1001), ((0, 24), (34, 59)), "clip-2997"),
}


def source_of(clip):
    return FIXTURES / f"{clip.name}.mp4"


def edl_of(clip):
    num, den = clip.fps
    return {**make_edl(clip.keep, [1.0, FACECAM_ZOOM]), "fps_num": num, "fps_den": den}


def check_frames(clip):
    """First frame, the first punched-in frame after the cut, last frame."""
    frames = edl_of(clip)["frames"]
    return [0, clip.keep[0][1] - clip.keep[0][0], frames - 1]


def golden_of(clip, frame):
    return GOLDEN / f"{clip.golden}-{frame:05d}.png"


def ffmpeg(*args):
    result = subprocess.run([ffio.ffmpeg_bin(), "-hide_banner", "-nostdin", *args], capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"ffmpeg {' '.join(args[:6])}...: {result.stderr.strip()[-1500:]}")
    return result


def skip_without_ffmpeg():
    """CI sets ZKS_REQUIRE_GOLDEN=1 so a missing ffmpeg fails the golden job instead of quietly skipping it."""
    if has_ffmpeg():
        return
    if os.environ.get("ZKS_REQUIRE_GOLDEN") == "1":
        raise AssertionError(f"ZKS_REQUIRE_GOLDEN=1 but ffmpeg is not at {ffio.ffmpeg_bin()}")
    raise unittest.SkipTest("needs ffmpeg (ZKS_FFMPEG or PATH)")


def skip_unless_usable(backend):
    """The backend's own probe encode decides: a runner without a working encoder (a macOS VM's videotoolbox) skips with why."""
    try:
        from zks_engine import backends
    except ImportError:
        raise unittest.SkipTest("zks_engine.backends is not in this build (slice 3a), so ZKS_BACKEND cannot pin a backend") from None
    if not backends.run_probe(backends.get(backend)):
        raise unittest.SkipTest(f"{backend}: the probe's test encode failed with {ffio.ffmpeg_bin()} on this machine")


def make_fixtures():
    """The committed clips: lavfi testsrc2 + a sine, so no third-party media enters the repo."""
    FIXTURES.mkdir(parents=True, exist_ok=True)
    width, height = SOURCE_SIZE
    # veryslow alone picks 16 refs, which NVDEC refuses: ffmpeg then decodes on the CPU and parity never touches NVDEC.
    video = ["-c:v", "libx264", "-preset", "veryslow", "-refs", "4", "-crf", "26", "-pix_fmt", "yuv420p"]
    encode = [*video, "-c:a", "aac", "-b:a", "64k", "-ac", "1"]
    for clip in (CLIPS["ntsc"], CLIPS["film"]):
        rate = f"{clip.fps[0]}/{clip.fps[1]}"
        ffmpeg("-y", "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate={rate}:duration={CLIP_SECONDS}", "-f", "lavfi", "-i",
               f"sine=frequency=440:sample_rate=48000:duration={CLIP_SECONDS}", *encode, "-shortest", str(source_of(clip)))
    # A phone held sideways: the NTSC picture stored a quarter-turn counter-clockwise, tagged -90 so players stand it upright.
    with tempfile.TemporaryDirectory() as folder:
        landscape = Path(folder) / "landscape.mp4"
        ffmpeg("-y", *ffio.user_input_args(source_of(CLIPS["ntsc"])), "-vf", "transpose=cclock", *video, "-c:a", "copy", str(landscape))
        ffmpeg("-y", "-display_rotation:v:0", "-90", *ffio.user_input_args(landscape), "-c", "copy", str(source_of(CLIPS["rotated"])))


def build_project(clip, folder):
    """`folder` as a project root: the clip under media/, and work/ holding its EDL, cut spec, edit audio and overlay frames.
    The overlay is an ffmpeg-drawn moving box, so the golden does not depend on each OS's Chrome font rendering."""
    folder = Path(folder)
    work = folder / "work"
    for sub in ("edl", "cuts", "audio", f"frames/{clip.name}"):
        (work / sub).mkdir(parents=True, exist_ok=True)
    media = folder / "media" / source_of(clip).name
    media.parent.mkdir(exist_ok=True)
    shutil.copyfile(source_of(clip), media)
    edl = edl_of(clip)
    (work / "edl" / f"{clip.name}.json").write_text(json.dumps(edl), encoding="utf-8")
    (work / "cuts" / f"{clip.name}.json").write_text(json.dumps({"source": f"media/{media.name}", "blur": BLUR}), encoding="utf-8")
    samples = frame_to_sample(edl["frames"], edl)
    ffmpeg("-y", *ffio.user_input_args(media), "-vn", "-af", f"aresample=48000,apad,atrim=end_sample={samples}", "-ac", "2", "-c:a", "pcm_s16le",
           str(work / "audio" / f"{clip.name}_edit.wav"))
    rate, (width, height) = f"{clip.fps[0]}/{clip.fps[1]}", OUTPUT
    # format=auto blends in RGBA: overlay's default yuv420 blend onto a main with alpha gives different pixels on every run (n8.1).
    ffmpeg("-y", "-f", "lavfi", "-i", f"color=c=black@0:s={width}x{height}:r={rate},format=rgba", "-f", "lavfi", "-i",
           f"color=c=gold@0.85:s=320x120:r={rate},format=rgba", "-filter_complex", "[0:v][1:v]overlay=x='80+12*n':y=300:format=auto,format=rgba",
           "-frames:v", str(edl["frames"]), "-start_number", "0", str(work / "frames" / clip.name / "%05d.png"))
    return work


def cpu_only_path(path):
    """phase/1 render_final takes CUDA whenever nvidia-smi is on PATH; hiding it keeps the reference on the CPU there too."""
    return os.pathsep.join(entry for entry in path.split(os.pathsep) if entry and not shutil.which("nvidia-smi", path=entry))


def render(clip, backend, folder):
    """The clip's master rendered on `backend` (the ZKS_BACKEND pin). A hardware render takes the machine-wide gpu slot."""
    work = build_project(clip, folder)
    env = {**os.environ, "ZKS_WORK": str(work), "ZKS_BACKEND": backend}
    if backend == "cpu":
        env["PATH"] = cpu_only_path(env.get("PATH", ""))
    else:
        env["ZKS_LOCKS"] = str(MACHINE_LOCKS)
    result = subprocess.run([sys.executable, "-m", "zks_engine.render_final", clip.name], cwd=folder, env=env, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"render_final {clip.name} on {backend} failed: {(result.stderr or result.stdout).strip()[-2000:]}")
    return work / "out" / f"{clip.name}.mp4"


def frame_png(video, index, out, region=None):
    """Frame `index` of a video, scaled to SOURCE_SIZE (then cropped to `region`), as an RGB PNG."""
    width, height = SOURCE_SIZE
    crop = ",crop={2}:{3}:{0}:{1}".format(*region) if region else ""
    ffmpeg("-y", *ffio.user_input_args(video), "-vf", f"select='eq(n\\,{index})',scale={width}:{height}:flags=area{crop},format=rgb24",
           "-frames:v", "1", "-fps_mode", "passthrough", str(out))
    return out


def frame_digests(video):
    """One MD5 per decoded frame: two renders of one spec must match frame for frame, whatever their container bytes."""
    listing = ffmpeg(*ffio.user_input_args(video), "-map", "0:v", "-f", "framemd5", "-").stdout
    return [line.rsplit(",", 1)[-1].strip() for line in listing.splitlines() if line and not line.startswith("#")]


def ssim(first, second):
    """SSIM of two same-size PNGs over the R, G and B planes (one RGB space: no YUV matrix guess on either side)."""
    log = ffmpeg(*ffio.user_input_args(first), *ffio.user_input_args(second), "-filter_complex", "[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim",
                 "-f", "null", "-").stderr
    return float(re.findall(r"All:([\d.]+)", log)[-1])


def motion(video, frame):
    """How much MOTION_REGION changes from `frame` to the next (1 - SSIM): about 0 when the footage is frozen."""
    with tempfile.TemporaryDirectory() as folder:
        pngs = [frame_png(video, index, Path(folder) / f"{index}.png", MOTION_REGION) for index in (frame, frame + 1)]
        return 1 - ssim(*pngs)


def encoded_by_x264(video):
    """libx264 writes its version banner into the stream: proof the CPU reference was not quietly a hardware encode."""
    return b"x264 - core" in Path(video).read_bytes()


def update_golden():
    GOLDEN.mkdir(parents=True, exist_ok=True)
    for clip in CLIPS.values():
        if clip.golden != clip.name:
            continue
        with tempfile.TemporaryDirectory() as folder:
            master = render(clip, "cpu", folder)
            for frame in check_frames(clip):
                frame_png(master, frame, golden_of(clip, frame))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="parity.harness", description="regenerate the committed parity fixtures")
    parser.add_argument("what", choices=("fixtures", "golden"))
    make_fixtures() if parser.parse_args(argv).what == "fixtures" else update_golden()


if __name__ == "__main__":
    main()
