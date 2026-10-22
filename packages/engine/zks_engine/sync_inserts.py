# Created by The Angelo Umali.
# Finds where a screen recording or a film plays inside a camera clip and drafts work/inserts/vN.draft.json for showcase.py.
# Sound first: the camera's mic hears the file through the room, so cross-correlation gives its offset to ~1 ms, and the
# offset jumps by exactly a pause's length. A silent file (a Playwright take) is matched on on-screen change instead, which
# needs the screen in the camera's view (--crop=x:y:w:h around the monitor, on the 1080-wide upright grid). That signal is
# spiky, so windows vote for one offset: a screen share recorded alongside the camera has a single offset throughout.
# Usage (repo root, ZKS_WORK=work):
#   python -m zks_engine.sync_inserts vN <camera clip> <file> [<file> ...] [--visual] [--crop=x:y:w:h] [--write]
import json
import subprocess
import sys
from functools import cache
from pathlib import Path
from typing import NamedTuple

import numpy as np

from . import ffio
from .pipeline import FPS_DEN, FPS_NUM, WORK, has_cuda, probe_video, rotation_of, upright_size
from .showcase import panel_for


class Mode(NamedTuple):
    name: str
    window: float  # seconds of camera signal matched at a time
    hop: float
    score: float  # weakest Pearson correlation that counts as playing
    same: float  # windows within this many seconds of offset are one continuous play


AUDIO = Mode("audio", 2.0, 0.5, 0.3, 0.15)
VISUAL = Mode("visual", 12.0, 1.0, 0.3, 0.15)
AUDIO_RATE = 8000
FRAME_RATE = FPS_NUM / FPS_DEN
SILENT_DB = -50.0  # a file quieter than this has no sound to match
CONFIDENT = 3.0  # the winning offset's vote must be this many times the runner-up's
MIN_VOTE_WINDOWS = 3  # and rest on at least this many windows
# A window half inside a play scores about 1/sqrt(2) of a full one, so this keeps it and its centre marks the edge.
EDGE_SHARE = 0.65
FULL_SHARE = 0.9  # a window scoring this share of the median lies wholly inside the play
CUVID = {"h264": "h264_cuvid", "hevc": "hevc_cuvid", "av1": "av1_cuvid", "vp8": "vp8_cuvid", "vp9": "vp9_cuvid",
         "mpeg2video": "mpeg2_cuvid", "mpeg4": "mpeg4_cuvid", "mjpeg": "mjpeg_cuvid"}


def window_matches(camera, film, rate, window, hop):
    """(camera time, film time - camera time, score) per window: the film position with the highest Pearson correlation."""
    size, step = int(window * rate), int(hop * rate)
    if len(film) < size:
        return []
    n = 1 << int(np.ceil(np.log2(len(film) + size)))
    spectrum = np.fft.rfft(film, n)
    sums, squares = (np.concatenate([[0.0], np.cumsum(x)]) for x in (film, film * film))
    film_sum = sums[size:] - sums[:-size]
    film_var = squares[size:] - squares[:-size] - film_sum ** 2 / size
    audible = film_var > 1e-6 * film_var.max()
    matches = []
    for start in range(0, len(camera) - size + 1, step):
        piece = camera[start:start + size]
        piece_var = piece @ piece - piece.sum() ** 2 / size
        if piece_var <= 1e-12:
            continue
        dots = np.fft.irfft(spectrum * np.conj(np.fft.rfft(piece, n)), n)[: len(film_sum)]
        corr = np.where(audible, (dots - piece.sum() * film_sum / size) / np.sqrt(piece_var * np.maximum(film_var, 1e-12)), 0.0)
        best = int(np.argmax(corr))
        matches.append((start / rate, (best - start) / rate, float(corr[best])))
    return matches


