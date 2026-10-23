# Created by The Angelo Umali.
"""Instruments and mixing shared by every film score (120 BPM, 44.1 kHz stereo)."""
import wave

import numpy as np

RATE = 44100
BEAT = 0.5
BAR = 4 * BEAT
# One shared generator: a score's output depends on call order, which keeps renders reproducible.
rng = np.random.default_rng(7)

# One chord per 2 s bar: A minor, F, C, G (bass root, chord tones in Hz).
PROGRESSION = [
    (55.00, [220.00, 261.63, 329.63]),
    (43.65, [174.61, 220.00, 261.63]),
    (65.41, [261.63, 329.63, 392.00]),
    (49.00, [196.00, 246.94, 293.66]),
]


class Score:
    def __init__(self, seconds):
        self.mix = np.zeros((int(RATE * seconds), 2))

    def place(self, signal, start, gain=1.0, pan=0.0):
        begin = int(start * RATE)
        end = min(len(self.mix), begin + len(signal))
        if end <= begin:
            return
        left, right = gain * (1 - max(pan, 0)), gain * (1 + min(pan, 0))
        self.mix[begin:end, 0] += signal[: end - begin] * left
        self.mix[begin:end, 1] += signal[: end - begin] * right

    def finish(self, path, fade_seconds=1.5):
        fade_samples = int(fade_seconds * RATE)
        fade = np.ones(len(self.mix))
        fade[-fade_samples:] = np.linspace(1, 0, fade_samples)
        mastered = np.tanh(self.mix * fade[:, None] * 1.4)
        mastered /= np.abs(mastered).max() / 0.89
        with wave.open(path, "wb") as out:
            out.setnchannels(2)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes((mastered * 32767).astype("<i2").tobytes())
        print(path, len(mastered) / RATE, "s")


def timeline(seconds):
    return np.arange(int(seconds * RATE)) / RATE


def smooth(signal, width):
    return np.convolve(signal, np.ones(width) / width, mode="same")


def kick():
    t = timeline(0.35)
    pitch = 45 + 110 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(pitch) / RATE) * np.exp(-t * 9)


def hat(length=0.05):
    noise = rng.standard_normal(int(length * RATE))
    return (noise - smooth(noise, 6)) * np.exp(-timeline(length) * 70)


def clap():
    noise = rng.standard_normal(int(0.18 * RATE))
    band = smooth(noise, 3) - smooth(noise, 20)
    return band * np.exp(-timeline(0.18) * 22)


def bass(freq, length):
    t = timeline(length)
    tone = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t)
    return tone * np.minimum(1, t * 200) * np.exp(-t * 5)


def pluck(freq, length=0.3):
    t = timeline(length)
    tone = sum(np.sin(2 * np.pi * freq * k * t) / k**1.5 for k in range(1, 5))
    return tone * np.minimum(1, t * 400) * np.exp(-t * 14)


def pad(freqs, length):
    t = timeline(length)
    tone = sum(np.sin(2 * np.pi * f * detune * t) for f in freqs for detune in (0.997, 1.003))
    return tone * np.minimum(1, t / 0.4) * np.minimum(1, (length - t) / 0.4)


def whoosh(length=0.35):
    """Rising noise swell that ends on a cut."""
    noise = rng.standard_normal(int(length * RATE))
    bright = noise - smooth(noise, 40)
    return bright * np.linspace(0, 1, len(noise)) ** 2.5


def impact():
    t = timeline(0.8)
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 12)) / RATE) * np.exp(-t * 4)
    crack = rng.standard_normal(len(t)) * np.exp(-t * 30)
    return boom + 0.4 * crack


def groove(score, start, end, drums_from, arp_from, ratio=1.0):
    """Pad + 8th-note bass per bar, 16th arps from `arp_from`, kick/hat/clap from `drums_from`. `ratio` transposes."""
    for bar_start in np.arange(start, end, BAR):
        root, chord = PROGRESSION[int((bar_start - start) / BAR) % 4]
        root, chord = root * ratio, [f * ratio for f in chord]
        score.place(pad(chord, BAR), bar_start, 0.035)
        for step in range(8):
            at = bar_start + step * BEAT / 2
            if at < drums_from:
                continue
            score.place(bass(root * (2 if step % 2 else 1), 0.24), at, 0.32)
        arp = chord + [f * 2 for f in chord]
        for step in range(16):
            at = bar_start + step * BEAT / 4
            if at >= arp_from:
                score.place(pluck(arp[(step * 5) % len(arp)]), at, 0.07, pan=0.3 if step % 2 else -0.3)
    for beat_time in np.arange(drums_from, end, BEAT):
        score.place(kick(), beat_time, 0.75)
        score.place(hat(), beat_time + BEAT / 2, 0.16, pan=0.25)
        if int(round((beat_time - drums_from) / BEAT)) % 2 == 1:
            score.place(clap(), beat_time, 0.28, pan=-0.1)


def pencil_intro(score, pad_seconds, scratch_until, ratio=1.0):
    """Opening swell with pencil-scratch ticks while the first drawing goes on."""
    score.place(pad([f * ratio for f in (110.0, 164.81, 220.0)], pad_seconds), 0.0, 0.05)
    for tick in np.arange(0.05, scratch_until, 0.09):
        score.place(hat(0.03), tick, 0.12, pan=rng.uniform(-0.4, 0.4))


def cut_whooshes(score, cuts):
    for cut in cuts:
        score.place(whoosh(), cut - 0.35, 0.22)


def bell_outro(score, start, pad_seconds, arp_delay=0.0, ratio=1.0):
    """Sustained Cmaj7 with a slow bell arpeggio under the end card."""
    score.place(pad([f * ratio for f in (130.81, 164.81, 196.0, 246.94)], pad_seconds), start, 0.07)
    for step, freq in enumerate([523.25, 659.25, 783.99, 987.77, 1046.5]):
        score.place(pluck(freq * ratio, 1.2), start + arp_delay + step * 0.25, 0.1, pan=(step - 2) * 0.2)


def stingers(score, starts, notes, whoosh_first=True):
    """A pluck on each start, one pentatonic step up each time, with a short whoosh leading in."""
    for index, start in enumerate(starts):
        score.place(pluck(notes[index % len(notes)] * 2 ** (index // len(notes)), 0.6), start, 0.16, pan=-0.3 if index % 2 else 0.3)
        if index or whoosh_first:
            score.place(whoosh(0.2), start - 0.2, 0.12)
