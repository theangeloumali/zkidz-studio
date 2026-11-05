# Created by The Angelo Umali.
# The cut spec's `music` as an original bed, synthesized from scratch (no samples, so nothing for Content ID to match):
# audio/<v>_bed.wav at the edit's exact length, 48 kHz 24-bit stereo, -18 LUFS; sfx.py ducks it under the voice.
# Sections are authored on the source clock and mapped through the EDL. Usage (work dir): python -m zks_engine.music_bed v1
import json
import sys
from functools import lru_cache

import numpy as np

from . import synth
from .captions import to_edited
from .music_dsp import RATE, blend_filtered, convolve, envelope, fir_from_response, identity_fir, integrated_lufs, limit, lowpass_fir, write_wav
from .pipeline import WORK, frame_to_sample, load_edl, spec_file

synth.RATE = RATE  # synth reads RATE at call time; its own default is 44.1 kHz
KINDS = ("cold", "intro", "chapter", "outro")
TARGET_LUFS = -18.0
FADE_OUT = 3.0

# IV-iii-ii-I in C, rootless voicings around middle C (bass root, chord tones in Hz).
PROGRESSION = [(87.31, (220.00, 261.63, 329.63, 392.00)), (82.41, (196.00, 246.94, 293.66, 329.63)),
               (73.42, (174.61, 220.00, 261.63, 329.63)), (65.41, (196.00, 246.94, 261.63, 329.63))]
TONIC = (65.41, (130.81, 196.00, 246.94, 293.66, 329.63))  # Cmaj9, where the outro lands
MOTIF = (523.25, 587.33, 659.25, 783.99, 880.00)  # C major pentatonic
KICK_STEPS = ({0, 4}, {0, 3, 4})  # 8th-note slots; chapters alternate the two patterns
SWING = 0.16  # offbeat 8ths land this fraction of an 8th late



class Bus(synth.Score):
    """The kit's Score mixer, sized to an exact sample count."""

    def __init__(self, samples):
        self.mix = np.zeros((samples, 2))


@lru_cache(maxsize=None)
def rhodes(freq, seconds, velocity):
    """FM electric piano: 1:1 modulator whose index decays, plus a faint tine."""
    t = synth.timeline(seconds)
    index = velocity * (2.0 * np.exp(-t * 7) + 0.3)
    tone = np.sin(2 * np.pi * freq * t + index * np.sin(2 * np.pi * freq * t))
    tine = 0.04 * velocity * np.sin(2 * np.pi * freq * 7 * t) * np.exp(-t * 40)
    return (tone + tine) * np.exp(-t * 1.8) * envelope(len(t), 0.003, 0.06)


@lru_cache(maxsize=None)
def sub(freq, seconds):
    t = synth.timeline(seconds)
    return (np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t)) * np.exp(-t * 1.2) * envelope(len(t), 0.008, 0.05)


@lru_cache(maxsize=None)
def pad_voice(freq, seconds):
    """Detuned additive saw, 1/k^2 rolloff, harmonics stop at 1.4 kHz: the low-pass is built in."""
    t = synth.timeline(seconds)
    tone = sum(np.sin(2 * np.pi * freq * k * detune * t) / k**2 for k in range(1, max(2, int(1400 / freq) + 1)) for detune in (0.996, 1.004))
    return tone * envelope(len(t), 0.6, 0.8)


SWEEP_FIRS = [identity_fir()] + [lowpass_fir(cutoff) for cutoff in (8000, 4000, 2000, 1000, 600, 350)]


def sweep_closed(bus, start, cut, reopen=0.03):
    """Filter closes over [start, cut) and snaps back open in `reopen` s: the 1-bar drop into a section."""
    pad = len(SWEEP_FIRS[0])
    begin, middle, end = int(start * RATE), int(cut * RATE), min(len(bus), int((cut + reopen) * RATE))
    lo, hi = max(0, begin - pad), min(len(bus), end + pad)
    position = np.zeros(hi - lo)
    closing = np.linspace(0, 1, middle - begin) ** 1.5 * (len(SWEEP_FIRS) - 1)
    position[begin - lo : middle - lo] = closing
    position[middle - lo : end - lo] = np.linspace(closing[-1] if len(closing) else 0, 0, end - middle)
    bus[begin:end] = blend_filtered(bus[lo:hi], SWEEP_FIRS, position)[begin - lo : end - lo]


