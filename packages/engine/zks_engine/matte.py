# Created by The Angelo Umali.
# Person matte for the depth layer (frame break, green screen, frame escape) and sticker cutouts, by Robust Video Matting
# (GPL-3.0, fetched by torch.hub into the user cache, never vendored). Reads the 1080x1920 proxy, so mask frame n is source
# frame n; render_final crops it exactly like the footage.
# Usage (from the work dir): python -m zks_engine.matte v80                 → mask/<base>.mkv over the cut spec's "matte" windows
#                            python -m zks_engine.matte v80 --cutout 21.6   → cutouts/v80-21.60.png (RGBA, the person only)
import subprocess
import sys

import numpy as np

from . import ffio
from .pipeline import FPS, FPS_DEN, FPS_NUM, OUTPUT, WORK, load_cuts

WARMUP = 1.0  # seconds run before a window so RVM's recurrent state has settled on its first frame
ENCODER = ["-c:v", "hevc_nvenc", "-tune", "lossless", "-pix_fmt", "yuv420p", "-color_range", "tv"]


def matted_frames(windows, total):
    """Source frame indices inside the cut spec's matte windows (source seconds), clamped to the clip."""
    frames = set()
    for at, end in windows:
        frames.update(range(max(0, round(at * FPS)), min(total, round(end * FPS))))
    return sorted(frames)


def cutout_name(video, seconds):
    return f"{video}-{seconds:.2f}.png"


def runs(frames):
    """Consecutive frame indices as (first, count) runs."""
    result = []
    for frame in frames:
        if result and frame == result[-1][0] + result[-1][1]:
            result[-1][1] += 1
        else:
            result.append([frame, 1])
    return [tuple(run) for run in result]


# Pinned and checked: torch.hub runs the repo's hubconf, so an unpinned branch would run whatever it holds that day.
RVM_REPO = "PeterL1n/RobustVideoMatting:53d74c6826735f01f4406b5ca9075eee27bec094"
RVM_WEIGHTS = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50.pth"
RVM_SHA256 = "c191a807251164c073dce5fa408e7a816070d539b882b2a3150330a9fec112ce"


def model():
    import hashlib
    from pathlib import Path

    import torch

    weights = Path(torch.hub.get_dir()) / "checkpoints" / "rvm_resnet50.pth"
    if not weights.exists():
        weights.parent.mkdir(parents=True, exist_ok=True)
        torch.hub.download_url_to_file(RVM_WEIGHTS, str(weights), hash_prefix=RVM_SHA256[:16])
    if hashlib.sha256(weights.read_bytes()).hexdigest() != RVM_SHA256:
        sys.exit(f"{weights}: SHA-256 does not match the reviewed RVM v1.0.0 weights")
    net = torch.hub.load(RVM_REPO, "resnet50", pretrained=False, trust_repo=True)
    net.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    return net.eval().cuda().half()


def proxy_frames(proxy, first, count):
    width, height = OUTPUT
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{first / FPS:.6f}", "-i", str(proxy), "-frames:v", str(count),
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width, 3)


def alphas(net, frames):
    """RVM alpha (0..1 float) per frame, the recurrent state carried across the run."""
    import torch

    state, out = [None] * 4, []
    with torch.no_grad():
        for frame in frames:
            image = torch.from_numpy(np.ascontiguousarray(frame)).cuda().permute(2, 0, 1)[None].half() / 255
            _, alpha, *state = net(image, *state, downsample_ratio=0.25)
            out.append(alpha[0, 0].float().cpu().numpy())
    return out


def encode(pipe_frames, count, out):
    """Gray masks as TV-range luma (16..235), lossless HEVC on NVENC; render_final expands them back after the crop."""
    width, height = OUTPUT
    encoder = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{width}x{height}",
                                "-framerate", f"{FPS_NUM}/{FPS_DEN}", "-i", "-", *ENCODER, "-frames:v", str(count), str(out)],
                               stdin=subprocess.PIPE)
    for mask in pipe_frames:
        encoder.stdin.write((16 + np.clip(mask, 0, 1) * 219).astype(np.uint8).tobytes())
    encoder.stdin.close()
    if encoder.wait():
        sys.exit(f"mask encode failed: {out}")


def black(count, out):
    width, height = OUTPUT
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:r={FPS_NUM}/{FPS_DEN}",
                    *ENCODER, "-frames:v", str(count), str(out)], check=True)


def build_mask(video):
    spec = load_cuts(video)
    base = spec.get("base", video)
    proxy = WORK / "mezz" / f"{base}.mp4"
    total = round(spec["duration"] * FPS)
    frames = matted_frames(spec.get("matte", []), total)
    if not frames:
        sys.exit(f"{video}: the cut spec has no matte windows")
    net, pieces, cursor = model(), [], 0
    folder = WORK / "mask" / f"{base}-pieces"
    folder.mkdir(parents=True, exist_ok=True)
    for first, count in runs(frames):
        if first > cursor:
            pieces.append(folder / f"{len(pieces):03d}.mkv")
            black(first - cursor, pieces[-1])
        warm = min(first, round(WARMUP * FPS))
        masks = alphas(net, proxy_frames(proxy, first - warm, count + warm))[warm:]
        pieces.append(folder / f"{len(pieces):03d}.mkv")
        encode(masks, count, pieces[-1])
        print(f"matted {first / FPS:.2f}-{(first + count) / FPS:.2f}s ({count} frames)", flush=True)
        cursor = first + count
    if cursor < total:
        pieces.append(folder / f"{len(pieces):03d}.mkv")
        black(total - cursor, pieces[-1])
    listing = folder / "pieces.txt"
    listing.write_text(ffio.concat_listing(pieces), encoding="utf-8")
    out = WORK / "mask" / f"{base}.mkv"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *ffio.concat_input_args(listing), "-c", "copy", str(out)], check=True)
    print(f"wrote {out}")


def build_cutout(video, seconds):
    from PIL import Image

    base = load_cuts(video).get("base", video)
    first = round(seconds * FPS)
    warm = min(first, round(WARMUP * FPS))
    frames = proxy_frames(WORK / "mezz" / f"{base}.mp4", first - warm, warm + 1)
    alpha = alphas(model(), frames)[-1]
    rgba = np.dstack([frames[-1], (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    out = WORK / "cutouts" / cutout_name(video, seconds)
    out.parent.mkdir(exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    name, flags = sys.argv[1], sys.argv[2:]
    if "--cutout" in flags:
        for index, flag in enumerate(flags):
            if flag == "--cutout":
                build_cutout(name, float(flags[index + 1]))
    else:
        build_mask(name)
