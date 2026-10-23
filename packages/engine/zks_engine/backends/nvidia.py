# Created by The Angelo Umali.
# NVIDIA: NVDEC + NVENC. render_final keeps its CUDA/OpenCL composite (gpu_graph) for upright footage; this profile is
# what the CPU-filter fallback and the other stages encode with.
from .profile import HEVC_TAGS, MASTER_CAP, UHD_CAP, Backend

# p7 + lookahead + AQ + B-frame refs: shared by the H.264 master and the HEVC 4K export.
NVENC_QUALITY = ["-preset", "p7", "-tune", "hq", "-rc-lookahead", "32", "-spatial-aq", "1", "-temporal-aq", "1", "-bf", "3",
                 "-b_ref_mode", "middle"]
# The apps re-compress every upload, so the 4K export spends bits on quality: screen text is what starves first.
UHD_ENCODER = ["-c:v", "hevc_nvenc", *NVENC_QUALITY, "-multipass", "fullres", "-rc", "vbr", "-cq", "17", "-b:v", "0", *UHD_CAP, *HEVC_TAGS]


def master(draft):
    preset = ["-preset", "p4"] if draft else NVENC_QUALITY
    return ["-c:v", "h264_nvenc", *preset, "-rc", "vbr", "-cq", "19", "-b:v", "10M", *MASTER_CAP, "-profile:v", "high"]


BACKEND = Backend(
    name="nvidia",
    hardware_tested=True,
    probe_encoder="hevc_nvenc",
    decode=["-hwaccel", "cuda"],
    master=master,
    uhd=UHD_ENCODER,
    mezzanine=["-c:v", "hevc_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "14", "-b:v", "0", "-spatial-aq", "1"],
    proxy=["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "16", "-b:v", "0"],
    # 1 job leaves the GPU ~75% idle; v6 4K slices: 1 job 28.7 fps, 2 jobs 49.1, 4 jobs 66.0, 6 jobs 67.0.
    jobs=lambda cores: 4,
)