def voice_dip(freqs):
    """-5 dB bell an octave either side of 2 kHz (speech presence), -3 dB shelf above 9 kHz (lo-fi warmth)."""
    octaves = np.log2(np.maximum(freqs, 1) / 2000)
    return 10 ** ((-5 * np.exp(-0.5 * (octaves / 0.9) ** 2) - 3 / (1 + (9000 / np.maximum(freqs, 1)) ** 4)) / 20)


VOICE_DIP_FIR = fir_from_response(voice_dip, taps=2047)
RISER_FIR = lowpass_fir(6000)
HAT_FIR = lowpass_fir(9000)  # the kit hat reaches Nyquist; darker reads lo-fi and stays out of the way


def parse(spec):
    duration, bpm, sections = float(spec["duration"]), float(spec.get("bpm", 96)), spec["sections"]
    if duration <= 0 or not 40 <= bpm <= 200 or not sections:
        raise ValueError("need duration > 0, bpm 40..200 and at least one section")
    if float(sections[0]["at"]) != 0:
        raise ValueError("the first section must start at 0")
    ats = [float(section["at"]) for section in sections]
    if any(b <= a for a, b in zip(ats, ats[1:])) or ats[-1] >= duration:
        raise ValueError("sections must be strictly increasing and start before duration")
    for section in sections:
        if section["kind"] not in KINDS or not 0 <= float(section.get("energy", 0.5)) <= 1:
            raise ValueError(f"bad section {section}")
    plan, chapters = [], 0
    for index, section in enumerate(sections):
        end = ats[index + 1] if index + 1 < len(ats) else duration
        variant = chapters % 2 if section["kind"] == "chapter" else 0
        chapters += section["kind"] == "chapter"
        plan.append({"at": ats[index], "end": end, "kind": section["kind"], "energy": float(section.get("energy", 0.5)), "variant": variant,
                     "drop": max(ats[index], end - 4 * 60 / bpm) if index + 1 < len(ats) else None})
    return duration, 60 / bpm, plan


def voiced(chord, variant):
    """Variant 1 lifts the bottom note an octave: same harmony, a fresh inversion for alternate chapters."""
    return chord if not variant else tuple(sorted(chord[1:] + (chord[0] * 2,)))


def resolve_at(section, bar):
    """The outro's last two bars hold the tonic instead of grooving."""
    return section["at"] + max(0, int(np.ceil((section["end"] - 2 * bar - section["at"]) / bar - 1e-9))) * bar


def bars_of(section, bar, until=None):
    stop = section["end"] if until is None else until
    return [(k, section["at"] + k * bar) for k in range(int(np.ceil((stop - section["at"]) / bar - 1e-9)))]


def place_drums(drums, section, beat, kit, kicks):
    level, energy, bar = 0.6 + 0.4 * section["energy"], section["energy"], 4 * beat
    in_drop = lambda t: section["drop"] is not None and section["drop"] <= t < section["end"]  # noqa: E731
    if section["kind"] == "cold":  # a soft heartbeat on every beat
        for t in np.arange(section["at"], section["end"] - 1e-9, beat):
            if not in_drop(t):
                drums.place(kit["kick"], t, 0.2 * level)
                kicks.append(t)
        return
    until = resolve_at(section, bar) if section["kind"] == "outro" else section["end"]
    steps = KICK_STEPS[section["variant"]] | ({7 if section["variant"] else 6} if energy > 0.6 else set())
    for k, bar_start in bars_of(section, bar, until):
        for step in range(8):
            t = bar_start + step * beat / 2
            if t >= until:
                break
            offbeat = t + (SWING * beat / 2 if step % 2 else 0)
            if step in steps and not in_drop(t):
                drums.place(kit["kick"], t, 0.42 * level)
                kicks.append(t)
            if step in (2, 6) and energy >= 0.2:
                drums.place(kit["claps"][(k + step) % len(kit["claps"])], t, 0.2 * level, pan=-0.1)
            if energy >= 0.25:
                drums.place(kit["hats"][(k * 8 + step) % len(kit["hats"])], offbeat, (0.09 if step % 2 else 0.055) * level, pan=0.25)
            if energy >= 0.75 and step % 2:
                drums.place(kit["hats"][step % len(kit["hats"])], offbeat + beat / 4, 0.03 * level, pan=-0.2)
    if section["kind"] == "outro" and until < section["end"]:
        drums.place(kit["kick"], until, 0.35 * level)
        kicks.append(until)


