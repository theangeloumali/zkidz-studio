# Created by The Angelo Umali.
# Intel Quick Sync: hardware decode and encode around the CPU-filter composite. Untested on hardware.
from .profile import HEVC_TAGS, MASTER_CAP, UHD_CAP, Backend


def master(draft):
    return ["-c:v", "h264_qsv", "-preset", "veryfast" if draft else "veryslow", "-global_quality", "19", *MASTER_CAP, "-profile:v", "high"]


BACKEND = Backend(
    name="qsv",
    hardware_tested=False,
    probe_encoder="hevc_qsv",
    decode=["-hwaccel", "qsv"],
    master=master,
    uhd=["-c:v", "hevc_qsv", "-preset", "veryslow", "-global_quality", "17", "-look_ahead_depth", "40", *UHD_CAP, *HEVC_TAGS],
    mezzanine=["-c:v", "hevc_qsv", "-preset", "slow", "-global_quality", "14", *HEVC_TAGS],
    proxy=["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "18"],
    jobs=lambda cores: 2,  # until benchmarked (plan §7.2)
    upload=",format=nv12",
)