def play_spans(matches, mode, camera_seconds=None, film_seconds=None):
    """Good windows at one offset form one play; the offset is their median. A talk-over gap at the same offset is still one play.
    Edges are the centres of windows at least EDGE_SHARE of the median score. A window wholly inside the play that sits at
    the file's (or the camera's) first or last frame means the play reaches it, so that edge snaps there."""
    groups = []
    for time, offset, score in matches:
        if score < mode.score:
            continue
        if groups and abs(offset - groups[-1][-1][1]) <= mode.same:
            groups[-1].append((time, offset, score))
        else:
            groups.append([(time, offset, score)])
    spans = []
    for group in (group for group in groups if len(group) >= 2):
        score, offset = float(np.median([s for *_, s in group])), float(np.median([o for _, o, _ in group]))
        strong = [(time, s) for time, _, s in group if s >= EDGE_SHARE * score]
        (first, first_score), (last, last_score) = strong[0], strong[-1]
        start, end = first + mode.window / 2, last + mode.window / 2
        if first_score >= FULL_SHARE * score:
            snaps = [-offset] * (first + offset < mode.hop) + [0.0] * (first < mode.hop)
            start = max(snaps, default=start)
        if last_score >= FULL_SHARE * score:
            snaps = [film_seconds - offset] * (film_seconds is not None and last + offset + mode.window > film_seconds - mode.hop) + \
                    [camera_seconds] * (camera_seconds is not None and last + mode.window > camera_seconds - mode.hop)
            end = min(snaps, default=end)
        spans.append({"start": start, "end": end, "offset": offset, "score": score})
    return spans


def vote_offsets(matches, mode):
    """Offsets ranked by the summed score of the windows that agree with them (within mode.same); a near offset competes.
    Each carries the span its supporting windows cover: a window aligns only where the whole file segment exists, so the
    first and last fit inside the file and their outer edges are the play's."""
    good = [(time, offset, score) for time, offset, score in matches if score >= mode.score]
    ranked = []
    for _, offset, _ in good:
        support = [(time, score) for time, other, score in good if abs(other - offset) <= mode.same]
        ranked.append({"offset": offset, "weight": sum(score for _, score in support), "windows": len(support), "start": support[0][0],
                       "end": support[-1][0] + mode.window, "score": float(np.median([score for _, score in support]))})
    votes = []
    for vote in sorted(ranked, key=lambda item: -item["weight"]):
        if all(abs(vote["offset"] - kept["offset"]) > mode.same for kept in votes):
            votes.append(vote)
    return votes


def confident(votes):
    """A winner resting on MIN_VOTE_WINDOWS windows that out-votes the runner-up CONFIDENT times over."""
    if not votes or votes[0]["windows"] < MIN_VOTE_WINDOWS:
        return False
    return len(votes) == 1 or votes[0]["weight"] >= CONFIDENT * votes[1]["weight"]


def draft_insert(span, src, size, mode):
    """A showcase insert for one play, trimmed to where both the file and the camera have frames."""
    at = max(span["start"], -span["offset"], 0.0)
    return {"at": round(at, 3), "end": round(span["end"], 3), "src": src, "src_at": round(at + span["offset"], 3), "panel": panel_for(size),
            "note": f"{mode} match {span['score']:.2f}, offset {span['offset']:+.3f}; set the edges on frame strips"}


def has_audio(path):
    probe = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, check=True)
    return bool(probe.stdout.strip())


