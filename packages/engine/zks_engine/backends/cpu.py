# Created by The Angelo Umali.
# Software decode and libx264 / libx265: works everywhere, slowest. A 4K export here takes many times real time.
from .profile import HEVC_TAGS, MASTER_CAP, Backend


def master(draft):
    speed = ["-preset", "veryfast", "-crf", "20"] if draft else ["-preset", "slow", "-crf", "18", *MASTER_CAP]
    return ["-c:v", "libx264", *speed, "-pix_fmt", "yuv420p", "-profile:v", "high"]


X265_QUIET = ["-x265-params", "log-level=error"]

BACKEND = Backend(
    name="cpu",
    hardware_tested=True,
    probe_encoder="libx265",
    decode=[],
    master=master,
    uhd=["-c:v", "libx265", "-preset", "medium", "-crf", "17", *X265_QUIET, "-pix_fmt", "yuv420p", *HEVC_TAGS],
    mezzanine=["-c:v", "libx265", "-preset", "fast", "-crf", "14", *X265_QUIET, "-pix_fmt", "yuv420p", *HEVC_TAGS],
    proxy=["-c:v", "libx264", "-preset", "veryfast", "-crf", "16"],
    jobs=lambda cores: max(1, cores // 4),  # x264/x265 already spread over cores
)
