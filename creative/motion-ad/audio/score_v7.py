"""Score + SFX for v7 — the physical device world (~43.2 s, 116 BPM, A minor).

Every cue comes from timeline.json `v7` or from the journey7 capture log
(the real press / release frames), the same values the picture reads.
Original synthesis only — no samples, no WhatsApp audio.

Sound is physical where the picture is physical: electric lines, a spark,
pressure in the emblem, the bezel unfolding, the monitor powering on, a desk
mouse, the WhatsApp object leaving the glass and landing on the phone, phone
glass, the RGB click. The music keeps space for them: near silence on black,
a groove that starts with the website, room under the chat, a drop-out before
the RGB click, a held breath before the final lock.
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa
from sfx_lib import lock_clack, glass_tap, soft_kick, fold, thock, pop_out, tick_in, typing, chime, paper_click, ping, zap_drop, swish  # noqa

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
T = json.load(open(os.path.join(ROOT, "timeline.json")))
V = T["v7"]
LOG = json.load(open(os.path.join(ROOT, "public/cap/journey7/log.json")))
BEAT = T["beat"]
BAR = 4 * BEAT
DUR = V["duration"]
I, HM, Q, TP, CH, RT, BU, PT, RET, CT, SG = (V[k] for k in ["intro", "home", "quote", "toPhone", "chat", "route", "builds", "parts", "ret", "cta", "sig"])
FLY = V["fly"]
J0 = HM["captureStart"]
jt = lambda i: J0 + i / 60

taps = []
for i in range(1, len(LOG)):
    if LOG[i]["mouse"]["down"] and not LOG[i - 1]["mouse"]["down"]:
        j = i
        while j < len(LOG) and LOG[j]["mouse"]["down"]:
            j += 1
        taps.append((jt(i), jt(j)))
CTA_TAP, BUILD, GAMING, RES, FPS_, COLOUR, SEND = taps[:7]
print("taps", [(round(p, 3), round(r, 3)) for p, r in taps])

music, sfx, send = Bus(DUR + 1.5), Bus(DUR + 1.5), Bus(DUR + 1.5)


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


# ------------------------------------------------------------------ music
CH_AM = [220.0, 261.63, 329.63, 440.0]
CH_F = [174.61, 261.63, 349.23, 440.0]
CH_C = [196.0, 261.63, 329.63, 392.0]
CH_G = [196.0, 246.94, 293.66, 392.0]
CH_AM9 = [220.0, 261.63, 329.63, 493.88, 659.25]
PROG = [(CH_AM, 55.0), (CH_F, 43.65), (CH_C, 65.41), (CH_G, 49.0)]
A = I["powerOn"][0]  # the groove is born with the website


def section(t):
    if t < HM["press"]:
        return "breath"
    if t < Q["captureEnd"]:
        return "groove"
    if t < CH["payoff"][0]:
        return "chat"
    if t < BU["a"][0]:
        return "drive"
    if t < PT["click"]:
        return "rise"
    if t < RET["glow"][0]:
        return "drive"
    return "half"


kicks = []
# black: only air; the hum belongs to the emblem
music.add(0.05, pan(lp(noise(1.2, 401), 900) * env_bell(1.2, 0.6) * 0.04, 0))
pad_in = pad_chord([110.0, 164.81, 220.0, 329.63], A - I["hold"][0] + 0.4, cutoff=800, level=0.42)
music.add(I["hold"][0], pad_in * (np.linspace(0, 1, len(pad_in)) ** 1.6)[:, None])

b = 0
while True:
    t0 = A + b * BAR
    if t0 > SG["fade"][0]:
        break
    sec = section(t0 + 0.01)
    chord, root = PROG[b % 4]
    cut = {"breath": 1100, "groove": 1500, "chat": 1900, "drive": 1700, "rise": 1400, "half": 1250}[sec]
    lvl = {"breath": 0.38, "groove": 0.38, "chat": 0.32, "drive": 0.4, "rise": 0.42, "half": 0.4}[sec]
    music.add(t0, pad_chord(chord, BAR + 0.35, cutoff=cut, level=lvl))
    for q in range(4):
        tb = t0 + q * BEAT
        if tb > SG["fade"][0]:
            break
        s = section(tb)
        if PT["off"] - 0.14 <= tb < PT["click"]:
            continue  # the drop-out before the RGB click
        if FLY[0] - 0.1 <= tb < FLY[1]:
            continue  # the suction into the monitor carries alone
        on4 = s in ("groove", "drive", "rise")
        if on4 or q in (0, 2):
            if not (s == "breath" and q == 2):
                music.add(tb, kick(0.85) if on4 else soft_kick(0.72, cutoff=1300))
                kicks.append(tb)
        if s in ("groove", "drive", "rise"):
            music.add(tb, bass_note(root, BEAT * 0.48, 0.42))
            music.add(tb + BEAT / 2, bass_note(root * 2, BEAT * 0.42, 0.25))
            music.add(tb + BEAT / 2, pan(hat(0.085), 0.25))
        elif q in (0, 2):
            music.add(tb, bass_note(root, BEAT * 1.8, 0.32))
        if s in ("drive", "rise") and q in (1, 3):
            music.add(tb, pan(snap_clap(0.28), -0.05))
        if s == "rise":
            for s16 in (0.25, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.04 + 0.025 * q / 3), -0.3))
        if s in ("chat", "breath"):
            for s16 in (0.25, 0.5, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.024), 0.35 if s16 != 0.5 else -0.35))
    if sec in ("chat", "breath") and b > 0:
        arp = [chord[1] * 2, chord[2] * 2, chord[3] * 2, chord[2] * 2]
        for e in range(8):
            music.add(t0 + e * BEAT / 2, pan(pluck(arp[e % 4], 0.05, 0.35), -0.4 + 0.8 * (e % 2)))
    b += 1

# the signature: one open chord after the lock
music.add(SG["lock"], pad_chord(CH_AM9, DUR - SG["lock"] + 0.8, cutoff=2600, level=0.6))
music.add(SG["lock"], bass_note(55.0, 0.9, 0.6))

env = np.ones(len(music.buf))
for tb in kicks:
    i, n = secs(tb), secs(0.2)
    if 0 <= i and i + n < len(env):
        env[i : i + n] *= 1 - 0.42 * np.exp(-np.arange(n) / secs(0.06))


def duck(t0, t1, depth, fade=0.06):
    i0, i1, nf = secs(t0), secs(t1), secs(fade)
    env[i0 - nf : i0] *= np.linspace(1, 1 - depth, nf)
    env[i0:i1] *= 1 - depth
    env[i1 : i1 + nf] *= np.linspace(1 - depth, 1, nf)


duck(PT["off"] - 0.12, PT["click"], 0.92)  # the drop before the RGB click
duck(TP["icon"][0], TP["wake"] + 0.1, 0.35, fade=0.15)  # space for the object's flight
duck(FLY[0], FLY[1], 0.45, fade=0.12)
duck(SG["fade"][0], SG["lock"], 0.8, fade=0.3)  # the held breath before the lock
music.buf *= env[:, None]

# ------------------------------------------------------------------ 1. black → lines → spark → emblem → monitor
la, lb = I["lineA"], I["lineB"]
sfx.add(la[0], line_zip(la[1] - la[0], 0.13, seed=701, p0=-0.85, p1=-0.05))
sfx.add(lb[0], line_zip(lb[1] - lb[0], 0.12, seed=702, p0=0.85, p1=0.05))
sfx.add(I["spark"], spark(0.42))
send.add(I["spark"], spark(0.2, seed=9))
sfx.add(I["fill"][0], pan(sub_boom(0.22), 0))
sfx.add(I["fill"][0], pan(lock_clack(0.55, pitch=0.9, seed=703), 0))
sfx.add(I["wm"][0], swish(I["wm"][1] - I["wm"][0] + 0.1, 0.06, 4000, 9000, -0.5, 0.5, seed=704))
sfx.add(I["hold"][0], pan(hum(I["pressure"][1] - I["hold"][0], 48, 72, level=0.12, shape=1.2), 0))
sfx.add(I["pressure"][0], pan(creak(I["pressure"][1] - I["pressure"][0] + 0.04, 0.12, seed=705), 0))
sfx.add(I["pressure"][0], riser(I["pressure"][1] - I["pressure"][0], 0.16, seed=706))
# the strokes release and unfold into a bezel
ex = I["expand"]
sfx.add(ex[0], pan(zap_drop(0.18, 2600, 600, 0.06), 0))
sfx.add(ex[0], whoosh(ex[1] - ex[0], 200, 3800, peak=0.35, level=0.2, pan_from=0, pan_to=-0.7, seed=707))
sfx.add(ex[0] + 0.02, whoosh(ex[1] - ex[0], 220, 3900, peak=0.35, level=0.2, pan_from=0, pan_to=0.7, seed=708))
sfx.add(ex[0] + 0.05, pan(fold(0.55, 0.34), -0.25))
sfx.add(ex[0] + 0.08, pan(fold(0.55, 0.3), 0.25))
sfx.add(I["materialize"][0] + 0.15, pan(thock(0.4, 120), 0))  # the bezel seats
sfx.add(I["materialize"][1] - 0.04, pan(lock_clack(0.42, pitch=0.85, seed=709), 0))
sfx.add(I["powerOn"][0], pan(panel_on(0.6), 0))
send.add(I["powerOn"][0], pan(panel_on(0.25), 0))
sfx.add(I["powerOn"][0], pan(sub_boom(0.26), 0))
sfx.add(I["pullBack"][0], whoosh(I["pullBack"][1] - I["pullBack"][0], 1800, 260, peak=0.25, level=0.1, seed=710))

# ------------------------------------------------------------------ 2. homepage on the monitor
sfx.add(HM["approach"][0], whoosh(HM["approach"][1] - HM["approach"][0], 200, 900, peak=0.6, level=0.06, seed=720))
sfx.add(HM["cursorIn"][0], swish(0.3, 0.03, 1200, 3000, 0.3, 0.1, seed=721))  # the mouse slides on the desk pad
sfx.add(HM["hover"], pan(blip(1760, 0.045, 0.07), 0.15))


def click(press, release, p):
    sfx.add(press, pan(mouse_click(0.62, seed=int(press * 100)), p))
    sfx.add(release, pan(mouse_click(0.5, seed=int(release * 100) + 1, up=True), p))
    sfx.add(press + 0.005, pan(ui_click(0.22, 1.2, seed=int(press * 100) + 2), p))


click(*CTA_TAP, 0.15)
send.add(CTA_TAP[0], pan(ui_click(0.2), 0.15))
sfx.add(CTA_TAP[1] + 0.06, swish(0.4, 0.07, 600, 3000, 0.2, -0.2, seed=722))  # page change
sfx.add(Q["settle"][0] + 0.1, pan(thock(0.22, 200), 0))

# ------------------------------------------------------------------ 3. the choices
click(*BUILD, -0.1)
sfx.add(Q["scroll1"][0], whoosh(Q["scroll1"][1] - Q["scroll1"][0], 400, 2600, peak=0.4, level=0.1, seed=730))
sfx.add(Q["gaming"]["focus"][0], pan(sweep(330, 660, 0.3) * env_bell(0.3, 0.8) * 0.06, -0.2))
click(*GAMING, -0.25)
sfx.add(GAMING[1] + 0.01, swish(0.24, 0.09, 2500, 8000, -0.4, 0.1, seed=731))  # underline
sfx.add(Q["res"]["fan"][0], whoosh(0.22, 900, 4500, peak=0.5, level=0.07, pan_from=0, pan_to=-0.6, seed=732))
sfx.add(Q["res"]["fan"][0], whoosh(0.22, 900, 4500, peak=0.5, level=0.07, pan_from=0, pan_to=0.6, seed=733))
click(*RES, -0.05)
sfx.add(RES[1] + 0.05, pan(lock_clack(0.12, pitch=1.6, seed=734), 0))
c0, c1 = Q["fps"]["count"]
for k, f in enumerate([1318.5, 1760.0, 2349.3]):  # 60 — 120 — 144+
    sfx.add(c0 + k * (c1 - c0) / 2, pan(count_tick(f, 0.13), 0.15))
click(*FPS_, 0.15)
sfx.add(FPS_[1] + 0.06, pan(chime([2637.0, 3520.0], 0.11, 0.05, 0.12), 0.2))
sfx.add(Q["scroll2"][0], whoosh(Q["scroll2"][1] - Q["scroll2"][0], 420, 3000, peak=0.4, level=0.09, seed=735))
click(*COLOUR, -0.05)
sfx.add(COLOUR[1], shimmer(0.6, 0.13, seed=736))

# ------------------------------------------------------------------ 4. the quotation
c0, c1 = Q["consolidate"]
for k in range(4):
    sfx.add(c0 + 0.08 * k, swish(c1 - c0 - 0.15, 0.07, 600, 3800, -0.6 + 0.4 * k, 0.0, seed=740 + k))
    sfx.add(c1 - 0.14 + 0.06 * k, pan(lock_clack(0.18, pitch=1.2 + 0.08 * k, seed=745 + k), 0))
sfx.add(Q["card"], pan(thock(0.3, 170), 0))
for k, tl in enumerate(Q["lines"]):
    sfx.add(tl, swish(0.12, 0.05, 1200, 5000, -0.2, 0.2, seed=750 + k))
    sfx.add(tl + 0.11, pan(lock_clack(0.22, pitch=0.95 + 0.07 * k, seed=755 + k), 0))
sfx.add(Q["price"], pan(thock(0.34, 210), 0))
sfx.add(Q["price"] + 0.12, swish(0.3, 0.07, 3000, 9000, -0.3, 0.3, seed=760))
sfx.add(Q["send"]["path"][0], swish(0.35, 0.03, 1200, 3000, -0.1, 0.1, seed=761))
click(*SEND, 0.05)

# ------------------------------------------------------------------ 5. monitor → phone: the WhatsApp object
i0, i1 = TP["icon"]
sfx.add(i0, pan(detach(0.4), 0))
sfx.add(i0 + 0.02, shimmer(0.4, 0.1, seed=770))
sfx.add(i0 + 0.05, whoosh(i1 - i0 - 0.02, 300, 3600, peak=0.55, level=0.26, pan_from=-0.1, pan_to=0.6, seed=771))
sfx.add(i0 + 0.05, pan(sweep(520, 1040, i1 - i0) * env_bell(i1 - i0, 0.6) * 0.035, np.linspace(-0.1, 0.6, secs(i1 - i0))))
sfx.add(TP["camera"][0], whoosh(TP["camera"][1] - TP["camera"][0], 160, 900, peak=0.5, level=0.1, seed=772))  # camera travel
sfx.add(TP["wake"], pan(land(0.62), 0.45))
sfx.add(TP["wake"] + 0.04, pan(power_on(0.22, seed=773), 0.4))  # the phone wakes
send.add(TP["wake"], pan(glass_tap(0.3), 0.4))
sfx.add(TP["wake"] + 0.08, pan(chime([1568.0, 2093.0], 0.08, 0.04, 0.2), 0.4))

# ------------------------------------------------------------------ 6. WhatsApp on the phone
P = 0.3  # the phone sits slightly right in the stereo field
sfx.add(CH["attach"], pan(paper_click(0.26), P))
sfx.add(CH["attach"] + 0.02, pan(tick_in(0.3), P))
sfx.add(CH["proceed"], pan(pop_out(0.4), P + 0.1))
sfx.add(CH["proceed"] + 0.33, pan(tick(4200, 0.09, 0.02, seed=780), P + 0.1))
for d in range(3):
    sfx.add(CH["typing"] + 0.04 + 0.1 * d, pan(blip(880 * (1.26**d), 0.05, 0.04), P - 0.2))
sfx.add(CH["typing"] + 0.36, pan(typing(CH["reply"] - CH["typing"] - 0.38, 0.09), P - 0.2))
sfx.add(CH["reply"], pan(tick_in(0.34), P - 0.2))
for k in range(3):
    sfx.add(CH["tokens"][k], pan(tick(2600 + 300 * k, 0.11, 0.02, seed=781 + k), P - 0.3 + 0.2 * k))
    sfx.add(CH["checks"][k], pan(chime([1568.0 * (1.12**k)], 0.14, 0.0, 0.12), P - 0.3 + 0.2 * k))
sfx.add(CH["collapse"][0], swish(0.18, 0.07, 2000, 6000, 0.5, 0.1, seed=785))
sfx.add(CH["collapse"][1], pan(chime([1318.5, 1975.5], 0.26, 0.08, 0.3), P - 0.2))
send.add(CH["collapse"][1], pan(chime([1318.5, 1975.5], 0.1, 0.08, 0.3), P - 0.2))
sfx.add(CH["order"], pan(tick_in(0.36), P - 0.2))
sfx.add(CH["order"] + 0.14, pan(thock(0.22, 240), P - 0.2))
sfx.add(CH["paid"], pan(pop_out(0.38), P + 0.1))
sfx.add(CH["paid"] + 0.05, swish(0.24, 0.07, 1500, 6000, 0.6, 0.3, seed=786))
sfx.add(CH["paid"] + 0.28, pan(paper_click(0.24), P + 0.1))
sfx.add(CH["done"], pan(tick_in(0.32), P - 0.2))
sfx.add(CH["payoff"][0], pan(kick(0.4), 0))
sfx.add(CH["payoff"][0], pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.34, 0.05, 0.5), 0.1))
send.add(CH["payoff"][0], pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.16, 0.05, 0.5), 0.1))
sfx.add(CH["push"] - 0.45, riser(0.5, 0.14, seed=787))

# ------------------------------------------------------------------ 7. route
sfx.add(CH["push"], whoosh(0.6, 500, 5000, peak=0.8, level=0.22, pan_from=0.2, pan_to=-0.2, seed=790))
sfx.add(RT["stroke"][0] + 0.3, swish(0.45, 0.12, 1500, 7000, -0.6, 0.2, seed=791))
sfx.add(RT["head"], pan(thock(0.4, 160), -0.15))
sfx.add(RT["us"], pan(ping(1318.5, 0.11), -0.6))
sfx.add(RT["parcel"], shimmer(0.4, 0.1, seed=792))
tv = RT["travel"][1] - RT["travel"][0]
sfx.add(RT["travel"][0], whoosh(tv + 0.1, 250, 3000, peak=0.65, level=0.18, pan_from=-0.7, pan_to=0.7, seed=793))
sfx.add(RT["travel"][0], pan(sweep(220, 440, tv) * env_bell(tv, 0.7) * 0.045, np.linspace(-0.6, 0.6, secs(tv))))
u = np.linspace(0, 1, 2001)
e = np.where(u < 0.5, 4 * u**3, 1 - (-2 * u + 2) ** 3 / 2)
for k, mu in enumerate([0.2, 0.36, 0.52, 0.68, 0.84]):
    tm = RT["travel"][0] + tv * u[np.argmin(np.abs(e - mu))]
    sfx.add(tm, pan(tick(3400 + 150 * k, 0.08, 0.02, seed=794 + k), -0.6 + 0.3 * k))
sfx.add(RT["travel"][1] - 0.6, riser(0.62, 0.13, seed=800))
sfx.add(RT["arrive"], pan(kick(0.6), 0.5))
sfx.add(RT["arrive"], pan(sub_boom(0.34), 0.4))  # Qatar: the sub impact
sfx.add(RT["arrive"], pan(ping(1760, 0.15), 0.55))
send.add(RT["arrive"], pan(ping(1760, 0.12), 0.55))
sfx.add(RT["fan"][0], riser(RT["fan"][1] - RT["fan"][0] + 0.05, 0.2, seed=801))
sfx.add(RT["fan"][1] - 0.2, whoosh(0.4, 200, 4000, peak=0.5, level=0.22, seed=802))

# ------------------------------------------------------------------ 8. real builds
sfx.add(BU["a"][0], pan(sub_boom(0.3), 0))
sfx.add(BU["a"][0], shimmer(0.7, 0.14, seed=810))  # RGB swell
sfx.add(BU["a"][0] + 0.05, whoosh(0.8, 2000, 300, peak=0.2, level=0.14, seed=811))
sfx.add(BU["b"][0], whoosh(0.5, 300, 4500, peak=0.55, level=0.26, pan_from=1.0, pan_to=0.0, seed=812))
sfx.add(BU["b"][0] + 0.48, whoosh(0.36, 300, 4200, peak=0.5, level=0.22, pan_from=0.0, pan_to=-1.0, seed=813))
sfx.add(BU["c"] + 0.05, pan(power_on(0.36, seed=814), 0))
sfx.add(BU["c"] + 0.05, shimmer(0.7, 0.12, seed=815))
sfx.add(BU["realBuilds"], pan(thock(0.45, 150), 0))
sfx.add(BU["builtBy"], pan(chime([440.0, 659.25, 880.0], 0.055, 0.08, 0.5), 0))

# ------------------------------------------------------------------ 9. parts → snap → dark → CLICK
sfx.add(PT["closer"][0], whoosh(0.4, 300, 1800, peak=0.5, level=0.07, seed=820))
PANS = [-0.5, 0.5, 0.5, -0.5, -0.5]
for k, tl in enumerate(PT["labels"]):
    sfx.add(tl, pan(blip(1046.5 * (1.12**k), 0.07, 0.06), PANS[k]))
    sfx.add(tl + 0.03, pan(tick(2600, 0.05, 0.02, seed=821 + k), PANS[k]))
for k, ts in enumerate(PT["snaps"]):
    sfx.add(ts, pan(lock_clack(0.3 + 0.05 * k, pitch=1.15 - 0.06 * k, seed=830 + k), [-0.4, 0.4, 0.4, -0.4, -0.3][k]))
sfx.add(PT["off"], pan(power_down(0.28), 0))
sfx.add(PT["click"], pan(ui_click(0.95, 0.85, seed=840), 0))
sfx.add(PT["click"], pan(kick(0.8), 0))
sfx.add(PT["click"], pan(power_on(0.55, seed=841), 0))
send.add(PT["click"], pan(power_on(0.25, seed=842), 0))
for k, tw in enumerate(PT["words"]):
    sfx.add(tw, pan(thock(0.48 + 0.1 * k, 150 + 30 * k), 0))
    sfx.add(tw, pan(kick(0.28 + 0.15 * k), 0))
sfx.add(PT["words"][2], shimmer(0.5, 0.15, seed=843))  # READY

# ------------------------------------------------------------------ 10. back to the workstation → into the monitor
sfx.add(RET["glow"][0], shimmer(0.6, 0.08, seed=850))
sfx.add(RET["pull"][0], whoosh(RET["pull"][1] - RET["pull"][0], 2400, 260, peak=0.3, level=0.12, seed=851))
sfx.add(RET["pull"][1] - 0.05, pan(thock(0.16, 110), 0))  # the desk settles back into frame
sfx.add(RET["approach"][0], whoosh(RET["approach"][1] - RET["approach"][0], 200, 1200, peak=0.7, level=0.08, seed=852))
sfx.add(FLY[0] - 0.3, riser(0.4, 0.12, seed=853))
sfx.add(FLY[0], whoosh(FLY[1] - FLY[0] + 0.12, 200, 5200, peak=0.8, level=0.3, seed=854))  # suction through the glass
sfx.add(FLY[1] - 0.02, pan(whump(0.32), 0))
send.add(FLY[1], pan(whump(0.15), 0))
sfx.add(CT["hover"] - 0.5, swish(0.4, 0.025, 1200, 3000, 0.2, 0.0, seed=855))
sfx.add(CT["hover"], pan(blip(1760, 0.055, 0.08), 0.05))
sfx.add(CT["hover"] + 0.02, shimmer(0.4, 0.06, seed=856))

# ------------------------------------------------------------------ ✦ the M1 signature
sfx.add(SG["fade"][0], whoosh(0.4, 2000, 200, peak=0.3, level=0.1, seed=860))
sfx.add(SG["split"], pan(zap_drop(0.22, 3600, 900, 0.08), 0))
sfx.add(SG["fly"][0], whoosh(0.3, 600, 5000, peak=0.5, level=0.15, pan_from=0, pan_to=-0.8, seed=861))
sfx.add(SG["fly"][0], whoosh(0.3, 650, 5200, peak=0.5, level=0.15, pan_from=0, pan_to=0.8, seed=862))
sfx.add(SG["fly"][0] + 0.24, pan(fold(0.34, 0.28), -0.3))
sfx.add(SG["fly"][0] + 0.26, pan(fold(0.34, 0.28), 0.3))
sfx.add(SG["yellow"][0], swish(SG["yellow"][1] - SG["yellow"][0], 0.05, 5000, 11000, -0.7, 0.2, seed=863))
sfx.add(SG["dip"][0] - 0.1, pan(hum(SG["lock"] - SG["dip"][0] + 0.1, 70, 110, level=0.1), 0))  # held breath
sfx.add(SG["lock"], pan(sub_boom(0.6), 0))
sfx.add(SG["lock"], pan(lock_clack(0.9, pitch=1.0, seed=870), -0.15))
sfx.add(SG["lock"] + 0.045, pan(lock_clack(0.75, pitch=1.18, seed=871), 0.15))
send.add(SG["lock"], pan(lock_clack(0.4), 0))
sfx.add(SG["wordmark"][0], shimmer(0.5, 0.18, seed=872))
sfx.add(SG["wordmark"][0], pan(chime([2637.0, 3135.96, 3951.07], 0.07, 0.05, 0.4), 0))
send.add(SG["wordmark"][0], shimmer(0.5, 0.1, seed=873))
sfx.add(SG["sweep"][0], swish(0.34, 0.06, 4000, 10000, -0.5, 0.5, seed=874))
sfx.add(SG["line1"], pan(thock(0.38, 150), 0))

# ------------------------------------------------------------------ mix + loudness
wet = apply_reverb(send.buf, reverb_ir(1.8, 0.45), wet=1.0) * 0.4
mix = music.buf * db(-4) + sfx.buf + wet
mix = mix[: secs(DUR)]
out = master(mix, -1.0)
fade = np.ones(len(out))
fade[: secs(0.004)] = np.linspace(0, 1, secs(0.004))
fade[-secs(0.5) :] = np.linspace(1, 0, secs(0.5)) ** 1.5
out *= fade[:, None]
dest = os.path.join(ROOT, "public/audio/v7.wav")
write_wav(dest, out)


def measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    lines = [l.strip() for l in r.splitlines()]
    lufs = float([l for l in lines if l.startswith("I:")][-1].split()[1])
    peak = float([l for l in lines if l.startswith("Peak:")][-1].split()[1])
    return lufs, peak


# -14 LUFS integrated; true peak held to ~-2 dBTP so the AAC encode stays under -1 dBTP
ceil = db(-2.2)
out2 = out
for it in range(8):
    lufs, peak = measure(dest)
    if abs(lufs + 14) < 0.1 and peak <= -2.0:
        break
    out2 = out2 * db(-14 - lufs)
    up = resample_poly(out2, 4, 1, axis=0)
    if np.abs(up).max() > ceil:
        knee = ceil * 0.7
        mag = np.abs(out2)
        comp = knee + (ceil - knee) * np.tanh((mag - knee) / (ceil - knee))
        out2 = np.where(mag > knee, np.sign(out2) * comp, out2)
    write_wav(dest, out2)
lufs, peak = measure(dest)
print(f"final {lufs:.1f} LUFS, true peak {peak:.1f} dBTP; wrote {dest}")
