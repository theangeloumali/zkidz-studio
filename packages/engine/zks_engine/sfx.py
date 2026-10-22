# Created by The Angelo Umali.
# Mixes the overlay's sound effects under the edited voice: edl/<v>.sfx.json (hf/render.js <v> --events)
# + audio/<v>_edit.wav -> audio/<v>_mix.wav, same sample count, loudness held by an ebur128 gate. An `intro` block
# (hf/build.js, a brand pre-roll) also writes audio/<v>_intro.wav.
# Usage (from the work dir): python -m zks_engine.sfx v1   (exit 1 when the gate still fails after 3 bus cuts)
import json
import math
import re
import subprocess
import sys
import zlib
from collections import namedtuple

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from . import progress
from .pipeline import AUDIO_RATE, ENERGY_WINDOW, WORK, energy_db, frame_to_sample, intro_track, load_edl, map_interval, read_wav

from . import synth

synth.RATE = AUDIO_RATE  # synth reads RATE at call time; its own default is 44.1 kHz

BLEEP_CLEARANCE = 0.3  # the bleep is the joke; nothing sounds over it
MIN_GAP = 0.25
GAP_TOLERANCE = 1e-6  # events authored exactly MIN_GAP apart can differ by 0.2499999999999999 after cue.start + at
HEADROOM = 10 ** (-1.3 / 20)  # voice + events, sample by sample, stay under this (loudnorm leaves speech at -1.5)
GATE_LU, GATE_TRUE_PEAK, BUS_CUTS = 0.3, -1.0, 3
INTRO_LUFS = -16.0  # the pre-roll sits a little under the voice's -14

# offset: seconds from the event's `at` (may be negative); dbfs: peak after normalising; pan: added to the event's pan.
Layer = namedtuple("Layer", "offset signal dbfs pan", defaults=(0.0,))


def faded(signal, seconds):
    count = min(len(signal), int(seconds * AUDIO_RATE))
    signal = np.array(signal, dtype=float)
    signal[len(signal) - count:] *= np.linspace(1, 0, count)
    return signal


def tick():
    return synth.smooth(synth.hat(0.03), 4)


def thud():
    body = faded(synth.impact()[: int(0.45 * AUDIO_RATE)], 0.15)
    clap = synth.clap()
    body[: len(clap)] += 0.5 * clap
    return body


def hits(dur, interval, length, dbfs):
    """A span sound: one hat every `interval` seconds for `dur` seconds (at least one)."""
    return [Layer(offset, synth.hat(length), dbfs) for offset in np.arange(0.0, max(dur, 1e-3), interval)]


def scratch(dur):
    """Strike-through: fast hits whose level wobbles and whose pan follows the pen left to right."""
    span = max(dur, 1e-3)
    return [Layer(offset, synth.hat(0.03), synth.rng.uniform(-38, -32), -0.3 + 0.6 * offset / span) for offset in np.arange(0.0, span, 0.035)]


def count(dur):
    """Count-up: ticks that slow like the counting spring and fade by 6 dB, then a settle pluck at `dur`."""
    layers, offset, step = [], 0.0, 0.05
    while offset < dur:
        layers.append(Layer(offset, synth.hat(0.02), -36 - 6 * offset / dur))
        offset, step = offset + step, step * 1.15
    return layers + [Layer(dur, synth.pluck(1046.50, 0.5), -28)]


def landing():
    """A soft low thump: the head of the kit impact, low-passed and cut short."""
    return faded(synth.smooth(synth.impact(), 40)[: int(0.35 * AUDIO_RATE)], 0.12)


def sparkle():
    """Four high plucks rising across the stereo field, 60 ms apart."""
    notes = (1567.98, 2093.00, 2637.02, 3135.96)
    return [Layer(0.06 * step, synth.pluck(freq, 0.6), -38, -0.45 + 0.3 * step) for step, freq in enumerate(notes)]


