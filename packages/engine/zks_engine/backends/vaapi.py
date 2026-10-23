# Created by The Angelo Umali.
# VA-API (Linux AMD / Intel): VA decode, the CPU-filter composite, then an upload to the render node for the VA encoder.
# Untested on hardware.
from .profile import HEVC_TAGS, Backend

RENDER_NODE = "/dev/dri/renderD128"

BACKEND = Backend(
    name="vaapi",
    hardware_tested=False,
    probe_encoder="hevc_vaapi",
    decode=["-hwaccel", "vaapi", "-hwaccel_device", "va"],
    master=lambda draft: ["-c:v", "h264_vaapi", "-rc_mode", "CQP", "-qp", "20", "-profile:v", "high"],
    uhd=["-c:v", "hevc_vaapi", "-rc_mode", "CQP", "-qp", "18", *HEVC_TAGS],
    mezzanine=["-c:v", "hevc_vaapi", "-rc_mode", "CQP", "-qp", "14", *HEVC_TAGS],
    proxy=["-c:v", "h264_vaapi", "-rc_mode", "CQP", "-qp", "18"],
    jobs=lambda cores: 2,
    device=["-init_hw_device", f"vaapi=va:{RENDER_NODE}", "-filter_hw_device", "va"],
    upload=",format=nv12,hwupload",
)
