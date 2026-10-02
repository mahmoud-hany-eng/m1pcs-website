"""Physical SFX voices shared by the v7 / v8 scores (original synthesis)."""
import numpy as np

from engine import *  # noqa
from sfx_lib import glass_tap, chime  # noqa


# ------------------------------------------------------------------ physical voices
def hum(dur, f0=55.0, f1=82.0, level=1.0, shape=1.6):
    t = np.arange(secs(dur)) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    v = np.sin(ph) + 0.5 * np.sin(ph * 2.003) + 0.25 * np.sin(ph * 3.01)
    env = (t / dur) ** shape * np.minimum(1, (dur - t) / 0.05)
    return lp(v, 600) * env * level


def line_zip(dur, level=1.0, seed=1, p0=-0.8, p1=0.0):
    """An electric line being drawn: a thin rising buzz with filtered grit."""
    n = secs(dur)
    t = np.arange(n) / SR
    x = t / dur
    f = 180 * (2.4 ** x)
    ph = 2 * np.pi * np.cumsum(f) / SR
    buzz = np.sign(np.sin(ph)) * 0.25 + np.sin(ph * 3) * 0.3
    buzz = bp(buzz, 400, 5000)
    grit = svf_sweep(noise(dur, seed), 1500 * (5 ** x), q=2.0) * 0.6
    env = np.minimum(1, t / 0.02) * (0.3 + 0.7 * x) * np.minimum(1, (dur - t) / 0.03)
    return pan((buzz + grit) * env * level, np.linspace(p0, p1, n))


def spark(level=1.0, seed=7):
    """The yellow spark: a bright snap, a short crackle tail, a high ping."""
    d = 0.5
    t = np.arange(secs(d)) / SR
    snap = bp(noise(d, seed), 3000, 14000) * np.exp(-t / 0.004)
    ring = np.sin(2 * np.pi * 3520 * t) * np.exp(-t / 0.12) * 0.25 + np.sin(2 * np.pi * 5274 * t) * np.exp(-t / 0.06) * 0.15
    out = pan((snap + ring) * level, 0)
    out += crackle(d, 40, 0.25 * level, seed=seed + 1) * np.exp(-t / 0.12)[:, None]
    return out


def creak(dur, level=1.0, seed=11):
    """Pressure in the emblem: a strained metal groan (slow-swept resonances)."""
    n = secs(dur)
    t = np.arange(n) / SR
    x = t / dur
    src = noise(dur, seed) * 0.6 + np.sign(np.sin(2 * np.pi * (38 + 30 * x) * t)) * 0.4
    a = svf_sweep(src, 260 * (1.8 ** x), q=6.0, mode="bp")
    b = svf_sweep(src, 820 * (1.5 ** x), q=8.0, mode="bp") * 0.5
    env = x**1.4 * np.minimum(1, (dur - t) / 0.03)
    return (a + b) / (np.abs(a + b).max() + 1e-9) * env * level


def power_on(level=1.0, seed=301):
    d = 0.7
    t = np.arange(secs(d)) / SR
    body = np.sin(2 * np.pi * np.cumsum(np.linspace(55, 110, len(t))) / SR) * np.exp(-t / 0.35)
    air = bp(noise(d, seed), 1500, 9000) * np.exp(-t / 0.18) * np.minimum(1, t / 0.01)
    return (np.tanh(1.6 * body) * 0.8 + air * 0.35) * level


def panel_on(level=1.0):
    """The monitor panel energising: relay tick, a rising high whine, a soft bloom."""
    d = 0.9
    t = np.arange(secs(d)) / SR
    relay = bp(noise(d, 311), 2000, 8000) * np.exp(-t / 0.003)
    whine = np.sin(2 * np.pi * np.cumsum(7800 + 3000 * (1 - np.exp(-t / 0.08))) / SR) * np.exp(-t / 0.25) * 0.05
    bloom = np.sin(2 * np.pi * np.cumsum(np.linspace(70, 140, len(t))) / SR) * np.minimum(1, t / 0.08) * np.exp(-t / 0.3)
    return (relay * 0.7 + whine + np.tanh(1.4 * bloom) * 0.55) * level


def power_down(level=1.0):
    d = 0.18
    return sweep(900, 60, d) * env_exp(d, 0.08) * level


def mouse_click(level=1.0, seed=5, up=False):
    """Desk mouse: a dry plastic micro-switch — down is lower and fuller than up."""
    d = 0.05
    t = np.arange(secs(d)) / SR
    f = 3800 if up else 2600
    sw = bp(noise(d, seed), f * 0.6, f * 2.2) * np.exp(-t / (0.0012 if up else 0.0018))
    body = np.sin(2 * np.pi * (1100 if up else 760) * t) * np.exp(-t / 0.006)
    return (sw + body * 0.35) * level * (0.55 if up else 1.0)


def count_tick(f, level=1.0):
    return chime([f], level, 0.0, 0.08)


def detach(level=1.0):
    """The WhatsApp object leaves the glass: suction pop + a bright lift."""
    d = 0.3
    t = np.arange(secs(d)) / SR
    pop = np.sin(2 * np.pi * np.cumsum(260 + 900 * (1 - np.exp(-t / 0.03))) / SR) * np.exp(-t / 0.05)
    lift = bp(noise(d, 601), 2000, 9000) * np.exp(-t / 0.06) * 0.3
    return (pop * 0.8 + lift) * level


def land(level=1.0):
    """Landing on the phone: glass contact + the phone rocking on the desk."""
    d = 0.3
    t = np.arange(secs(d)) / SR
    glass = glass_tap(1.0)
    desk = np.sin(2 * np.pi * np.cumsum(np.linspace(140, 95, len(t))) / SR) * np.exp(-t / 0.05)
    rattle = bp(noise(d, 611), 700, 2600) * (np.exp(-((t - 0.05) / 0.012) ** 2) + 0.5 * np.exp(-((t - 0.1) / 0.01) ** 2))
    out = np.tanh(1.5 * desk) * 0.6 + rattle * 0.25
    out[: len(glass)] += glass * 0.9
    return out * level


