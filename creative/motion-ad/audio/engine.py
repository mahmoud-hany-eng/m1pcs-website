"""
Procedural score + sound design for the M1 motion ad.

Everything is synthesised from scratch (no samples, no third-party audio), so
it is unambiguously cleared for commercial use. Every sound is placed
sample-accurately from the SAME timeline the picture uses (timeline.json +
the capture log), so clicks land on the real clicks and hits land on the cuts.

48 kHz, stereo, float32 internally; written as 24-bit WAV.
"""
import json
import math
import os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
rng = np.random.default_rng(7)


# ----------------------------------------------------------------------------
# primitives
# ----------------------------------------------------------------------------
def secs(n):
    return int(round(n * SR))


def silence(dur):
    return np.zeros(secs(dur), dtype=np.float64)


def noise(dur, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    return r.standard_normal(secs(dur))


def sweep(f0, f1, dur, curve="exp"):
    n = secs(dur)
    x = np.linspace(0, 1, n, endpoint=False)
    if curve == "exp":
        f = f0 * (f1 / f0) ** x
    else:
        f = f0 + (f1 - f0) * x
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def env_exp(dur, decay, attack=0.002):
    n = secs(dur)
    t = np.arange(n) / SR
    e = np.exp(-t / decay)
    a = secs(attack)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e


def env_bell(dur, peak=0.5, power=2.0):
    """0 -> 1 at `peak` (fraction) -> 0, shaped."""
    n = secs(dur)
    x = np.linspace(0, 1, n)
    up = np.clip(x / peak, 0, 1) ** power
    down = np.clip((1 - x) / (1 - peak), 0, 1) ** power
    return np.minimum(up, down)


def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR * 0.45), "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, f0, f1, order=2):
    return sosfilt(butter(order, [f0, min(f1, SR * 0.45)], "band", fs=SR, output="sos"), x)


def svf_sweep(x, fc, q=0.7, mode="bp"):
    """State-variable filter with a per-sample cutoff array (for real sweeps)."""
    y = np.zeros_like(x)
    low = band = 0.0
    damp = 1.0 / q
    for i in range(len(x)):
        # Chamberlin SVF: keep f well inside its stable range
        f = 2.0 * math.sin(math.pi * min(fc[i], SR * 0.125) / SR)
        high = x[i] - low - damp * band
        band += f * high
        low += f * band
        y[i] = band if mode == "bp" else (low if mode == "lp" else high)
    return y


def pan(mono, p):
    """Equal-power pan, p in [-1, 1] (scalar or per-sample array)."""
    p = np.asarray(p, dtype=np.float64)
    a = (p + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)], axis=1)


def db(v):
    return 10 ** (v / 20)


class Bus:
    def __init__(self, dur):
        self.buf = np.zeros((secs(dur), 2))

    def add(self, t, stereo, gain=1.0):
        if stereo.ndim == 1:
            stereo = pan(stereo, 0)
        i = secs(t)
        if i < 0:
            stereo = stereo[-i:]
            i = 0
        n = min(len(stereo), len(self.buf) - i)
        if n > 0:
            self.buf[i : i + n] += stereo[:n] * gain


def reverb_ir(dur=1.6, decay=0.45, tone=5000, seed=3):
    n = secs(dur)
    t = np.arange(n) / SR
    r = np.random.default_rng(seed)
    l = r.standard_normal(n) * np.exp(-t / decay)
    rr = r.standard_normal(n) * np.exp(-t / decay)
    ir = np.stack([lp(l, tone), lp(rr, tone)], axis=1)
    ir[: secs(0.012)] *= np.linspace(0, 1, secs(0.012))[:, None]
    return ir / np.sqrt((ir**2).sum())


def apply_reverb(stereo, ir, wet=0.25):
    out = np.zeros((len(stereo) + len(ir) - 1, 2))
    out[:, 0] = fftconvolve(stereo[:, 0], ir[:, 0])
    out[:, 1] = fftconvolve(stereo[:, 1], ir[:, 1])
    out = out[: len(stereo)]
    return stereo * (1 - wet) + out * wet * 3.0


