"""Score + SFX for the v6 cut (~33.4 s, 116 BPM, A minor) — re-scored for the
slower edit, not stretched. Every SFX time comes from the real capture log
(contact / press / release frames) or from timeline.json `v6`, the same
values the picture reads. Original synthesis only.

Dynamics are part of the design: near silence on black; a held breath before
the logo lock; the groove arrives with the website; space under the chat; a
drop-out before the PC's RGB click; a reduction before the final lock; a
short M1 sonic signature (sub + two mechanical clicks + a yellow shimmer).
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
V = T["v6"]
LOG = json.load(open(os.path.join(ROOT, "public/cap/journey6/log.json")))
BEAT = T["beat"]
BAR = 4 * BEAT
DUR = V["duration"]
A = V["anchor"]
J0 = V["home"]["captureStart"]
jt = lambda i: J0 + i / 60
I, HM, Q, CH, RT, BU, PT, CT, SG = (V[k] for k in ["intro", "home", "quote", "chat", "route", "builds", "parts", "cta", "sig"])

taps, contacts = [], []
for i in range(1, len(LOG)):
    a, b = LOG[i - 1]["mouse"], LOG[i]["mouse"]
    if b["down"] and not a["down"]:
        j = i
        while LOG[j]["mouse"]["down"]:
            j += 1
        taps.append((jt(i), jt(j)))
    if b["x"] >= 0 and (a["x"] < 0 or abs(a["x"] - b["x"]) > 1) and not b["down"]:
        contacts.append(jt(i))
CTA_TAP, BUILD, GAMING, RES, FPS_, COLOUR, SEND = taps
REL = CTA_TAP[1]
PASS = REL + 0.6
print("taps", [(round(p, 3), round(r, 3)) for p, r in taps])
print("contacts", [round(c, 3) for c in contacts])

music, sfx, send = Bus(DUR + 1.5), Bus(DUR + 1.5), Bus(DUR + 1.5)


def hum(dur, f0=55.0, f1=82.0, level=1.0):
    """The magnetic pull between the emblem halves: a low rising hum with beating."""
    t = np.arange(secs(dur)) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    v = np.sin(ph) + 0.5 * np.sin(ph * 2.003) + 0.25 * np.sin(ph * 3.01)
    env = (t / dur) ** 1.6 * np.minimum(1, (dur - t) / 0.05)
    return lp(v, 600) * env * level


def power_down(level=1.0):
    d = 0.18
    return sweep(900, 60, d) * env_exp(d, 0.08) * level


def power_on(level=1.0):
    d = 0.7
    t = np.arange(secs(d)) / SR
    body = np.sin(2 * np.pi * np.cumsum(np.linspace(55, 110, len(t))) / SR) * np.exp(-t / 0.35)
    air = bp(noise(d, 301), 1500, 9000) * np.exp(-t / 0.18) * np.minimum(1, t / 0.01)
    return (np.tanh(1.6 * body) * 0.8 + air * 0.35) * level


def rebound(level=1.0):
    d = 0.14
    t = np.arange(secs(d)) / SR
    f = 380 * (1 + 0.6 * np.sin(np.pi * t / d))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.04) * level


def count_tick(f, level=1.0):
    return chime([f], level, 0.0, 0.08)


# ------------------------------------------------------------------ music
CH_AM = [220.0, 261.63, 329.63, 440.0]
CH_F = [174.61, 261.63, 349.23, 440.0]
CH_C = [196.0, 261.63, 329.63, 392.0]
CH_G = [196.0, 246.94, 293.66, 392.0]
CH_AM9 = [220.0, 261.63, 329.63, 493.88, 659.25]
bars = [A + k * BAR for k in range(16)]
plan = [
    ("breath", CH_AM, 55.0), ("groove", CH_F, 43.65), ("light", CH_C, 65.41), ("light", CH_G, 49.0),
    ("groove", CH_AM, 55.0), ("groove", CH_F, 43.65), ("chat", CH_C, 65.41), ("chat", CH_G, 49.0),
    ("drive", CH_AM, 55.0), ("drive", CH_F, 43.65), ("drive", CH_C, 65.41), ("rise", CH_G, 49.0),
    ("rise", CH_AM, 55.0), ("half", CH_F, 43.65),
]
kicks = []
# intro: almost nothing — a breath of air and the hum; a pad ramp only after the lock
music.add(0.05, pan(lp(noise(1.1, 401), 900) * env_bell(1.1, 0.6) * 0.05, 0))
pad_in = pad_chord([110.0, 164.81, 220.0, 329.63], A - I["lock"] + 0.4, cutoff=900, level=0.5)
music.add(I["lock"], pad_in * (np.linspace(0, 1, len(pad_in)) ** 1.4)[:, None])

for b, (sec, chord, root) in enumerate(plan):
    t0 = bars[b]
    if t0 > DUR:
        break
    cut = {"breath": 1100, "groove": 1500, "light": 1700, "chat": 1900, "drive": 1700, "rise": 1400, "half": 1300}[sec]
    lvl = {"breath": 0.4, "groove": 0.4, "light": 0.36, "chat": 0.34, "drive": 0.4, "rise": 0.42, "half": 0.42}[sec]
    music.add(t0, pad_chord(chord, BAR + 0.35, cutoff=cut, level=lvl))
    for q in range(4):
        tb = t0 + q * BEAT
        if tb > SG["collapse"][0]:
            break
        # the drop-out before the RGB click
        if PT["off"] - 0.12 <= tb < PT["click"]:
            continue
        on4 = sec in ("groove", "drive", "rise")
        if on4 or (sec in ("breath", "light", "chat", "half") and q in (0, 2)):
            if not (sec == "breath" and q == 2):
                k = kick(0.85) if on4 else soft_kick(0.75, cutoff=1300)
                music.add(tb, k)
                kicks.append(tb)
        if sec in ("groove", "drive", "rise"):
            music.add(tb, bass_note(root, BEAT * 0.48, 0.42))
            music.add(tb + BEAT / 2, bass_note(root * 2, BEAT * 0.42, 0.26))
            music.add(tb + BEAT / 2, pan(hat(0.09), 0.25))
        elif sec in ("light", "chat", "half") and q in (0, 2):
            music.add(tb, bass_note(root, BEAT * 1.8, 0.34))
        if sec in ("drive", "rise") and q in (1, 3):
            music.add(tb, pan(snap_clap(0.3), -0.05))
        if sec == "rise":
            for s16 in (0.25, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.04 + 0.025 * q / 3), -0.3))
        if sec in ("light", "chat"):
            for s16 in (0.25, 0.5, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.028), 0.35 if s16 != 0.5 else -0.35))
    if sec in ("chat", "light"):
        arp = [chord[1] * 2, chord[2] * 2, chord[3] * 2, chord[2] * 2]
        for e in range(8):
            music.add(t0 + e * BEAT / 2, pan(pluck(arp[e % 4], 0.06, 0.35), -0.4 + 0.8 * (e % 2)))

# the M1 signature: everything drops away, a held breath, then the lock and one chord
music.add(SG["lock"], pad_chord(CH_AM9, DUR - SG["lock"] + 0.8, cutoff=2600, level=0.6))
music.add(SG["lock"], bass_note(55.0, 0.9, 0.6))

env = np.ones(len(music.buf))
for tb in kicks:
    i, n = secs(tb), secs(0.2)
    if 0 <= i and i + n < len(env):
        env[i : i + n] *= 1 - 0.42 * np.exp(-np.arange(n) / secs(0.06))
# global dynamics: the RGB drop-out, the signature reduction
def duck(t0, t1, depth, fade=0.06):
    i0, i1, nf = secs(t0), secs(t1), secs(fade)
    env[i0 - nf : i0] *= np.linspace(1, 1 - depth, nf)
    env[i0:i1] *= 1 - depth
    env[i1 : i1 + nf] *= np.linspace(1 - depth, 1, nf)
duck(PT["off"] - 0.1, PT["click"], 0.9)
duck(SG["collapse"][0], SG["lock"], 0.75, fade=0.3)
music.buf *= env[:, None]

# ------------------------------------------------------------------ 1. intro
sfx.add(I["leftIn"], pan(hum(I["near"] - I["leftIn"], level=0.16), -0.4))
sfx.add(I["rightIn"], pan(hum(I["near"] - I["rightIn"], 58, 87, level=0.14), 0.4))
sfx.add(I["leftIn"], whoosh(0.6, 300, 2400, peak=0.7, level=0.08, pan_from=-0.9, pan_to=-0.3, seed=401))
sfx.add(I["rightIn"], whoosh(0.5, 320, 2600, peak=0.7, level=0.08, pan_from=0.9, pan_to=0.3, seed=402))
sfx.add(I["near"], pan(tick(5200, 0.08, 0.02, seed=403), 0))  # nearly touching
sfx.add(I["lock"], pan(lock_clack(0.85), 0))
sfx.add(I["lock"], pan(sub_boom(0.22), 0))
send.add(I["lock"], pan(lock_clack(0.35), 0))
sfx.add(I["wm"][0], shimmer(0.4, 0.18, seed=404))
sfx.add(I["wm"][0] + 0.02, swish(0.3, 0.06, 4000, 9000, -0.5, 0.5, seed=405))  # light travel
sfx.add(I["approach"], riser(I["pass"] - I["approach"], 0.24, seed=406))
sfx.add(I["pass"] - 0.22, whoosh(0.4, 180, 3600, peak=0.55, level=0.34, pan_from=-0.3, pan_to=0.3, seed=407))
sfx.add(A, pan(whump(0.4), 0))
send.add(A, pan(whump(0.2), 0))

# ------------------------------------------------------------------ 2. homepage
sfx.add(HM["scroll"][0], whoosh(HM["scroll"][1] - HM["scroll"][0], 300, 1800, peak=0.35, level=0.08, seed=410))
sfx.add(HM["focus"][0], pan(sweep(220, 330, 0.5) * env_bell(0.5, 0.6) * 0.04, 0.1))  # the button takes focus
sfx.add(HM["hover"], pan(blip(1760, 0.05, 0.08), 0.25))  # fingertip hovers (anticipation)
sfx.add(contacts[0], pan(glass_tap(0.5), 0.25))
sfx.add(CTA_TAP[0], pan(ui_click(0.7, 1.0, seed=411), 0.2))
sfx.add(REL, pan(ui_click(0.36, 1.4, seed=412), 0.2))
sfx.add(REL + 0.02, pan(rebound(0.12), 0.2))
send.add(CTA_TAP[0], pan(ui_click(0.25), 0.2))
sfx.add(REL + 0.09, pan(fold(0.42, 0.5), 0.1))
send.add(REL + 0.09, pan(fold(0.42, 0.22), 0.1))
sfx.add(REL + 0.26, pan(lock_clack(0.42, pitch=0.8, seed=413), 0))
sfx.add(REL + 0.1, riser(PASS - REL - 0.1, 0.2, seed=414))
sfx.add(PASS - 0.24, whoosh(0.36, 200, 5200, peak=0.62, level=0.34, pan_from=0.25, pan_to=-0.1, seed=415))
sfx.add(PASS, pan(kick(0.7), 0))
sfx.add(PASS, pan(sub_boom(0.32), 0))

# ------------------------------------------------------------------ 3. the choices
def tap_set(contact, press, release, p, tone):
    sfx.add(contact, pan(glass_tap(0.4), p))
    sfx.add(press, pan(ui_click(0.52, tone, seed=int(press * 100)), p))
    sfx.add(release, pan(ui_click(0.24, tone * 1.3, seed=int(release * 100)), p))

tap_set(contacts[1], BUILD[0], BUILD[1], -0.15, 1.0)
sfx.add(Q["scroll1"][0], whoosh(Q["scroll1"][1] - Q["scroll1"][0], 400, 3000, peak=0.35, level=0.13, seed=420))
# Gaming: the others step aside, Gaming is drawn in — a magnetic swell — tap — the underline zips
sfx.add(Q["gaming"]["focus"], pan(sweep(330, 660, 0.3) * env_bell(0.3, 0.8) * 0.06, -0.2))
tap_set(contacts[2], GAMING[0], GAMING[1], -0.3, 1.05)
sfx.add(GAMING[1] + 0.01, swish(0.24, 0.1, 2500, 8000, -0.4, 0.1, seed=421))
# 1440p: the row fans out (a stereo spread), tap, settles back
sfx.add(Q["res"]["fan"], whoosh(0.22, 900, 4500, peak=0.5, level=0.08, pan_from=0, pan_to=-0.6, seed=422))
sfx.add(Q["res"]["fan"], whoosh(0.22, 900, 4500, peak=0.5, level=0.08, pan_from=0, pan_to=0.6, seed=423))
tap_set(contacts[3], RES[0], RES[1], -0.1, 1.12)
sfx.add(RES[1] + 0.05, pan(lock_clack(0.12, pitch=1.6, seed=424), 0))
# 144+ FPS: the count — three rising ticks — then the choice
for k, f in enumerate([1318.5, 1760.0, 2349.3]):
    sfx.add(Q["fps"]["count"] + k * (contacts[4] - Q["fps"]["count"]) / 3, pan(count_tick(f, 0.14), 0.15))
tap_set(contacts[4], FPS_[0], FPS_[1], 0.15, 1.2)
sfx.add(FPS_[1] + 0.06, pan(chime([2637.0, 3520.0], 0.12, 0.05, 0.12), 0.2))
sfx.add(Q["scroll2"][0], whoosh(Q["scroll2"][1] - Q["scroll2"][0], 420, 3200, peak=0.35, level=0.11, seed=425))
# White: tap, then a soft light
tap_set(contacts[5], COLOUR[0], COLOUR[1], -0.1, 1.28)
sfx.add(COLOUR[1], shimmer(0.6, 0.15, seed=426))

# ------------------------------------------------------------------ 4. the quotation
c0, c1 = Q["consolidate"]
for k in range(4):
    sfx.add(c0 + 0.08 * k, swish(c1 - c0 - 0.15, 0.08, 600, 3800, -0.6 + 0.4 * k, 0.0, seed=430 + k))
    sfx.add(c1 - 0.14 + 0.06 * k, pan(lock_clack(0.2, pitch=1.2 + 0.08 * k, seed=440 + k), 0))
sfx.add(Q["card"], pan(thock(0.3, 170), 0))
sfx.add(Q["card"] + 0.05, swish(0.4, 0.07, 300, 2000, 0, 0, seed=445))
for k, tl in enumerate(Q["lines"]):  # each line: a drawer sliding out, a small mechanical stop
    sfx.add(tl, swish(0.12, 0.05, 1200, 5000, -0.2, 0.2, seed=446 + k))
    sfx.add(tl + 0.11, pan(lock_clack(0.24, pitch=0.95 + 0.07 * k, seed=450 + k), 0))
sfx.add(Q["price"], pan(thock(0.35, 210), 0))
sfx.add(Q["price"] + 0.12, swish(0.3, 0.08, 3000, 9000, -0.3, 0.3, seed=455))  # underline sweep
tap_set(contacts[6], SEND[0], SEND[1], 0.1, 0.95)
send.add(SEND[0], pan(ui_click(0.25), 0.1))

# ------------------------------------------------------------------ 5. WhatsApp
SR_ = SEND[1]
sfx.add(SR_ + 0.02, whoosh(0.44, 500, 5000, peak=0.6, level=0.22, pan_from=0.5, pan_to=-0.5, seed=460))
sfx.add(CH["attach"][1] - 0.04, pan(paper_click(0.3), -0.3))
sfx.add(CH["attach"][1] - 0.02, pan(tick_in(0.36), -0.3))  # the quotation arrives
sfx.add(CH["proceed"], pan(pop_out(0.42), 0.3))
sfx.add(CH["proceed"] + 0.33, pan(tick(4200, 0.1, 0.02, seed=461), 0.35))
for d in range(3):  # three dots, one by one
    sfx.add(CH["typing"] + 0.04 + 0.1 * d, pan(blip(880 * (1.26 ** d), 0.06, 0.04), -0.3))
sfx.add(CH["typing"] + 0.36, pan(typing(CH["reply"] - CH["typing"] - 0.38, 0.1), -0.3))
sfx.add(CH["reply"], pan(tick_in(0.36), -0.3))
for k in range(3):
    sfx.add(CH["tokens"][k], pan(tick(2600 + 300 * k, 0.12, 0.02, seed=462 + k), -0.2 + 0.2 * k))
    sfx.add(CH["checks"][k], pan(chime([1568.0 * (1.12 ** k)], 0.15, 0.0, 0.12), -0.2 + 0.2 * k))
sfx.add(CH["collapse"][0], swish(0.18, 0.08, 2000, 6000, 0.3, -0.3, seed=466))
sfx.add(CH["confirmed"], pan(chime([1318.5, 1975.5], 0.3, 0.08, 0.32), -0.2))
send.add(CH["confirmed"], pan(chime([1318.5, 1975.5], 0.12, 0.08, 0.32), -0.2))
sfx.add(CH["order"], pan(tick_in(0.38), -0.3))
sfx.add(CH["order"] + 0.14, pan(thock(0.24, 240), -0.3))
sfx.add(CH["paid"], pan(pop_out(0.4), 0.3))
sfx.add(CH["paid"] + 0.05, swish(0.24, 0.08, 1500, 6000, 0.6, 0.3, seed=467))  # the receipt flies in
sfx.add(CH["paid"] + 0.28, pan(paper_click(0.26), 0.35))
sfx.add(CH["done"], pan(tick_in(0.34), -0.2))
sfx.add(CH["payoff"][0], pan(kick(0.4), 0))
sfx.add(CH["payoff"][0], pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.36, 0.05, 0.5), 0))
send.add(CH["payoff"][0], pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.18, 0.05, 0.5), 0))
sfx.add(CH["push"] - 0.1, riser(0.6, 0.18, seed=468))

# ------------------------------------------------------------------ 6. route
sfx.add(CH["push"], whoosh(0.5, 600, 6000, peak=0.85, level=0.26, pan_from=-0.2, pan_to=0.2, seed=470))
sfx.add(RT["stroke"][0] + 0.3, swish(0.4, 0.14, 1500, 7000, -0.6, 0.2, seed=471))  # the tick's stroke stretches out
sfx.add(RT["head"], pan(thock(0.45, 160), -0.15))
sfx.add(RT["head"] + 0.08, pan(thock(0.45, 190), 0.15))
sfx.add(RT["us"], pan(ping(1318.5, 0.12), -0.6))
sfx.add(RT["parcel"], shimmer(0.4, 0.12, seed=472))
tv = RT["travel"][1] - RT["travel"][0]
sfx.add(RT["travel"][0], whoosh(tv + 0.1, 250, 3600, peak=0.7, level=0.22, pan_from=-0.7, pan_to=0.7, seed=473))
sfx.add(RT["travel"][0], pan(sweep(220, 440, tv) * env_bell(tv, 0.7) * 0.05, np.linspace(-0.6, 0.6, secs(tv))))
for k, mu in enumerate([0.2, 0.36, 0.52, 0.68, 0.84]):
    # inOutCubic travel: time at which the parcel reaches mu
    u = np.linspace(0, 1, 2001)
    e = np.where(u < 0.5, 4 * u**3, 1 - (-2 * u + 2) ** 3 / 2)
    tm = RT["travel"][0] + tv * u[np.argmin(np.abs(e - mu))]
    sfx.add(tm, pan(tick(3400 + 150 * k, 0.09, 0.02, seed=474 + k), -0.6 + 0.3 * k))
sfx.add(RT["travel"][1] - 0.6, riser(0.62, 0.14, seed=480))
sfx.add(RT["arrive"], pan(kick(0.6), 0.5))
sfx.add(RT["arrive"], pan(sub_boom(0.3), 0.4))
sfx.add(RT["arrive"], pan(ping(1760, 0.16), 0.55))
send.add(RT["arrive"], pan(ping(1760, 0.12), 0.55))
sfx.add(RT["fan"][0], riser(RT["fan"][1] - RT["fan"][0] + 0.05, 0.22, seed=481))
sfx.add(RT["fan"][1] - 0.2, whoosh(0.4, 200, 4000, peak=0.5, level=0.24, seed=482))

# ------------------------------------------------------------------ 7. builds
sfx.add(BU["a"][0], pan(sub_boom(0.34), 0))
sfx.add(BU["a"][0], shimmer(0.7, 0.16, seed=490))
sfx.add(BU["a"][0] + 0.05, whoosh(0.8, 2000, 300, peak=0.2, level=0.16, seed=491))  # pulling back out of the fan
sfx.add(BU["b"][0] - 0.12, pan(sweep(440, 880, 0.2) * env_bell(0.2, 0.5) * 0.06, -0.2))  # A's fan flares
sfx.add(BU["b"][0], whoosh(0.5, 300, 4500, peak=0.55, level=0.3, pan_from=1.0, pan_to=0.0, seed=492))
sfx.add(BU["b"][0] + 0.48, whoosh(0.36, 300, 4200, peak=0.5, level=0.26, pan_from=0.0, pan_to=-1.0, seed=493))
sfx.add(BU["c"] + 0.05, pan(power_on(0.4), 0))  # the hero lights up
sfx.add(BU["c"] + 0.05, shimmer(0.7, 0.14, seed=494))
sfx.add(BU["realBuilds"], pan(thock(0.5, 150), 0))
sfx.add(BU["builtBy"], pan(chime([440.0, 659.25, 880.0], 0.06, 0.08, 0.5), 0))

# ------------------------------------------------------------------ 8. parts
sfx.add(PT["closer"][0], whoosh(0.4, 300, 1800, peak=0.5, level=0.08, seed=500))
for k, tl in enumerate(PT["labels"]):
    sfx.add(tl, pan(blip(1046.5 * (1.12 ** k), 0.08, 0.06), [-0.5, 0.5, 0.5, -0.5, -0.5][k]))
    sfx.add(tl + 0.03, pan(tick(2600, 0.06, 0.02, seed=501 + k), [-0.5, 0.5, 0.5, -0.5, -0.5][k]))
for k, ts in enumerate(PT["snaps"]):  # snap, snap, snap — each a little heavier
    sfx.add(ts, pan(lock_clack(0.3 + 0.05 * k, pitch=1.15 - 0.06 * k, seed=510 + k), [-0.4, 0.4, 0.4, -0.4, -0.3][k]))
sfx.add(PT["off"], pan(power_down(0.3), 0))
sfx.add(PT["click"], pan(ui_click(0.95, 0.85, seed=520), 0))
sfx.add(PT["click"], pan(kick(0.8), 0))
sfx.add(PT["click"], pan(power_on(0.55), 0))
send.add(PT["click"], pan(power_on(0.25), 0))
for k, tw in enumerate(PT["words"]):
    sfx.add(tw, pan(thock(0.5 + 0.1 * k, 150 + 30 * k), 0))
    sfx.add(tw, pan(kick(0.3 + 0.15 * k), 0))
sfx.add(PT["words"][2], shimmer(0.5, 0.15, seed=521))

# ------------------------------------------------------------------ 9. into the fan → the site's CTA
sfx.add(CT["fly"][0], whoosh(CT["fly"][1] - CT["fly"][0] + 0.1, 300, 5200, peak=0.85, level=0.3, seed=530))
sfx.add(CT["stretch"][0], swish(0.32, 0.12, 2000, 300, 0, 0, seed=531))
sfx.add(CT["pull"][0], whoosh(CT["pull"][1] - CT["pull"][0], 2400, 300, peak=0.3, level=0.12, seed=532))
sfx.add(CT["hover"], pan(blip(1760, 0.06, 0.08), 0.1))

# ------------------------------------------------------------------ ✦ the M1 signature
sfx.add(SG["collapse"][0], whoosh(0.4, 2000, 200, peak=0.3, level=0.12, seed=540))
sfx.add(SG["split"], pan(zap_drop(0.22, 3600, 900, 0.08), 0))  # the button cracks in two
sfx.add(SG["fly"][0], whoosh(0.3, 600, 5000, peak=0.5, level=0.16, pan_from=0, pan_to=-0.8, seed=541))
sfx.add(SG["fly"][0], whoosh(0.3, 650, 5200, peak=0.5, level=0.16, pan_from=0, pan_to=0.8, seed=542))
sfx.add(SG["fly"][0] + 0.24, pan(fold(0.34, 0.3), -0.3))
sfx.add(SG["fly"][0] + 0.26, pan(fold(0.34, 0.3), 0.3))
sfx.add(SG["yellow"][0], swish(SG["yellow"][1] - SG["yellow"][0], 0.06, 5000, 11000, -0.7, 0.2, seed=543))
sfx.add(SG["fly"][1], pan(hum(SG["lock"] - SG["fly"][1], 70, 110, level=0.1), 0))  # a held breath
sfx.add(SG["lock"], pan(sub_boom(0.6), 0))
sfx.add(SG["lock"], pan(lock_clack(0.9, pitch=1.0, seed=550), -0.15))
sfx.add(SG["lock"] + 0.045, pan(lock_clack(0.75, pitch=1.18, seed=551), 0.15))
send.add(SG["lock"], pan(lock_clack(0.4), 0))
sfx.add(SG["wordmark"][0], shimmer(0.5, 0.2, seed=552))
sfx.add(SG["wordmark"][0], pan(chime([2637.0, 3135.96, 3951.07], 0.08, 0.05, 0.4), 0))
send.add(SG["wordmark"][0], shimmer(0.5, 0.12, seed=553))
sfx.add(SG["sweep"][0], swish(0.34, 0.07, 4000, 10000, -0.5, 0.5, seed=554))
sfx.add(SG["line1"], pan(thock(0.4, 150), 0))

# ------------------------------------------------------------------ mix + loudness
wet = apply_reverb(send.buf, reverb_ir(1.8, 0.45), wet=1.0) * 0.4
mix = music.buf * db(-4) + sfx.buf + wet
mix = mix[: secs(DUR)]
out = master(mix, -1.0)
fade = np.ones(len(out))
fade[: secs(0.004)] = np.linspace(0, 1, secs(0.004))
fade[-secs(0.45) :] = np.linspace(1, 0, secs(0.45)) ** 1.5
out *= fade[:, None]
dest = os.path.join(ROOT, "public/audio/v6.wav")
write_wav(dest, out)
def measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    lines = [l.strip() for l in r.splitlines()]
    lufs = float([l for l in lines if l.startswith("I:")][-1].split()[1])
    peak = float([l for l in lines if l.startswith("Peak:")][-1].split()[1])
    return lufs, peak


# iterate: gain to -14 LUFS, true-peak limit (4x oversampled soft knee) to -1.2 dBTP, re-measure
ceil = db(-1.25)
out2 = out
for it in range(6):
    lufs, peak = measure(dest)
    if abs(lufs + 14) < 0.1 and peak <= -1.0:
        break
    out2 = out2 * db(-14 - lufs)
    up = resample_poly(out2, 4, 1, axis=0)
    tp = np.abs(up).max()
    if tp > ceil:
        # soft-knee limiter: only the part above the knee is compressed
        knee = ceil * 0.7
        mag = np.abs(out2)
        over = mag > knee
        comp = knee + (ceil - knee) * np.tanh((mag - knee) / (ceil - knee))
        out2 = np.where(over, np.sign(out2) * comp, out2)
    write_wav(dest, out2)
lufs, peak = measure(dest)
print(f"final {lufs:.1f} LUFS, true peak {peak:.1f} dBTP; wrote {dest}")
