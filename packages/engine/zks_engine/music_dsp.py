# Created by The Angelo Umali.
# Audio DSP for the music bed (music_bed.py), numpy only: linear-phase FIRs, FFT convolution, BS.1770 loudness, a limiter.
import wave

import numpy as np

from .pipeline import AUDIO_RATE as RATE

CEILING = 10 ** (-1.2 / 20)  # 0.2 dB under the -1 dBFS contract absorbs int24 rounding


def envelope(samples, attack, release):
    """Linear attack from 0 and release to exactly 0, so no note starts or stops on a step."""
    env = np.ones(samples)
    rise, fall = min(samples, max(1, int(attack * RATE))), min(samples, max(1, int(release * RATE)))
    env[:rise] *= np.linspace(0, 1, rise, endpoint=False)
    env[samples - fall :] *= np.linspace(1, 0, fall)
    return env


def lowpass_fir(cutoff, taps=511):
    k = np.arange(taps) - taps // 2
    fir = np.sinc(2 * cutoff / RATE * k) * np.blackman(taps)
    return fir / fir.sum()


def identity_fir(taps=511):
    fir = np.zeros(taps)
    fir[taps // 2] = 1.0
    return fir


def fir_from_response(gain_of, taps=4095, grid=1 << 16):
    """Linear-phase FIR whose magnitude follows gain_of(freqs)."""
    freqs = np.fft.rfftfreq(grid, 1 / RATE)
    impulse = np.roll(np.fft.irfft(gain_of(freqs), grid), taps // 2)[:taps]
    return impulse * np.blackman(taps)


def convolve(signal, fir, block=1 << 17):
    """Zero-phase FFT overlap-add, same length as the input; 1-D or (n, channels)."""
    flat = signal.ndim == 1
    signal = signal[:, None] if flat else signal
    taps = len(fir)
    size = 1 << int(np.ceil(np.log2(block + taps - 1)))
    spectrum = np.fft.rfft(fir, size)[:, None]
    out = np.zeros((len(signal) + taps - 1, signal.shape[1]))
    for start in range(0, len(signal), block):
        piece = signal[start : start + block]
        out[start : start + len(piece) + taps - 1] += np.fft.irfft(np.fft.rfft(piece, size, axis=0) * spectrum, size, axis=0)[: len(piece) + taps - 1]
    out = out[taps // 2 : taps // 2 + len(signal)]
    return out[:, 0] if flat else out


def blend_filtered(signal, firs, position):
    """Time-varying filter: per sample, crossfade between the two FIR versions `position` (0..len-1) falls between."""
    versions = np.stack([convolve(signal, fir) for fir in firs])
    low = np.clip(np.floor(position).astype(int), 0, len(firs) - 2)
    mix = (position - low)[:, None] if signal.ndim == 2 else position - low
    rows = np.arange(len(signal))
    return versions[low, rows] * (1 - mix) + versions[low + 1, rows] * mix


# BS.1770 K-weighting at 48 kHz (pre-filter shelf, RLB high-pass), as a magnitude-matched FIR.
K_STAGES = (((1.53512485958697, -2.69169618940638, 1.19839281085285), (1, -1.69065929318241, 0.73248077421585)),
            ((1.0, -2.0, 1.0), (1, -1.99004745483398, 0.99007225036621)))


def k_weighting(freqs):
    z = np.exp(-2j * np.pi * freqs / RATE)
    gain = np.ones(len(freqs))
    for b, a in K_STAGES:
        gain *= np.abs((b[0] + b[1] * z + b[2] * z**2) / (a[0] + a[1] * z + a[2] * z**2))
    return gain


K_FIR = fir_from_response(k_weighting, taps=8191)


def block_lufs(mean_square):
    return -0.691 + 10 * np.log10(np.maximum(mean_square, 1e-20))


def integrated_lufs(audio):
    """BS.1770-4 gated loudness: 400 ms blocks, 75% overlap, -70 LUFS absolute and -10 LU relative gates."""
    power = np.concatenate([[0.0], np.cumsum((convolve(audio, K_FIR) ** 2).sum(axis=1))])
    size, hop = int(0.4 * RATE), int(0.1 * RATE)
    starts = np.arange(0, len(audio) - size + 1, hop)
    blocks = (power[starts + size] - power[starts]) / size
    gated = blocks[block_lufs(blocks) > -70]
    if not gated.size:  # under one 400 ms block, or silence: nothing to measure
        return float("-inf")
    gated = gated[block_lufs(gated) > block_lufs(gated.mean()) - 10]
    return float(block_lufs(gated.mean()))


def limit(audio, ceiling=CEILING, block=32, attack=0.002, release=0.15):
    """Look-ahead peak limiter on 32-sample blocks; the gain ramps down before a peak and recovers linearly."""
    blocks = -(-len(audio) // block)
    padded = np.zeros((blocks * block, audio.shape[1]))
    padded[: len(audio)] = audio
    peaks = np.abs(padded).max(axis=1).reshape(blocks, block).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(peaks, 1e-12))
    index = np.arange(blocks)
    fall, rise = block / (attack * RATE), block / (release * RATE)
    gain = np.minimum.accumulate(need - rise * index) + rise * index  # recover at most `rise` per block
    gain = (np.minimum.accumulate((gain + fall * index)[::-1]) - fall * index[::-1])[::-1]  # dip `fall` per block ahead
    gain = np.minimum(gain, 1.0)
    edges = np.minimum(np.concatenate([[gain[0]], gain]), np.concatenate([gain, [gain[-1]]]))
    curve = np.interp(np.arange(blocks * block), np.arange(blocks + 1) * block, edges)[: len(audio)]
    limited = audio * curve[:, None]
    return limited * min(1.0, ceiling / max(np.abs(limited).max(), 1e-12))


def write_wav(path, audio):
    """48 kHz 24-bit stereo."""
    ints = np.clip(np.round(audio * 8388607), -8388608, 8388607).astype("<i4")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(3)
        out.setframerate(RATE)
        out.writeframes(ints.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes())