# ----------------------------------------------------------------------------
# instruments
# ----------------------------------------------------------------------------
def kick(level=1.0):
    d = 0.42
    body = sweep(165, 46, d) * env_exp(d, 0.16, 0.001)
    click = hp(noise(0.012, 11), 1800) * env_exp(0.012, 0.003)
    k = np.tanh(1.6 * body) * 0.9
    k[: len(click)] += click * 0.35
    return k * level


def hat(level=1.0, open_=False):
    d = 0.18 if open_ else 0.05
    h = hp(noise(d, 21), 7500, 2) * env_exp(d, 0.06 if open_ else 0.014)
    return h * level


def snap_clap(level=1.0):
    d = 0.22
    n = bp(noise(d, 31), 900, 4200) * env_exp(d, 0.05)
    # three tight pre-hits like a real clap
    for k, off in enumerate([0.0, 0.009, 0.018]):
        i = secs(off)
        n[i : i + secs(0.006)] *= 1.6 - 0.2 * k
    return n * level


def sub_boom(level=1.0):
    d = 1.8
    body = sweep(78, 34, d) * env_exp(d, 0.55, 0.002)
    thud = lp(noise(0.3, 41), 380) * env_exp(0.3, 0.06)
    crack = bp(noise(0.05, 42), 1500, 7000) * env_exp(0.05, 0.008)
    out = np.tanh(1.3 * body) * 0.95
    out[: len(thud)] += thud * 0.9
    out[: len(crack)] += crack * 0.4
    return out * level


def saw(freq, dur, detune=0.0):
    t = np.arange(secs(dur)) / SR
    ph = (freq * (1 + detune)) * t
    return 2 * (ph - np.floor(ph + 0.5))


def pad_chord(freqs, dur, cutoff=1400, level=1.0):
    n = secs(dur)
    L = np.zeros(n)
    R = np.zeros(n)
    for f in freqs:
        for k, d in enumerate([-0.006, -0.002, 0.002, 0.006]):
            v = saw(f, dur, d)
            if k % 2 == 0:
                L += v
            else:
                R += v
    env = np.minimum(1, np.arange(n) / secs(0.7)) * np.minimum(1, (n - np.arange(n)) / secs(0.4))
    L = lp(L, cutoff, 2) * env
    R = lp(R, cutoff, 2) * env
    norm = 1 / (len(freqs) * 2)
    return np.stack([L, R], axis=1) * norm * level


def bass_note(freq, dur, level=1.0):
    n = secs(dur)
    t = np.arange(n) / SR
    v = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)
    v = lp(np.tanh(1.4 * v), 420)
    env = np.minimum(1, t / 0.006) * np.exp(-t / 0.42) * np.minimum(1, (n - np.arange(n)) / secs(0.03))
    return v * env * level


def pluck(freq, level=1.0, dur=0.6):
    t = np.arange(secs(dur)) / SR
    v = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t / 0.05)
    return v * np.exp(-t / 0.16) * np.minimum(1, t / 0.002) * level


# ----------------------------------------------------------------------------
# sound effects
# ----------------------------------------------------------------------------
def tick(freq=3200, level=1.0, dur=0.03, seed=1):
    t = np.arange(secs(dur)) / SR
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.006)
    s += bp(noise(dur, seed), freq * 0.6, freq * 1.8) * np.exp(-t / 0.003) * 0.5
    return s * level


def ui_click(level=1.0, bright=1.0, seed=5):
    """Two-stage mechanical click: hard transient + tiny body."""
    d = 0.08
    t = np.arange(secs(d)) / SR
    trans = bp(noise(d, seed), 1800 * bright, 6500) * np.exp(-t / 0.0025)
    body = np.sin(2 * np.pi * 1450 * bright * t) * np.exp(-t / 0.011)
    thump = np.sin(2 * np.pi * 150 * t) * np.exp(-t / 0.02)
    return (trans * 0.9 + body * 0.45 + thump * 0.55) * level


