# Created by The Angelo Umali.
# One render backend's profile: how it decodes, hands frames to its encoder, and encodes each kind of output.
from dataclasses import dataclass
from typing import Callable

MASTER_MAX_BPS = 12_000_000  # the 1080p H.264 master's cap; the boiling linework needs it
MASTER_CAP = ["-maxrate", str(MASTER_MAX_BPS), "-bufsize", str(2 * MASTER_MAX_BPS)]
UHD_CAP = ["-maxrate", "60M", "-bufsize", "120M"]
HEVC_TAGS = ["-profile:v", "main", "-tag:v", "hvc1"]  # hvc1: QuickTime and the apps refuse hev1


@dataclass(frozen=True)
class Backend:
    name: str
    hardware_tested: bool  # plan §7: qsv, amf, vaapi and videotoolbox ship before a render on their hardware here
    probe_encoder: str
    decode: list  # input args; frames come back in system memory, so autorotate turns them
    master: Callable[[bool], list]  # 1080 H.264 master, draft or full
    uhd: list  # 4K HEVC export
    mezzanine: list  # 4K HEVC intermediates (join_sources, showcase): near-lossless
    proxy: list  # 1080 H.264 review proxy
    jobs: Callable[[int], int]  # parallel encodes for this many CPU cores
    device: list = ()  # global args before the inputs
    upload: str = ""  # filter tail that hands the composite to the encoder
    libplacebo: bool = False  # the probe ran a libplacebo graph: a Vulkan GPU exists (WSL has only llvmpipe)
