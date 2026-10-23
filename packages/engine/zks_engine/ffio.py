# Created by The Angelo Umali.
# ffmpeg input policy (plan §7.5). ffmpeg allows every protocol by default, so a playlist renamed .mp4 could open other
# files or URLs: user media is sniffed before ffmpeg sees it, then read under protocol and container whitelists.
import json
import os
import re
import subprocess
from pathlib import Path

PROTOCOLS = "file,pipe"
# Demuxer names as ffprobe reports them; *_pipe are the single-still demuxers ffmpeg picks for png/jpeg/webp.
FORMATS = ("mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "avi", "mpegts", "wav", "mp3", "flac", "aac", "ogg", "image2",
           "png_pipe", "jpeg_pipe", "webp_pipe")
REJECTED_FORMATS = {"hls", "concat", "dash", "image2pipe"}
WHITELISTS = ["-protocol_whitelist", PROTOCOLS, "-format_whitelist", ",".join(FORMATS)]
SNIFF_BYTES = 4096
SEQUENCE = re.compile(r"%\d*d")
URL_LIKE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]+:")  # a scheme or protocol; a drive letter (C:) is one letter
HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}


class MediaRejected(ValueError):
    """User media that is not a plain local media file."""


class ToolMissing(RuntimeError):
    """The pinned ffmpeg/ffprobe is not where the environment says it is."""


def check_user_media(path):
    """The resolved path of a plain local media file, or MediaRejected saying why it is not one."""
    text = str(path)
    if URL_LIKE.match(text) or Path(text).name.startswith("-"):
        raise MediaRejected(f"{text}: not a local file path")
    resolved = Path(text).resolve()
    if SEQUENCE.search(resolved.name):
        raise MediaRejected(f"{resolved.name}: an image sequence pattern, not one file")
    if not resolved.is_file():
        raise MediaRejected(f"{resolved}: not a file")
    with open(resolved, "rb") as handle:
        head = handle.read(SNIFF_BYTES)
    sniff_media(head, resolved.name)
    return resolved


def sniff_media(head, name):
    """Media containers are binary from the first bytes; playlists, lists and URL files are text whatever their name."""
    stripped = head.lstrip(b"\xef\xbb\xbf \t\r\n")
    if stripped.startswith(b"#EXTM3U") or b"#EXT-X-" in head:
        raise MediaRejected(f"{name}: an HLS playlist, not media")
    if stripped.startswith(b"ffconcat") or re.match(rb"(#[^\n]*\n|\s)*file\s", stripped):
        raise MediaRejected(f"{name}: a concat list, not media")
    if b"\x00" not in head:
        try:
            head.decode("utf-8")
        except UnicodeDecodeError:
            return
        raise MediaRejected(f"{name}: a text file (playlist, manifest or URL), not media")


def user_input_args(path):
    """`-i` for one user media file, with the whitelists in front."""
    resolved = check_user_media(path)
    return [*WHITELISTS, "-i", str(resolved)]


def check_probed_format(format_name):
    """ffprobe's demuxer for a file: the sniff misses binary tricks, so the probed container is checked too."""
    names = set(format_name.split(","))
    if names & REJECTED_FORMATS or not names & set(FORMATS):
        raise MediaRejected(f"container {format_name} is not allowed for user media")


def concat_listing(paths):
    """An engine concat list. `'` is escaped as '\\'' (a home folder like O'Brien); a newline would start a new directive."""
    lines = []
    for path in paths:
        posix = Path(path).as_posix()
        if "\n" in posix or "\r" in posix:
            raise ValueError(f"{posix!r}: a newline cannot appear in a concat list entry")
        lines.append("file '" + posix.replace("'", "'\\''") + "'\n")
    return "".join(lines)


def concat_input_args(listing):
    """`-safe 0` only ever reads a list concat_listing wrote."""
    return ["-f", "concat", "-safe", "0", "-protocol_whitelist", PROTOCOLS, "-i", str(listing)]


def rational(text):
    num, _, den = (text or "0/0").partition("/")
    return int(num), int(den or 1)


def ffmpeg_bin():
    """The pinned ffmpeg the server checked at startup (ZKS_FFMPEG); PATH only in a dev checkout."""
    return os.environ.get("ZKS_FFMPEG") or "ffmpeg"


def ffprobe_bin():
    """The pinned ffprobe the server checked at startup: ZKS_FFPROBE, else beside ZKS_FFMPEG; PATH only in a dev checkout."""
    if os.environ.get("ZKS_FFPROBE"):
        return os.environ["ZKS_FFPROBE"]
    if os.environ.get("ZKS_FFMPEG"):
        ffmpeg = Path(os.environ["ZKS_FFMPEG"])
        return str(ffmpeg.with_name("ffprobe.exe" if ffmpeg.name.lower().endswith(".exe") else "ffprobe"))
    return "ffprobe"


def probe(path):
    """The probe_media contract (@zks/shared tools/media.ts): size is upright, as a player shows it."""
    source = check_user_media(path)
    ffprobe = ffprobe_bin()
    try:
        result = subprocess.run([ffprobe, "-v", "error", *WHITELISTS, "-show_format", "-show_streams", "-of", "json", str(source)],
                                capture_output=True, text=True)
    except FileNotFoundError:
        raise ToolMissing(f"ffprobe is not installed at {ffprobe}. Run: pnpm zks setup") from None
    if result.returncode:
        raise MediaRejected(f"{Path(path).name}: ffprobe could not read it ({result.stderr.strip()[-300:]})")
    info = json.loads(result.stdout)
    check_probed_format(info["format"]["format_name"])
    video = next((stream for stream in info["streams"] if stream.get("codec_type") == "video"), None)
    if video is None:
        raise MediaRejected(f"{Path(path).name}: no video stream")
    audio = next((stream for stream in info["streams"] if stream.get("codec_type") == "audio"), None)
    rotation = next((round(data["rotation"]) for data in video.get("side_data_list", []) if "rotation" in data), 0) % 360
    width, height = (video["height"], video["width"]) if rotation in (90, 270) else (video["width"], video["height"])
    num, den = rational(video.get("r_frame_rate"))
    return {
        "durationS": float(info["format"].get("duration") or video.get("duration") or 0),
        "fps": {"num": num, "den": den},
        "size": {"width": width, "height": height},
        "rotation": rotation,
        "hdr": video.get("color_transfer") in HDR_TRANSFERS,
        "audio": {"rate": int(audio["sample_rate"]), "channels": int(audio["channels"])} if audio else None,
        "vfr": rational(video.get("avg_frame_rate")) not in ((num, den), (0, 0)),
    }