def ducked(signal, start, kicks):
    """Side-chain: the pad dips 55% on each kick (5 ms in) and swells back over ~150 ms."""
    times = start + np.arange(len(signal)) / RATE
    last = np.searchsorted(kicks, times, side="right") - 1
    since = np.where(last >= 0, times - kicks[np.maximum(last, 0)], np.inf)
    return signal * (1 - 0.55 * (1 - np.exp(-since / 0.005)) * np.exp(-since / 0.15))


def place_harmony(music, section, beat, kicks):
    level, energy, bar = 0.6 + 0.4 * section["energy"], section["energy"], 4 * beat
    kind, end = section["kind"], section["end"]

    def pad(chord, start, seconds, gain):
        for freq in chord:
            music.place(ducked(pad_voice(freq, round(seconds, 3)), start, kicks), start, gain * level)

    def chord_hit(chord, start, seconds, velocity, gain):
        for index, freq in enumerate(chord):  # 8 ms strum, alternating pan
            music.place(rhodes(freq, round(seconds, 3), velocity), start + index * 0.008, gain * level, pan=0.15 if index % 2 else -0.15)

    if kind == "cold":  # ii-iii unresolved, two bars each, plus a lone motif note per bar
        for k, bar_start in bars_of(section, bar):
            if k % 2 == 0:
                pad(PROGRESSION[2 if k % 4 == 0 else 1][1], bar_start, min(2 * bar, end - bar_start) + 0.8, 0.035)
            if bar_start + 2 * beat < end:
                music.place(rhodes(MOTIF[(4 - k) % 5], round(1.5 * beat, 3), 0.5), bar_start + 2 * beat, 0.06 * level, pan=0.2)
        return
    until = resolve_at(section, bar) if kind == "outro" else end
    for k, bar_start in bars_of(section, bar, until):
        root, chord = PROGRESSION[k % 4]
        chord = voiced(chord, section["variant"])
        pad(chord, bar_start, min(bar, until - bar_start) + 0.8, 0.025)
        hits = [(0, 1.75, 0.9), (3, 0.6, 0.6)] + ([(5, 0.6, 0.5)] if energy >= 0.5 else [])
        for step, beats, velocity in hits:
            if bar_start + step * beat / 2 < until:
                chord_hit(chord, bar_start + step * beat / 2, beats * beat, velocity, 0.075)
        next_root = PROGRESSION[(k + 1) % 4][0]
        notes = [(0, root, 1.4), (3, root, 0.45), (4, root, 1.4)] + ([(7, next_root, 0.4)] if energy > 0.5 else [])
        for step, freq, beats in notes:
            if bar_start + step * beat / 2 < until:
                music.place(sub(freq, round(beats * beat, 3)), bar_start + step * beat / 2, 0.15 * level)
        if kind in ("intro", "outro") and k % 2 == 1:  # sparse 3-note motif answering the chords
            for note in range(3):
                at = bar_start + (4 + note) * beat / 2
                if at < until:
                    music.place(rhodes(MOTIF[(k // 2 + note * 2) % 5], round(beat, 3), 0.45), at, 0.04 * level, pan=0.25)
    if kind == "outro" and until < end:  # land on Cmaj9 and let it ring into the fade
        hold = end - until
        pad(TONIC[1], until, hold, 0.025)
        chord_hit(TONIC[1], until, hold, 0.8, 0.075)
        music.place(sub(TONIC[0], round(min(hold, 4 * beat), 3)), until, 0.15 * level)
        for step, freq in enumerate((523.25, 659.25, 783.99, 987.77)):
            if until + beat + step * beat / 2 < end:
                music.place(rhodes(freq, round(2 * beat, 3), 0.4), until + beat + step * beat / 2, 0.04 * level, pan=(step - 1.5) * 0.15)


def render_bed(spec, samples=None):
    """The bed as float64 (samples, 2), loudness-normalised and limited; the same spec gives the same bytes. `samples`
    pins the length exactly (the edit's), else duration x RATE."""
    duration, beat, plan = parse(spec)
    synth.rng = np.random.default_rng(int(spec.get("seed", 0)))
    samples = samples or round(duration * RATE)
    kick = synth.kick()
    kit = {"kick": kick * envelope(len(kick), 0.001, 0.03),
           "hats": [convolve(h, HAT_FIR) * envelope(len(h), 0.0005, 0.01) for h in (synth.hat(0.045) for _ in range(8))],
           "claps": [c * envelope(len(c), 0.001, 0.03) for c in (synth.smooth(synth.clap(), 4) for _ in range(4))]}
    drums, music, kicks = Bus(samples), Bus(samples), []
    for section in plan:
        place_drums(drums, section, beat, kit, kicks)
    kicks = np.array(sorted(kicks)) if kicks else np.array([-1e9])
    for section in plan:
        place_harmony(music, section, beat, kicks)
    for section in plan[:-1]:
        sweep_closed(music.mix, section["drop"], section["end"])
        rise = convolve(synth.whoosh(section["end"] - section["drop"]), RISER_FIR)  # kit whoosh minus its near-Nyquist hiss
        drums.place(rise * envelope(len(rise), 0.0, 0.015), section["drop"], 0.05)
    mix = convolve(drums.mix + music.mix, VOICE_DIP_FIR)
    del drums, music
    mix *= (envelope(samples, 0.05, FADE_OUT) ** 2)[:, None]
    for _ in range(2):  # limiting shaves a little loudness; the second pass puts it back
        loudness = integrated_lufs(mix)
        mix = limit(mix * 10 ** ((TARGET_LUFS - loudness) / 20) if np.isfinite(loudness) else mix)
    return mix


def music_of(video):
    """The cut spec's `music`, or None; a reel's derived cut has none of its own and plays its base's."""
    path = spec_file(WORK, f"cuts/{video}.json")
    if not path.is_file():
        return None
    spec = json.loads(path.read_text(encoding="utf-8"))
    base = spec.get("baseVideoId") or spec.get("base")
    return spec.get("music") or (music_of(base) if base and base != video else None)


def edited_sections(music, edl):
    """Sections on the edit's clock. A start inside removed footage lands on the next kept frame; sections a cut collapses
    onto one time keep the later, and those past the edit's end drop."""
    duration = edl["frames"] * edl["fps_den"] / edl["fps_num"]
    placed = {}
    for section in sorted(music["sections"], key=lambda item: item["at"]):
        at = round(to_edited(section["at"], edl["segments"]), 6)
        if at < duration:
            placed[at] = {**section, "at": at}
    return list(placed.values())


def main(video):
    """audio/<video>_bed.wav from the cut spec's music, at the edit's sample count; without music, no bed (and no stale one)."""
    bed = WORK / "audio" / f"{video}_bed.wav"
    music = music_of(video)
    if not music:
        bed.unlink(missing_ok=True)
        return None
    edl = load_edl(video)
    samples = frame_to_sample(edl["frames"], edl)
    spec = {"duration": samples / RATE, "sections": edited_sections(music, edl), **({"bpm": music["bpm"]} if "bpm" in music else {})}
    audio = render_bed(spec, samples)
    bed.parent.mkdir(exist_ok=True)
    write_wav(bed, audio)
    print(f"{video}: music bed {samples / RATE:.3f} s, {len(spec['sections'])} sections, {integrated_lufs(audio):.2f} LUFS -> {bed.name}")
    return bed


if __name__ == "__main__":
    main(sys.argv[1])