def band_passed_audio(path):
    """8 kHz mono, 300-3000 Hz: speech and score survive the room; hum and hiss do not."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(AUDIO_RATE), "-af",
                          "highpass=f=300,highpass=f=300,lowpass=f=3000,lowpass=f=3000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def nvdec_crop(crop, coded_size, rotation):
    """NVDEC's -crop (top x bottom x left x right, coded pixels) for a box given on the clip's 1080-wide upright grid."""
    width, height = coded_size
    scale = (height if rotation % 180 == 90 else width) / 1080
    x0, y0, w, h = (round(float(value) * scale) for value in crop.split(":"))
    x1, y1 = x0 + w, y0 + h
    # Coded (left, right, top, bottom) of that upright box; 270 is turned clockwise to stand upright (pipeline.CUDA_UPRIGHT).
    left, right, top, bottom = {0: (x0, x1, y0, y1), 270: (y0, y1, height - x1, height - x0),
                                90: (width - y1, width - y0, x0, x1), 180: (width - x1, width - x0, height - y1, height - y0)}[rotation % 360]
    return f"{top}x{height - bottom}x{left}x{width - right}"


def activity(path, crop=None):
    """On-screen change per frame at 29.97 fps: mean |difference| of 64x36 grey frames, cropped and shrunk by NVDEC."""
    if not has_cuda():
        sys.exit("on-screen matching decodes with NVDEC; run it on the CUDA machine")
    stream = probe_video(path)
    if stream["codec_name"] not in CUVID:
        sys.exit(f"{path}: no NVDEC decoder for {stream['codec_name']}")
    decoder = ["-c:v", CUVID[stream["codec_name"]], "-resize", "64x36"]
    if crop:
        decoder += ["-crop", nvdec_crop(crop, (stream["width"], stream["height"]), rotation_of(stream))]
    raw = subprocess.run(["ffmpeg", "-v", "error", *decoder, "-i", str(path), "-vf", f"fps={FPS_NUM}/{FPS_DEN},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 36, 64).astype(np.float64)
    return np.concatenate([[0.0], np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))])


def level_db(signal):
    return 20 * np.log10(np.sqrt(np.mean(signal ** 2)) + 1e-12)


def repo_relative(path):
    try:
        return Path(path).resolve().relative_to(WORK.parent.resolve()).as_posix()
    except ValueError:
        return str(path)


def match_file(camera_audio, camera_activity, path, visual):
    """(mode, spans) for one file: plays by sound, or the winning on-screen offset when the file is silent or --visual."""
    sound = band_passed_audio(path) if not visual and has_audio(path) else None
    if sound is not None and len(sound) and level_db(sound) > SILENT_DB:
        camera = camera_audio()
        matches = window_matches(camera, sound, AUDIO_RATE, AUDIO.window, AUDIO.hop)
        return AUDIO, play_spans(matches, AUDIO, len(camera) / AUDIO_RATE, len(sound) / AUDIO_RATE)
    votes = vote_offsets(window_matches(camera_activity(), activity(path), FRAME_RATE, VISUAL.window, VISUAL.hop), VISUAL)
    for vote in votes[:3]:
        print(f"  {Path(path).name}: offset {vote['offset']:+9.3f}  vote {vote['weight']:5.1f} ({vote['windows']} windows)  "
              f"{vote['start']:.1f}-{vote['end']:.1f}")
    if not confident(votes):
        print(f"  {Path(path).name}: no offset out-votes the rest {CONFIDENT:.0f}:1; check the candidates on frame strips")
        return VISUAL, []
    return VISUAL, votes[:1]


def drop_overlaps(inserts):
    """Two files with the same sound (a 9:16 and a 16:9 cut) match the same play: keep the stronger, name the other."""
    kept = []
    for insert in sorted(inserts, key=lambda item: -item["score"]):
        clash = next((k for k in kept if insert["at"] < k["end"] and k["at"] < insert["end"]), None)
        if clash:
            clash["note"] += f"; also matches {insert['src']} ({insert['score']:.2f}), pick by picture"
        else:
            kept.append(insert)
    return sorted(kept, key=lambda item: item["at"])


def main(argv):
    flags = [arg for arg in argv if arg.startswith("--")]
    positional = [arg for arg in argv if not arg.startswith("--")]
    if len(positional) < 3 or any(flag not in ("--visual", "--write") and not flag.startswith("--crop=") for flag in flags):
        sys.exit("usage: sync_inserts.py vN <camera clip> <file> [<file> ...] [--visual] [--crop=x:y:w:h] [--write]")
    video, camera_path, *files = positional
    crop = next((flag.split("=", 1)[1] for flag in flags if flag.startswith("--crop=")), None)
    # Decoded once, and only if some file needs that signal.
    camera_audio, camera_activity = cache(lambda: band_passed_audio(camera_path)), cache(lambda: activity(camera_path, crop))
    inserts = []
    for path in files:
        mode, spans = match_file(camera_audio, camera_activity, path, "--visual" in flags)
        size = upright_size(path)
        for span in spans:
            print(f"{span['start']:8.2f}-{span['end']:8.2f}  {Path(path).name}  file {span['start'] + span['offset']:7.2f}  "
                  f"offset {span['offset']:+9.3f}  {mode.name} {span['score']:.2f}")
            inserts.append({**draft_insert(span, repo_relative(path), size, mode.name), "score": span["score"]})
    inserts = [{k: v for k, v in insert.items() if k != "score"} for insert in drop_overlaps(inserts)]
    if "--write" in flags:
        target = WORK / "inserts" / f"{video}.draft.json"
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(inserts, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {target} ({len(inserts)} inserts): review the edges, add \"clean\" spans, then save it as {video}.json")


if __name__ == "__main__":
    main(sys.argv[1:])
