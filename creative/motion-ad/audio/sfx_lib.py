"""Shared transient SFX (moved out of score_final.py so later scores can reuse them)."""
import numpy as np
from engine import *  # noqa


# ------------------------------------------------------------------ transients
def lock_clack(level=1.0, pitch=1.0, seed=71):
    d = 0.22
    t = np.arange(secs(d)) / SR
    tick_ = bp(noise(d, seed), 2200 * pitch, 9000) * np.exp(-t / 0.0022)
    ring = sum(a * np.sin(2 * np.pi * f * pitch * t) * np.exp(-t / dk) for f, a, dk in [(1870, 0.5, 0.07), (2930, 0.35, 0.05), (4410, 0.22, 0.035)])
    thud = np.sin(2 * np.pi * np.cumsum(np.linspace(150 * pitch, 90 * pitch, len(t))) / SR) * np.exp(-t / 0.035)
    return (tick_ * 0.9 + ring * 0.35 + thud * 0.7) * level


def glass_tap(level=1.0):
    d = 0.09
    t = np.arange(secs(d)) / SR
    body = np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 0.012) + 0.5 * np.sin(2 * np.pi * 5200 * t) * np.exp(-t / 0.006)
    soft = lp(noise(d, 72), 2500) * np.exp(-t / 0.004)
    low = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.018)
    return (body * 0.45 + soft * 0.4 + low * 0.35) * level


def soft_kick(level=1.0, cutoff=900):
    return lp(kick(1.0), cutoff) * level


def fold(dur=0.42, level=1.0):
    """The pill deforming into the emblem: a bending metal sheet, pitched down."""
    n = secs(dur)
    t = np.arange(n) / SR
    x = t / dur
    f = 1400 * (0.32 ** x)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.4 * np.sin(2 * np.pi * np.cumsum(f * 2.41) / SR)
    grit = bp(noise(dur, 81), 600, 5000) * (0.4 + 0.6 * np.sin(np.pi * x))
    env = np.minimum(1, t / 0.01) * np.exp(-t / 0.22)
    return (tone * 0.4 + grit * 0.5) * env * level


def thock(level=1.0, f=180):
    """Headline lines locking in: a muted, wooden hit."""
    d = 0.16
    t = np.arange(secs(d)) / SR
    body = np.sin(2 * np.pi * np.cumsum(np.linspace(f * 1.6, f, len(t))) / SR) * np.exp(-t / 0.03)
    click = bp(noise(d, 91), 1500, 6000) * np.exp(-t / 0.003)
    return (np.tanh(1.8 * body) * 0.8 + click * 0.4) * level


def pop_out(level=1.0):
    """Outgoing message: a soft rounded pop."""
    d = 0.09
    t = np.arange(secs(d)) / SR
    f = 520 + 520 * (1 - np.exp(-t / 0.02))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.022) * np.minimum(1, t / 0.0015)
    return s * level


def tick_in(level=1.0):
    """Incoming message: slightly higher, two quick partials."""
    return (blip(1568, 0.7, 0.06) + np.pad(blip(2093, 0.55, 0.06), (secs(0.045), 0))[: secs(0.06)]) * level


def typing(dur, level=1.0, seed=95):
    r = np.random.default_rng(seed)
    out = np.zeros(secs(dur))
    tt = 0.0
    while tt < dur - 0.03:
        z = tick(r.uniform(2400, 3600), r.uniform(0.3, 0.6), 0.02, seed=int(r.integers(1, 999)))
        i = secs(tt)
        out[i : i + len(z)] += z[: len(out) - i]
        tt += r.uniform(0.045, 0.085)
    return bp(out, 1500, 6000) * level


def chime(notes, level=1.0, spacing=0.07, decay=0.35):
    d = spacing * len(notes) + decay * 2
    n = secs(d)
    out = np.zeros(n)
    for k, f in enumerate(notes):
        t = np.arange(n - secs(k * spacing)) / SR
        v = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.05)) * np.exp(-t / decay) * np.minimum(1, t / 0.002)
        out[secs(k * spacing) :] += v
    return out * level


def paper_click(level=1.0):
    d = 0.07
    t = np.arange(secs(d)) / SR
    return (bp(noise(d, 97), 2500, 9000) * np.exp(-t / 0.006) + np.sin(2 * np.pi * 900 * t) * np.exp(-t / 0.01) * 0.4) * level


def ping(f=1760, level=1.0):
    d = 0.9
    t = np.arange(secs(d)) / SR
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.08)) * np.exp(-t / 0.28) * np.minimum(1, t / 0.002) * level


def zap_drop(level=1.0, f0=3200, f1=380, d=0.16):
    return sweep(f0, f1, d) * env_exp(d, d * 0.45) * level


def swish(d=0.16, level=1.0, f0=1200, f1=6000, p0=0.0, p1=0.0, seed=99):
    return whoosh(d, f0, f1, peak=0.55, level=level, pan_from=p0, pan_to=p1, seed=seed)