def whoosh(dur, f_lo=300, f_hi=4000, peak=0.6, level=1.0, pan_from=0.0, pan_to=0.0, seed=9):
    n = secs(dur)
    x = np.linspace(0, 1, n)
    bell = np.sin(np.pi * np.clip(x / peak, 0, 1) / 2) ** 2 * np.where(x > peak, np.cos(np.pi / 2 * (x - peak) / (1 - peak)) ** 2, 1)
    fc = f_lo * (f_hi / f_lo) ** np.where(x < peak, x / peak, 1 - (x - peak) / (1 - peak) * 0.6)
    s = svf_sweep(noise(dur, seed), fc, q=0.9) * bell
    s = s / (np.abs(s).max() + 1e-9)
    return pan(s * level, np.linspace(pan_from, pan_to, n))


def riser(dur, level=1.0, seed=13):
    n = secs(dur)
    x = np.linspace(0, 1, n)
    amp = x**2.2
    fc = 250 * (7000 / 250) ** (x**1.3)
    s = svf_sweep(noise(dur, seed), fc, q=1.6) * 0.8
    tone = sweep(110, 880, dur) * 0.25 + sweep(165, 1320, dur) * 0.12
    trem = 1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(4 + 18 * x**2) / SR))
    out = (s + tone) * amp * trem
    out = out / (np.abs(out).max() + 1e-9)
    # widen
    L = out
    R = np.roll(out, secs(0.011))
    return np.stack([L, R], axis=1) * level


def crackle(dur, density=55, level=1.0, seed=17):
    """Electric detail: sparse filtered impulses + a few tiny zaps."""
    r = np.random.default_rng(seed)
    n = secs(dur)
    out = np.zeros((n, 2))
    k = int(density * dur)
    for _ in range(k):
        i = r.integers(0, n - secs(0.03))
        f = r.uniform(2200, 7000)
        z = tick(f, r.uniform(0.15, 0.6), 0.018, seed=int(r.integers(1, 9999)))
        out[i : i + len(z)] += pan(z, r.uniform(-0.7, 0.7))
    for _ in range(max(1, int(dur * 3))):
        i = r.integers(0, n - secs(0.07))
        z = sweep(r.uniform(3000, 5200), r.uniform(500, 900), 0.06) * env_exp(0.06, 0.018) * 0.35
        out[i : i + len(z)] += pan(z, r.uniform(-0.5, 0.5))
    return out * level


def blip(freq, level=1.0, dur=0.05):
    t = np.arange(secs(dur)) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.012) * np.minimum(1, t / 0.0008) * level


def shimmer(dur=0.4, level=1.0, seed=23):
    n = secs(dur)
    air = bp(noise(dur, seed), 6000, 12000) * env_bell(dur, 0.35)
    t = np.arange(n) / SR
    chime = (np.sin(2 * np.pi * 2637 * t) + 0.6 * np.sin(2 * np.pi * 3951 * t)) * np.exp(-t / 0.18) * np.minimum(1, t / 0.01)
    return pan(air * 0.5 + chime * 0.18, 0) * level


def whump(level=1.0):
    d = 0.35
    t = np.arange(secs(d)) / SR
    body = np.sin(2 * np.pi * np.cumsum(np.linspace(140, 60, len(t))) / SR) * np.exp(-t / 0.09)
    air = lp(noise(d, 51), 700) * np.exp(-t / 0.05)
    return (np.tanh(1.5 * body) + air * 0.6) * level


# ----------------------------------------------------------------------------
# mastering
# ----------------------------------------------------------------------------
def master(stereo, ceiling_db=-1.0):
    # gentle glue: soft-knee saturation then peak normalise to the ceiling
    x = np.tanh(stereo * 1.15) / np.tanh(1.15)
    peak = np.abs(x).max() + 1e-9
    return x * (db(ceiling_db) / peak)


def write_wav(path, stereo):
    import wave

    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(stereo, -1, 1) * 8388607).astype("<i4")
    raw = pcm.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(raw)
