# Created by The Angelo Umali.
# Apple VideoToolbox: hardware decode and encode around the CPU-filter composite. Proven on the macOS CI runner only.
from .profile import HEVC_TAGS, MASTER_MAX_BPS, UHD_CAP, Backend


def master(draft):
    # A bitrate, not -q:v: -q:v is Apple-silicon only.
    return ["-c:v", "h264_videotoolbox", "-b:v", str(MASTER_MAX_BPS), "-profile:v", "high"]


BACKEND = Backend(
    name="videotoolbox",
    hardware_tested=False,
    probe_encoder="hevc_videotoolbox",
    decode=["-hwaccel", "videotoolbox"],
    master=master,
    uhd=["-c:v", "hevc_videotoolbox", "-b:v", "40M", *UHD_CAP, *HEVC_TAGS],
    mezzanine=["-c:v", "hevc_videotoolbox", "-b:v", "80M", *HEVC_TAGS],
    proxy=["-c:v", "h264_videotoolbox", "-b:v", "8M"],
    jobs=lambda cores: 2,  # until benchmarked (plan §7.2)
    upload=",format=nv12",
)
