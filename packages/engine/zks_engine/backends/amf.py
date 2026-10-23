# Created by The Angelo Umali.
# AMD AMF (Windows): D3D11 decode and AMF encode around the CPU-filter composite. Untested on hardware.
from .profile import HEVC_TAGS, MASTER_CAP, Backend


def master(draft):
    return ["-c:v", "h264_amf", "-usage", "transcoding", "-quality", "speed" if draft else "quality", "-rc", "qvbr",
            "-qvbr_quality_level", "24", "-b:v", "10M", *MASTER_CAP, "-profile:v", "high"]


BACKEND = Backend(
    name="amf",
    hardware_tested=False,
    probe_encoder="hevc_amf",
    decode=["-hwaccel", "d3d11va"],
    master=master,
    uhd=["-c:v", "hevc_amf", "-usage", "transcoding", "-quality", "quality", "-rc", "qvbr", "-qvbr_quality_level", "26", "-b:v", "40M",
         "-maxrate", "60M", *HEVC_TAGS],
    mezzanine=["-c:v", "hevc_amf", "-usage", "transcoding", "-quality", "quality", "-rc", "cqp", "-qp_i", "14", "-qp_p", "14", *HEVC_TAGS],
    proxy=["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "18", "-qp_p", "18"],
    jobs=lambda cores: 2,
    upload=",format=nv12",
)
