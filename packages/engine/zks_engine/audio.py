# Created by The Angelo Umali.
# Assembles the edited soundtrack: frame-exact slices, equal-power joins, bleeps, then loudness.
# Usage: python -m zks_engine.audio v1   (needs edl/v1.json and cuts/v1.json; writes audio/v1_edit.wav)
import json
import re
import subprocess
import sys

import numpy as np

from . import progress
from .pipeline import AUDIO_RATE, WORK, frame_to_sample, load_cuts, load_edl, map_interval, source_path

CROSSFADE = int(AUDIO_RATE * 0.010)
BLEEP_HZ, BLEEP_DBFS, BLEEP_RAMP = 1000, -18, int(AUDIO_RATE * 0.005)
LOUDNESS = "I=-14:TP=-1.5:LRA=11"
# A corrupt AAC packet is dropped by the decoder; pad its gap with silence so later audio stays in sync (v9 522.6 s).
GAP_FILL = "aresample=async=1:min_hard_comp=0.01"


def read_source(spec):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(source_path(spec)), "-vn", "-ac", "2", "-ar", str(AUDIO_RATE), "-af", GAP_FILL, "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    # The camera's audio track ends ~13 ms before its video; pad so the last frame still has samples.
    return np.pad(np.frombuffer(raw, dtype=np.float32).reshape(-1, 2), ((0, AUDIO_RATE), (0, 0)))


def assemble(source, edl):
    """Each kept range takes exactly the samples its OUTPUT frames span (no per-segment rounding drift),
    then every join becomes an equal-power crossfade built from real audio on both sides of the cut."""
    pieces = []
    for seg in edl["segments"]:
        target_end = seg["target"] + seg["out"] - seg["in"]
        pieces.append((frame_to_sample(seg["in"], edl), frame_to_sample(target_end, edl) - frame_to_sample(seg["target"], edl)))
    output = np.concatenate([source[start:start + count] for start, count in pieces])
    half = CROSSFADE // 2
    ramp = np.linspace(0, np.pi / 2, CROSSFADE)[:, None]
    join = 0
    for (start_a, count_a), (start_b, _) in zip(pieces, pieces[1:]):
        join += count_a
        tail = source[start_a + count_a - half: start_a + count_a + half]
        head = source[start_b - half: start_b + half]
        if len(tail) == len(head) == CROSSFADE and join >= half:
            output[join - half: join + half] = tail * np.cos(ramp) + head * np.sin(ramp)
    return output


def bleep(output, edl, spans):
    """A bleep over removed footage is a no-op; one a cut runs through keeps only its kept part."""
    for bleep_span in spans:
        for start, end in map_interval(bleep_span["at"], bleep_span["end"], edl):
            first, last = int(start * AUDIO_RATE), int(end * AUDIO_RATE)
            count = last - first
            ramp = min(BLEEP_RAMP, count // 2)
            envelope = np.ones(count)
            envelope[:ramp] = np.linspace(0, 1, ramp)
            envelope[count - ramp:] = np.linspace(1, 0, ramp)
            tone = np.sin(2 * np.pi * BLEEP_HZ * np.arange(count) / AUDIO_RATE) * 10 ** (BLEEP_DBFS / 20) * envelope
            # Duck the word under the tone so no syllable leaks at the edges.
            output[first:last] *= (1 - envelope)[:, None]
            output[first:last] += tone[:, None]


def loudnorm(raw_path, final_path):
    raw_input = ["-f", "f32le", "-ar", str(AUDIO_RATE), "-ac", "2", "-i", str(raw_path)]
    probe = subprocess.run(["ffmpeg", "-hide_banner", *raw_input, "-af", f"loudnorm={LOUDNESS}:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True).stderr
    measured = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", probe).group(0))
    second_pass = (f"loudnorm={LOUDNESS}:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
                   f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
                   f":offset={measured['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-y", "-v", "error", *raw_input, "-af", second_pass, "-ar", str(AUDIO_RATE), "-c:a", "pcm_s24le", str(final_path)],
                   check=True)
    return measured


def main(video):
    edl = load_edl(video)
    output = assemble(read_source(load_cuts(video)), edl)
    bleep(output, edl, edl["bleeps"])
    expected = frame_to_sample(edl["frames"], edl)
    assert len(output) == expected, f"audio {len(output)} vs video {expected} samples"
    # Float intermediate: crossfades and bleeps may exceed 0 dBFS before loudnorm pulls them down.
    raw_path = WORK / "audio" / f"{video}_edit.f32"
    output.tofile(raw_path)
    measured = loudnorm(raw_path, WORK / "audio" / f"{video}_edit.wav")
    raw_path.unlink()
    print(f"{video}: {len(output) / AUDIO_RATE:.3f}s audio for {edl['frames']} frames; input {measured['input_i']} LUFS -> -14")


if __name__ == "__main__":
    with progress.job(sys.argv[1], "audio"):
        main(sys.argv[1])
