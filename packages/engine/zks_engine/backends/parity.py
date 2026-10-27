# Created by The Angelo Umali.
# Backend parity (plan §7, §10.3): one 2 s fixture through the real chunk composite on every backend whose probe encode
# passed, each held to SSIM >= 0.995 against the cpu render. Run by scripts/verify-gpu.mjs after its hygiene refusals.
# Usage: python -m zks_engine.backends.parity
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from .. import backends, ffio
from ..edl import PUNCH_CROP
from ..pipeline import OUTPUT
from ..render_final import chunk_command, route_for
from ..slots import slot

THRESHOLD = 0.995
FPS_NUM, FPS_DEN = 30000, 1001
FRAMES = 60
EDL = {"fps_num": FPS_NUM, "fps_den": FPS_DEN, "frames": FRAMES, "base": "parity", "punch_crop": PUNCH_CROP, "bleeps": [], "cutaways": [],
       "segments": [{"in": 0, "out": FRAMES, "target": 0, "zoom": 1.0, "cut_after": "pause"}]}
RATE = f"{FPS_NUM}/{FPS_DEN}"


def build_fixture(root):
    """Moving footage plus a moving translucent overlay, so a frozen or misaligned composite scores low."""
    ffmpeg = ffio.ffmpeg_bin()
    subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={OUTPUT[0]}x{OUTPUT[1]}:rate={RATE}", "-frames:v", str(FRAMES),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", str(root / "source.mp4")], check=True)
    (root / "frames").mkdir(exist_ok=True)
    box = "drawbox=x=40+t*360:y=300:w=360:h=200:color=gold@0.8:t=fill"
    subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black@0.0:s={OUTPUT[0]}x{OUTPUT[1]}:r={RATE},format=rgba,{box}",
                    "-frames:v", str(FRAMES), "-start_number", "0", str(root / "frames" / "%05d.png")], check=True)


def render(backend, root):
    out = root / f"{backend.name}.mp4"
    route = route_for(root / "source.mp4", backend)
    command = chunk_command(EDL, 0, {}, root / "source.mp4", route, OUTPUT, backend.master(False), root / "frames", out)
    subprocess.run(command, check=True)
    return out


def ssim(candidate, reference):
    result = subprocess.run([ffio.ffmpeg_bin(), "-hide_banner", "-i", str(candidate), "-i", str(reference), "-lavfi", "ssim", "-f", "null", "-"],
                            capture_output=True, text=True, check=True)
    return float(re.findall(r"All:([\d.]+)", result.stderr)[-1])


def main():
    passed = [attempt["backend"] for attempt in backends.probe_attempts(refresh=True) if attempt["ok"] and attempt["backend"] != "cpu"]
    if not passed:
        print("skip: no GPU backend passed the probe, so there is nothing to hold against the cpu render")
        return 0
    failures = 0
    with tempfile.TemporaryDirectory() as folder, slot("gpu", "verify:gpu parity"):
        root = Path(folder)
        build_fixture(root)
        reference = render(backends.get("cpu"), root)
        for name in passed:
            backend = backends.get(name)
            score = ssim(render(backend, root), reference)
            ok = score >= THRESHOLD
            failures += not ok
            proof = "" if backend.hardware_tested else " (untested on hardware)"
            print(f"{'PASS' if ok else 'FAIL'} {name} SSIM {score:.4f} vs cpu, threshold {THRESHOLD}{proof}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