# Spec 6.2. An event's `at` is where its sound starts, except thud (at = the slam; its whoosh leads in); chapter's
# plucks land as its whoosh ends. count, scratch, pencil and type span `dur`, and count settles at `dur`.
RECIPES = {
    "swish": lambda dur: [Layer(0.0, faded(synth.smooth(synth.whoosh(0.22), 3), 0.01), -30)],
    "swishOut": lambda dur: [Layer(0.0, synth.whoosh(0.16)[::-1], -36)],
    "tick": lambda dur: [Layer(0.0, tick(), -30)],
    "check": lambda dur: [Layer(0.0, tick(), -32), Layer(0.0, synth.pluck(783.99, 0.25), -30)],
    "thud": lambda dur: [Layer(-0.18, synth.whoosh(0.18), -34), Layer(0.0, thud(), -20)],
    "count": count,
    "scratch": scratch,
    "pencil": lambda dur: hits(dur, 0.07, 0.03, -36),
    "nodeSteel": lambda dur: [Layer(0.0, synth.pluck(783.99, 0.6), -28)],
    "nodeGold": lambda dur: [Layer(0.0, synth.pluck(1046.50, 0.8), -26)],
    "rule": lambda dur: [Layer(0.0, synth.whoosh(0.14), -34)],
    "chapter": lambda dur: [Layer(0.0, synth.whoosh(0.35), -28), Layer(0.35, synth.pluck(523.25, 0.5), -28),
                            Layer(0.47, synth.pluck(783.99, 0.6), -28)],
    "hook": lambda dur: [Layer(0.0, synth.smooth(synth.impact(), 30), -24)],
    "sign": lambda dur: [Layer(0.12 * step, synth.pluck(freq, 1.0), -30) for step, freq in enumerate((523.25, 659.25, 783.99, 1046.50))],
    "type": lambda dur: hits(dur, 0.066, 0.02, -40),  # every 2nd character at ~30 characters/s
    # HyperFrames effects (hf/fx/sound.js): a card's fly-in lands 0.5 s after its whoosh starts; boom is the stamp's thud.
    "flyIn": lambda dur: [Layer(0.0, faded(synth.smooth(synth.whoosh(0.5), 3), 0.02), -27), Layer(0.5, landing(), -30)],
    "whipOut": lambda dur: [Layer(0.0, synth.whoosh(0.3)[::-1], -31, 0.3)],
    "boom": lambda dur: [Layer(-0.3, synth.whoosh(0.3), -30), Layer(0.0, thud(), -17), Layer(0.0, synth.smooth(synth.impact(), 60), -21)],
    "shimmer": lambda dur: sparkle(),
    # The brand pre-roll (hf/components/intro.js): a swell that lands with a low thump and a C-major chime as the Z's gold
    # node lands. Mixed on its own track and set to INTRO_LUFS, so these levels only balance the layers.
    "intro": lambda dur: [
        Layer(0.0, faded(synth.smooth(synth.whoosh(0.82), 3), 0.02), -31),
        Layer(0.82, landing(), -27),
        Layer(0.82, synth.pluck(523.25, 1.4), -29, -0.25),
        Layer(0.82, synth.pluck(1046.50, 1.2), -28),
        Layer(0.88, synth.pluck(1567.98, 1.0), -33, 0.25),
    ],
}


def pan_gains(pan):
    """Equal-power pan, scaled so a centred sound peaks at its target in both channels."""
    angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.sqrt(2) * np.array([np.cos(angle), np.sin(angle)])


def render_event(event):
    """(start seconds, stereo clip): each layer peak-normalised to its level plus the event's gain."""
    # Seeded by the event itself, so adding a cue elsewhere never changes this sound.
    synth.rng = np.random.default_rng(zlib.crc32(f"{event['sound']}@{event['time']:.3f}".encode()))
    layers = RECIPES[event["sound"]](event.get("dur") or 0.0)
    head = min(layer.offset for layer in layers)
    starts = [round((layer.offset - head) * AUDIO_RATE) for layer in layers]
    clip = np.zeros((max(start + len(layer.signal) for start, layer in zip(starts, layers)), 2))
    for start, layer in zip(starts, layers):
        level = 10 ** ((layer.dbfs + (event.get("gain") or 0)) / 20) / np.abs(layer.signal).max()
        clip[start:start + len(layer.signal)] += np.outer(layer.signal * level, pan_gains((event.get("pan") or 0) + layer.pan))
    return event["time"] + head, clip


def audible(events, bleep_spans):
    """Time-sorted events minus any within BLEEP_CLEARANCE of a bleep and any starting < MIN_GAP after a kept one."""
    kept = []
    for event in sorted(events, key=lambda item: item["time"]):
        end = event["time"] + (event.get("dur") or 0.0)
        near_bleep = any(event["time"] <= stop + BLEEP_CLEARANCE and end >= start - BLEEP_CLEARANCE for start, stop in bleep_spans)
        if not near_bleep and (not kept or event["time"] - kept[-1]["time"] >= MIN_GAP - GAP_TOLERANCE):
            kept.append(event)
    return kept


def fitting_gain(under, clip):
    """Largest gain <= 1 keeping |under + gain * clip| within HEADROOM at every sample. Capping peak against peak muted
    events whenever speech neared its -1.5 dBFS ceiling, though the two peaks rarely coincide; the sum is convex in gain."""
    def fits(gain):
        return np.abs(under + gain * clip).max() <= HEADROOM
    if fits(1.0):
        return 1.0
    low, high = 0.0, 1.0
    for _ in range(20):
        middle = (low + high) / 2
        low, high = (middle, high) if fits(middle) else (low, middle)
    return low


def mix_bus(events, voice):
    """All events on one stereo bus, each scaled by fitting_gain against the voice and the events already mixed."""
    bus = np.zeros_like(voice)
    for event in events:
        start_seconds, clip = render_event(event)
        begin = round(start_seconds * AUDIO_RATE)
        if begin < 0:  # a negative start would wrap the numpy slice to the end of the file
            clip, begin = clip[-begin:], 0
        clip = clip[: max(0, len(bus) - begin)]
        if not len(clip):
            continue
        span = slice(begin, begin + len(clip))
        bus[span] += clip * fitting_gain(voice[span] + bus[span], clip)
    return bus


def write_wav(path, samples):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(AUDIO_RATE), "-ac", "2", "-i", "-", "-c:a", "pcm_s24le", str(path)],
                   input=samples.astype(np.float32).tobytes(), check=True)


def loudness(path):
    """(integrated LUFS, true peak dBTP) from ffmpeg's ebur128 summary."""
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
                         capture_output=True, text=True, check=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", log)[-1]), float(re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", log)[-1])


INTRO_REACH = 1.5  # how long after the intro hook ends the insert may wait for a pause (s)
PAUSE, WORD_GAP = 0.1, 0.05  # a pause, and a gap between words in continuous speech (s)
PAUSE_DB, SILENCE_DB = 20, -60  # a pause is this far under the edit's speech level, or under this outright


def loudest_runs(levels, seconds):
    """The loudest ENERGY_WINDOW in each `seconds`-long run, by the run's first window."""
    return sliding_window_view(levels, round(seconds / ENERGY_WINDOW)).max(axis=1)


def insert_frame(voice, hook_end, edl):
    """The edited frame the brand intro goes in at: the first pause after the intro hook ends, or in continuous speech the
    cleanest gap between words within INTRO_REACH, so the 2 s break never splits a word. Never before the hook has gone:
    its last frames would come back after the intro."""
    levels = energy_db(voice.mean(axis=1), AUDIO_RATE)
    first, last = max(0, round((hook_end - PAUSE / 2) / ENERGY_WINDOW)), round((hook_end + INTRO_REACH) / ENERGY_WINDOW)
    pauses = loudest_runs(levels, PAUSE)[first:last]
    quiet = np.flatnonzero(pauses < max(np.percentile(levels, 75) - PAUSE_DB, SILENCE_DB))
    if quiet.size:
        seconds = (first + quiet[0]) * ENERGY_WINDOW + PAUSE / 2
    elif len(gaps := loudest_runs(levels, WORD_GAP)[first:last]):
        seconds = (first + int(np.argmin(gaps))) * ENERGY_WINDOW + WORD_GAP / 2
    else:
        seconds = hook_end
    fps = edl["fps_num"] / edl["fps_den"]
    hook_gone = math.ceil(hook_end * fps - 1e-6)  # the hook's first frame without it (compose.js frameAtOrAfter)
    return min(max(round(seconds * fps), hook_gone, 1), edl["frames"] - 1)


def defer(events, cards, at):
    """The sounds of each card that waits for the insert (`at`, seconds), moved there with it."""
    def moved(event):
        card = next((card for card in cards if card["kind"] == event.get("kind") and abs(card["start"] - event.get("cueStart", -1)) < 1e-6), None)
        return {**event, "time": event["time"] + at - card["start"]} if card else event

    return [moved(event) for event in events]


def place_intro(payload, voice, edl, events_path):
    """The brand intro's insert and the cards that wait for it (those starting between the hook's end and the insert),
    written back to `events_path`, where render_final and the frame render read them. Returns the edit's sounds with
    those cards' moved to the insert and the split's added there; the split's whoosh is the beat, so an edit sound too
    close to it (a moved card's fly-in) gives way rather than drop it in audible()."""
    intro = payload["intro"]
    intro["at"] = insert_frame(voice, intro["hookEnd"], edl)
    at = intro["at"] * edl["fps_den"] / edl["fps_num"]
    intro["deferred"] = [card for card in intro["cards"] if card["start"] < at]
    events_path.write_bytes(json.dumps(payload, indent=1).encode("utf-8"))  # LF, like build.js, on Windows too
    split = [{**event, "time": event["time"] + at} for event in intro["splitEvents"]]
    moved = defer(payload["events"], intro["deferred"], at)
    return [event for event in moved if all(abs(event["time"] - beat["time"]) >= MIN_GAP for beat in split)] + split


def mix_intro(path, intro, edl):
    """The brand pre-roll's own track: its events on silence, exactly its frames long (at the EDL's frame rate), gained to
    INTRO_LUFS unless the true peak caps it first. Measured again after: the gain lifts the sting's tail over BS.1770's
    absolute gate."""
    bus = mix_bus(intro["events"], np.zeros((frame_to_sample(intro["frames"], edl), 2)))
    write_wav(path, bus)
    integrated, true_peak = loudness(path)
    write_wav(path, bus * 10 ** (min(INTRO_LUFS - integrated, GATE_TRUE_PEAK - 0.1 - true_peak) / 20))
    integrated, true_peak = loudness(path)
    print(f"brand intro {intro['frames']} frames; {integrated} LUFS, TP {true_peak} dBTP -> {path.name}")


def main(video):
    edl = load_edl(video)
    edl_path, events_path = WORK / "edl" / f"{video}.json", WORK / "edl" / f"{video}.sfx.json"
    payload = json.loads(events_path.read_text(encoding="utf-8"))
    if payload["frames"] != edl["frames"] or edl_path.stat().st_mtime > events_path.stat().st_mtime:
        sys.exit(f"{video}: {events_path.name} is older than or differs from {edl_path.name}; re-run hf/render.js {video} --events")
    intro = payload.get("intro")
    unknown = sorted({event["sound"] for event in payload["events"] + (intro["events"] if intro else [])} - RECIPES.keys())
    if unknown:
        sys.exit(f"{video}: no recipe for SFX {unknown}")
    edit_path, mix_path = WORK / "audio" / f"{video}_edit.wav", WORK / "audio" / f"{video}_mix.wav"
    voice = read_wav(edit_path)
    if len(voice) != frame_to_sample(edl["frames"], edl):
        sys.exit(f"{video}: {edit_path.name} does not match the edit; re-run audio.py {video}")
    sounds = payload["events"]
    if intro:
        sounds = place_intro(payload, voice, edl, events_path)  # before the track, which must be newer than the sheet
        mix_intro(intro_track(video), intro, edl)
    else:
        intro_track(video).unlink(missing_ok=True)
    events = audible(sounds, [span for item in edl["bleeps"] for span in map_interval(item["at"], item["end"], edl)])
    bus = mix_bus(events, voice)
    target, _ = loudness(edit_path)
    for cut_db in range(BUS_CUTS + 1):
        write_wav(mix_path, voice + bus * 10 ** (-cut_db / 20))
        integrated, true_peak = loudness(mix_path)
        if abs(integrated - target) <= GATE_LU and true_peak <= GATE_TRUE_PEAK:
            print(f"{video}: {len(events)}/{len(payload['events'])} SFX mixed, bus -{cut_db} dB; {integrated} LUFS (edit {target}), "
                  f"TP {true_peak} dBTP -> {mix_path.name}")
            return
    mix_path.unlink()
    sys.exit(f"{video}: SFX mix fails the gate after {BUS_CUTS} bus cuts ({integrated} LUFS vs {target}, TP {true_peak} dBTP)")


if __name__ == "__main__":
    with progress.job(sys.argv[1], "sfx"):
        main(sys.argv[1])
