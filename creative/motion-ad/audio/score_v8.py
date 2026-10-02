"""Score + SFX + mixes for v8–v10 — the voiceover cut (v10: tech-presenter narration, ~41 s, 116 BPM, A minor).

Every cue comes from timeline.json `v8` (derived from the narration's word
onsets by vo/build8.py) or from the journey8 capture log (the real press /
release frames) — the same values the picture reads. Original synthesis only
(no samples, no WhatsApp audio).

The voice is the priority: the music sits under it and is side-chained to it
(a smooth ducking envelope follows the narration), SFX accent only the visual
events that matter, and the dynamics keep their two held breaths — the RGB
drop-out before the click and the reduction before the final lock.

Outputs (48 kHz / 24-bit):
  public/audio/final8_vo.wav     — VO + ducked music + SFX (Version A)
  public/audio/final8_novo.wav   — music + SFX, music a touch up, no ducking (Version B)
  public/audio/final8_bed_vo.wav — Version A without the voice (music/SFX stem)
  (the clean voice stem is public/audio/vo8.wav, from vo/build8.py)
Each mix: −14 LUFS integrated, true peak ≤ −2 dBTP (headroom for AAC).
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa
from sfx_lib import lock_clack, glass_tap, soft_kick, fold, thock, pop_out, tick_in, typing, chime, paper_click, ping, zap_drop, swish  # noqa
from physical import hum, line_zip, spark, creak, power_on, panel_on, power_down, mouse_click, count_tick, detach, land, clash  # noqa

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
T = json.load(open(os.path.join(ROOT, "timeline.json")))
V = T["v8"]
LOG = json.load(open(os.path.join(ROOT, "public/cap/journey8/log.json")))
BEAT = T["beat"]
BAR = 4 * BEAT
DUR = V["duration"]
I, ST, HM, Q, TP, CH, RT, GA, PT, RET, CT, SG, VO = (V[k] for k in ["intro", "starts", "home", "quote", "toPhone", "chat", "route", "gallery", "parts", "ret", "cta", "sig", "vo"])
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
CTA_TAP, BUILD, GAMING, GAMES, RES, FPS_, BUDGET, COLOUR, SEND = taps[:9]
print("taps", [round(p, 2) for p, _ in taps])

music, sfx, send = Bus(DUR + 1.5), Bus(DUR + 1.5), Bus(DUR + 1.5)


def kin(level=1.0, f=1800, seed=1):
    """kinetic-type accent: a soft airy tick with a short tonal tail"""
    d = 0.14
    t = np.arange(secs(d)) / SR
    air = bp(noise(d, seed), f * 1.4, f * 5) * np.exp(-t / 0.012)
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.05) * 0.35
    return (air * 0.6 + tone) * level


def word_hit(level=1.0, f=150, seed=3):
    """a heavier word landing (big words): muted body + air"""
    a, b = thock(level, f), kin(level * 0.5, 2400, seed)
    n = max(len(a), len(b))
    return np.pad(a, (0, n - len(a))) + np.pad(b, (0, n - len(b)))


# ------------------------------------------------------------------ music (anchored to the website powering on)
CH_AM = [220.0, 261.63, 329.63, 440.0]
CH_F = [174.61, 261.63, 349.23, 440.0]
CH_C = [196.0, 261.63, 329.63, 392.0]
CH_G = [196.0, 246.94, 293.66, 392.0]
CH_AM9 = [220.0, 261.63, 329.63, 493.88, 659.25]
PROG = [(CH_AM, 55.0), (CH_F, 43.65), (CH_C, 65.41), (CH_G, 49.0)]
A = I["powerOn"][0]


def section(t):
    if t < Q["consolidate"][0]:
        return "light"
    if t < TP["wake"]:
        return "groove"
    if t < CH["done"]:
        return "light"
    if t < GA["start"]:
        return "drive"
    if t < GA["end"]:
        return "rise"
    if t < PT["click"]:
        return "half"
    if t < RET["glow"][0]:
        return "drive"
    return "half"


kicks = []
# the question on black: air and a low pulse that answers QATAR?
music.add(0.05, pan(lp(noise(1.4, 401), 800) * env_bell(1.4, 0.6) * 0.035, 0))
# the brand hold: one open chord under the narrator
pad_in = pad_chord([110.0, 164.81, 220.0, 329.63], A - I["hold"][0] + 0.4, cutoff=900, level=0.4)
music.add(I["hold"][0], pad_in * np.minimum(1, np.linspace(0, 3, len(pad_in)))[:, None])

b = 0
while True:
    t0 = A + b * BAR
    if t0 > SG["fade"][0]:
        break
    sec = section(t0 + 0.01)
    chord, root = PROG[b % 4]
    cut = {"light": 1500, "groove": 1600, "drive": 1700, "rise": 1500, "half": 1250}[sec]
    lvl = {"light": 0.32, "groove": 0.36, "drive": 0.38, "rise": 0.4, "half": 0.36}[sec]
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
            music.add(tb, kick(0.8) if on4 else soft_kick(0.68, cutoff=1300))
            kicks.append(tb)
        if s in ("groove", "drive", "rise"):
            music.add(tb, bass_note(root, BEAT * 0.48, 0.4))
            music.add(tb + BEAT / 2, bass_note(root * 2, BEAT * 0.42, 0.22))
            music.add(tb + BEAT / 2, pan(hat(0.075), 0.25))
        elif q in (0, 2):
            music.add(tb, bass_note(root, BEAT * 1.8, 0.3))
        if s in ("drive", "rise") and q in (1, 3):
            music.add(tb, pan(snap_clap(0.24), -0.05))
        if s == "rise":
            for s16 in (0.25, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.035 + 0.02 * q / 3), -0.3))
        if s == "light":
            for s16 in (0.25, 0.5, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.02), 0.35 if s16 != 0.5 else -0.35))
    if sec in ("light", "half") and b > 0:
        arp = [chord[1] * 2, chord[2] * 2, chord[3] * 2, chord[2] * 2]
        for e in range(8):
            music.add(t0 + e * BEAT / 2, pan(pluck(arp[e % 4], 0.04, 0.35), -0.4 + 0.8 * (e % 2)))
    b += 1
music.add(SG["lock"], pad_chord(CH_AM9, DUR - SG["lock"] + 0.8, cutoff=2600, level=0.58))
music.add(SG["lock"], bass_note(55.0, 0.9, 0.58))

env = np.ones(len(music.buf))
for tb in kicks:
    i, n = secs(tb), secs(0.2)
    if 0 <= i and i + n < len(env):
        env[i : i + n] *= 1 - 0.4 * np.exp(-np.arange(n) / secs(0.06))


def duck(t0, t1, depth, fade=0.06):
    i0, i1, nf = secs(t0), secs(t1), secs(fade)
    env[i0 - nf : i0] *= np.linspace(1, 1 - depth, nf)
    env[i0:i1] *= 1 - depth
    env[i1 : i1 + nf] *= np.linspace(1 - depth, 1, nf)


duck(PT["off"] - 0.12, PT["click"], 0.92)
duck(TP["icon"][0], TP["wake"] + 0.1, 0.3, fade=0.15)
duck(FLY[0], FLY[1], 0.45, fade=0.12)
duck(SG["fade"][0], SG["lock"], 0.8, fade=0.3)
music.buf *= env[:, None]

# ------------------------------------------------------------------ 1. the question → the brand
W = I["words"]
sfx.add(W["qatar"] - 0.02, shimmer(0.4, 0.06, seed=803))  # QATAR lights in DOHA • QATAR
sfx.add(W["build"] - 0.05, whoosh(0.32, 300, 2600, peak=0.6, level=0.07, seed=805))  # BUILD A PC? lands
sfx.add(W["pc"], pan(word_hit(0.22, 170, 806), 0.05))
hi0, hi1 = I["halvesIn"]
sfx.add(hi0 - 0.05, line_zip(hi1 - hi0, 0.09, seed=701, p0=-0.2, p1=-0.75))  # the two halves materialise apart
sfx.add(hi0 - 0.02, line_zip(hi1 - hi0, 0.085, seed=702, p0=0.2, p1=0.75))
m0, m1 = I["merge"]
sfx.add(hi1, pan(hum(m1 - hi1, 52, 78, level=0.07, shape=2.2), 0))  # tension while they close
sfx.add(m0 + 0.2, riser(m1 - m0 - 0.2, 0.07, seed=703))
sfx.add(I["contact"], clash(0.95, seed=61))  # ✦ the clash — on the contact frame
send.add(I["contact"], clash(0.45, seed=62))
sfx.add(I["wm"][0], swish(I["wm"][1] - I["wm"][0] + 0.1, 0.05, 4000, 9000, -0.5, 0.5, seed=704))
sfx.add(I["doha"][0], pan(kin(0.12, 2600, 808), 0))  # DOHA • QATAR
sfx.add(I["hold"][0] + 0.4, pan(hum(I["pressure"][1] - I["hold"][0] - 0.4, 48, 72, level=0.09, shape=1.4), 0))
sfx.add(I["pressure"][0], pan(creak(I["pressure"][1] - I["pressure"][0] + 0.04, 0.11, seed=705), 0))
sfx.add(I["pressure"][0], riser(I["pressure"][1] - I["pressure"][0], 0.14, seed=706))
ex = I["expand"]
sfx.add(ex[0], pan(zap_drop(0.17, 2600, 600, 0.06), 0))
sfx.add(ex[0], whoosh(ex[1] - ex[0], 200, 3800, peak=0.35, level=0.18, pan_from=0, pan_to=-0.7, seed=707))
sfx.add(ex[0] + 0.02, whoosh(ex[1] - ex[0], 220, 3900, peak=0.35, level=0.18, pan_from=0, pan_to=0.7, seed=708))
sfx.add(ex[0] + 0.05, pan(fold(0.55, 0.3), -0.25))
sfx.add(ex[0] + 0.08, pan(fold(0.55, 0.27), 0.25))
sfx.add(I["materialize"][0] + 0.15, pan(thock(0.36, 120), 0))
sfx.add(I["materialize"][1] - 0.04, pan(lock_clack(0.38, pitch=0.85, seed=709), 0))
sfx.add(I["powerOn"][0], pan(panel_on(0.55), 0))
send.add(I["powerOn"][0], pan(panel_on(0.22), 0))
sfx.add(I["powerOn"][0], pan(sub_boom(0.22), 0))
sfx.add(I["pullBack"][0], whoosh(I["pullBack"][1] - I["pullBack"][0], 1800, 260, peak=0.25, level=0.08, seed=710))

# ------------------------------------------------------------------ 2. STARTS WITH YOU + the homepage
sfx.add(ST["words"]["starts"], pan(kin(0.12, 1900, 811), 0))
sfx.add(ST["words"]["you"], pan(kin(0.14, 2400, 812), 0))
sfx.add(HM["cursorIn"][0], swish(0.3, 0.03, 1200, 3000, 0.3, 0.1, seed=721))
sfx.add(HM["hover"], pan(blip(1760, 0.04, 0.07), 0.15))


def click(press, release, p, lvl=0.6):
    sfx.add(press, pan(mouse_click(lvl, seed=int(press * 100)), p))
    sfx.add(release, pan(mouse_click(lvl * 0.8, seed=int(release * 100) + 1, up=True), p))
    sfx.add(press + 0.005, pan(ui_click(0.2, 1.2, seed=int(press * 100) + 2), p))


click(*CTA_TAP, 0.15)
sfx.add(CTA_TAP[1] + 0.06, swish(0.4, 0.06, 600, 3000, 0.2, -0.2, seed=722))
click(*BUILD, -0.1)
sfx.add(Q["scroll1"][0], whoosh(Q["scroll1"][1] - Q["scroll1"][0], 400, 2600, peak=0.4, level=0.08, seed=730))

# ------------------------------------------------------------------ 3. the choices (each with its word)
tl = VO["tell"]["kw"]
click(*GAMING, -0.25)
sfx.add(GAMING[1] + 0.01, swish(0.24, 0.07, 2500, 8000, -0.4, 0.1, seed=731))
sfx.add(tl["play"] - 0.08, pan(kin(0.12, 2000, 813), -0.1))  # WHAT YOU PLAY
click(*GAMES, -0.1, 0.45)
gt0, gt1 = Q["games"]["type"]
for k in range(len(Q["games"]["text"])):  # real keystrokes, quiet
    sfx.add(gt0 + k * (gt1 - gt0) / len(Q["games"]["text"]), pan(tick(3000 + 200 * (k % 3), 0.05, 0.02, seed=840 + k), 0.05))
sfx.add(tl["performance"], pan(kin(0.12, 2200, 814), 0.1))
click(*RES, -0.05)
click(*FPS_, 0.15)
sfx.add(FPS_[1] + 0.06, pan(chime([2637.0, 3520.0], 0.09, 0.05, 0.12), 0.2))
sfx.add(tl["budget"], pan(word_hit(0.2, 160, 815), 0))  # BUDGET
click(*BUDGET, -0.15, 0.45)
bt0, bt1 = Q["budget"]["type"]
for k in range(len(Q["budget"]["text"])):
    sfx.add(bt0 + k * (bt1 - bt0) / len(Q["budget"]["text"]), pan(tick(2800 + 150 * k, 0.06, 0.02, seed=860 + k), -0.1))
sfx.add(Q["colour"]["path"][0] + 0.05, whoosh(0.4, 400, 2400, peak=0.4, level=0.06, seed=735))
sfx.add(tl["style"], pan(kin(0.12, 2500, 816), 0))
click(*COLOUR, -0.05)
sfx.add(COLOUR[1], shimmer(0.6, 0.11, seed=736))
for k in ["gaming", "res", "fps", "colour"]:  # the chosen pill lifts off the glass
    p = {"gaming": GAMING, "res": RES, "fps": FPS_, "colour": COLOUR}[k][1]
    sfx.add(p + 0.2, pan(lock_clack(0.08, pitch=1.6, seed=870 + len(k)), 0))

# ------------------------------------------------------------------ 4. the quotation
qc0, qc1 = Q["consolidate"]
for k in range(4):
    sfx.add(qc0 + 0.08 * k, swish(qc1 - qc0 - 0.15, 0.06, 600, 3800, -0.6 + 0.4 * k, 0.0, seed=740 + k))
    sfx.add(qc1 - 0.14 + 0.06 * k, pan(lock_clack(0.16, pitch=1.2 + 0.08 * k, seed=745 + k), 0))
sfx.add(Q["card"], pan(thock(0.28, 170), 0))
sfx.add(Q["lift"][0], whoosh(0.5, 300, 1600, peak=0.4, level=0.06, seed=748))  # the card floats off the glass
for k, tl_ in enumerate(Q["lines"]):
    sfx.add(tl_, swish(0.12, 0.045, 1200, 5000, -0.2, 0.2, seed=750 + k))
    sfx.add(tl_ + 0.11, pan(lock_clack(0.2, pitch=0.95 + 0.07 * k, seed=755 + k), 0))
sfx.add(Q["price"], pan(thock(0.3, 210), 0))
sfx.add(Q["price"] + 0.12, swish(0.3, 0.06, 3000, 9000, -0.3, 0.3, seed=760))
sfx.add(Q["lift"][1] - 0.5, pan(thock(0.12, 140), 0))  # settles back
sfx.add(Q["scroll3"][0], whoosh(Q["scroll3"][1] - Q["scroll3"][0], 400, 2400, peak=0.4, level=0.06, seed=761))
sfx.add(Q["attach"][0], whoosh(Q["attach"][1] - Q["attach"][0], 2600, 500, peak=0.5, level=0.08, seed=762))  # card → attachment
sfx.add(Q["attach"][1] - 0.04, pan(paper_click(0.24), 0))
click(*SEND, 0.05)

# ------------------------------------------------------------------ 5. monitor → phone
l0, l1 = TP["lift"]
sfx.add(l0, pan(detach(0.38), 0))
sfx.add(l0 + 0.02, shimmer(0.4, 0.09, seed=770))
i0, i1 = TP["icon"]
sfx.add(i0, whoosh(i1 - i0 + 0.05, 300, 3600, peak=0.55, level=0.24, pan_from=-0.1, pan_to=0.6, seed=771))
sfx.add(i0, pan(sweep(520, 1040, i1 - i0) * env_bell(i1 - i0, 0.6) * 0.03, np.linspace(-0.1, 0.6, secs(i1 - i0))))
sfx.add(TP["camera"][0], whoosh(TP["camera"][1] - TP["camera"][0], 160, 900, peak=0.5, level=0.09, seed=772))
sfx.add(TP["wake"], pan(land(0.58), 0.4))
sfx.add(TP["wake"] + 0.04, pan(power_on(0.2, seed=773), 0.35))
send.add(TP["wake"], pan(glass_tap(0.28), 0.4))
sfx.add(TP["wake"] + 0.08, pan(chime([1568.0, 2093.0], 0.07, 0.04, 0.2), 0.4))
sfx.add(CH["front"][0], whoosh(CH["front"][1] - CH["front"][0], 900, 250, peak=0.4, level=0.05, seed=774))  # the phone turns to us

# ------------------------------------------------------------------ 6. WhatsApp
P = 0.2
sfx.add(CH["attach"], pan(paper_click(0.22), P))
sfx.add(CH["attach"] + 0.02, pan(tick_in(0.26), P))
sfx.add(CH["proceed"], pan(pop_out(0.36), P + 0.1))
for d in range(3):
    sfx.add(CH["typing"] + 0.04 + 0.1 * d, pan(blip(880 * (1.26**d), 0.04, 0.04), P - 0.2))
if CH["reply"] - CH["typing"] > 0.2:
    sfx.add(CH["typing"] + 0.08, pan(typing(CH["reply"] - CH["typing"] - 0.1, 0.07), P - 0.2))
sfx.add(CH["reply"], pan(tick_in(0.3), P - 0.2))
for k in range(3):
    sfx.add(CH["tokens"][k], pan(tick(2600 + 300 * k, 0.09, 0.02, seed=781 + k), P - 0.3 + 0.2 * k))
    sfx.add(CH["checks"][k], pan(chime([1568.0 * (1.12**k)], 0.12, 0.0, 0.12), P - 0.3 + 0.2 * k))
sfx.add(CH["collapse"][0], swish(0.18, 0.06, 2000, 6000, 0.5, 0.1, seed=785))
sfx.add(CH["collapse"][1], pan(chime([1318.5, 1975.5], 0.22, 0.08, 0.3), P - 0.2))
send.add(CH["collapse"][1], pan(chime([1318.5, 1975.5], 0.09, 0.08, 0.3), P - 0.2))
sfx.add(CH["order"], pan(tick_in(0.32), P - 0.2))
sfx.add(CH["order"] + 0.14, pan(thock(0.2, 240), P - 0.2))
sfx.add(CH["paid"], pan(pop_out(0.34), P + 0.1))
sfx.add(CH["paid"] + 0.05, swish(0.24, 0.06, 1500, 6000, 0.6, 0.3, seed=786))
sfx.add(CH["paid"] + 0.28, pan(paper_click(0.22), P + 0.1))
sfx.add(CH["done"], pan(tick_in(0.3), P - 0.2))
oc = CH["orderText"][0]
sfx.add(oc, pan(word_hit(0.4, 140, 787), 0))  # ORDER
sfx.add(oc + 0.22, pan(word_hit(0.48, 120, 788), 0))  # CONFIRMED.
sfx.add(CH["payoff"][0], pan(kick(0.38), 0))
sfx.add(CH["payoff"][0], pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.3, 0.05, 0.5), 0.1))
send.add(CH["payoff"][0], pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.14, 0.05, 0.5), 0.1))
sfx.add(CH["push"] - 0.45, riser(0.5, 0.12, seed=789))

# ------------------------------------------------------------------ 7. route
RW = RT["words"]
sfx.add(CH["push"], whoosh(0.6, 500, 5000, peak=0.8, level=0.2, pan_from=0.2, pan_to=-0.2, seed=790))
sfx.add(RT["stroke"][0] + 0.3, swish(0.45, 0.1, 1500, 7000, -0.6, 0.2, seed=791))
sfx.add(RW["sourced"], pan(word_hit(0.26, 160, 792), -0.2))
sfx.add(RW["directly"], pan(kin(0.1, 2000, 793), -0.2))
sfx.add(RW["us"], pan(word_hit(0.3, 150, 794), -0.2))
sfx.add(RW["us"] + 0.42, swish(0.5, 0.08, 4000, 1500, -0.3, -0.5, seed=795))  # U.S. drops to the origin
sfx.add(RW["us"] + 0.95, pan(ping(1318.5, 0.1), -0.6))
sfx.add(RT["parcel"], shimmer(0.4, 0.08, seed=796))
tv = RT["travel"][1] - RT["travel"][0]
sfx.add(RT["travel"][0], whoosh(tv + 0.1, 250, 3000, peak=0.65, level=0.09, pan_from=-0.7, pan_to=0.7, seed=797))
sfx.add(RT["travel"][0], pan(sweep(220, 440, tv) * env_bell(tv, 0.7) * 0.04, np.linspace(-0.6, 0.6, secs(tv))))
u = np.linspace(0, 1, 2001)
e = np.where(u < 0.5, 4 * u**3, 1 - (-2 * u + 2) ** 3 / 2)
for k, mu in enumerate([0.2, 0.36, 0.52, 0.68, 0.84]):
    tm = RT["travel"][0] + tv * u[np.argmin(np.abs(e - mu))]
    sfx.add(tm, pan(tick(3400 + 150 * k, 0.07, 0.02, seed=798 + k), -0.6 + 0.3 * k))
sfx.add(RT["travel"][1] - 0.6, riser(0.62, 0.12, seed=803))
sfx.add(RT["arrive"], pan(kick(0.56), 0.4))
sfx.add(RT["arrive"], pan(sub_boom(0.34), 0.3))  # QATAR
sfx.add(RT["arrive"], pan(ping(1760, 0.13), 0.45))
send.add(RT["arrive"], pan(ping(1760, 0.1), 0.45))
sfx.add(RT["fan"][0], riser(RT["fan"][1] - RT["fan"][0] + 0.05, 0.18, seed=804))
sfx.add(RT["fan"][1] - 0.2, whoosh(0.4, 200, 4000, peak=0.5, level=0.2, seed=805))

# ------------------------------------------------------------------ 8. the 13 builds (pass-bys from the gallery camera)
gsrc = open(os.path.join(ROOT, "src/v8/Gallery8.tsx")).read()
g0, ge = GA["start"], GA["end"]
builds = [(int(m.group(1)), float(m.group(2)), float(m.group(3)), bool(m.group(4))) for m in re.finditer(r"\{ n: (\d+), src: \"[^\"]+\", w: \d+, h: \d+, bb: \[[^\]]+\], x: (-?\d+), z: (\d+)(, hero: true)?", gsrc)]
assert len(builds) == 13, len(builds)
EI, EO = float(re.search(r"EASE_IN = ([\d.]+)", gsrc).group(1)), float(re.search(r"EASE_OUT = ([\d.]+)", gsrc).group(1))
Z1 = 12000 - 1060


def gal_progress(u):  # == galProgress() in Gallery8.tsx
    x = np.clip(u, 0, 1)
    ramp = lambda s: s / 2 - np.sin(np.pi * s) / (2 * np.pi)
    tot = EI / 2 + (1 - EI - EO) + EO / 2
    return np.where(x < EI, EI * ramp(x / EI), np.where(x <= 1 - EO, EI / 2 + (x - EI), EI / 2 + (1 - EI - EO) + EO * (0.5 - ramp(1 - (x - (1 - EO)) / EO)))) / tot


tt = np.linspace(g0, ge, 4000)
cz = Z1 * gal_progress((tt - g0) / (ge - g0))
sm5 = lambda x: x * x * x * (x * (6 * x - 15) + 10)
Pp = gal_progress((tt - g0) / (ge - g0))
cx = 170 * np.sin(2 * np.pi * (1.15 * Pp + 0.08)) * (1 - sm5(np.clip((Pp - 0.68) / 0.32, 0, 1))) - 20 * (1 - Pp)
sfx.add(g0, pan(sub_boom(0.26), 0))
sfx.add(g0, shimmer(0.7, 0.1, seed=810))  # RGB swell — the fan
for n, bx, bz, hero in builds:
    if n in (2, 13):
        continue
    idx = np.argmax(cz >= bz - 650)  # the build passes the lens
    if cz[idx] < bz - 650:
        continue
    tp = tt[idx]
    side = np.sign(bx - cx[idx]) or 1
    near = abs(bx - cx[idx]) < 300
    sfx.add(tp - 0.2, whoosh(0.46, 260 if near else 400, 3400, peak=0.55, level=0.12 if near else 0.075, pan_from=side * 0.25, pan_to=side * (0.6 if near else 0.95), seed=820 + n))
    if hero:  # the big readable passes get a soft shimmer as they fill the frame
        j = np.argmax(cz >= bz - 1700)
        sfx.add(tt[j], shimmer(0.4, 0.05, seed=840 + n))
sfx.add(GA["real"], pan(word_hit(0.3, 150, 850), 0))
sfx.add(GA["builds"], pan(word_hit(0.3, 130, 851), 0))
sfx.add(ge - 0.6, whoosh(0.8, 2400, 300, peak=0.3, level=0.1, seed=852))  # the others sink into darkness
sfx.add(ge, pan(thock(0.24, 110), 0))

# ------------------------------------------------------------------ 9. hero → BUILT / SET UP / READY
sfx.add(PT["closer"][0], whoosh(0.45, 300, 1800, peak=0.5, level=0.06, seed=860))
PANS = [-0.5, 0.5, 0.5, -0.5, -0.5]
for k, tl_ in enumerate(PT["labels"]):
    sfx.add(tl_, pan(blip(1046.5 * (1.12**k), 0.06, 0.06), PANS[k]))
for k, ts in enumerate(PT["snaps"]):
    sfx.add(ts, pan(lock_clack(0.28 + 0.05 * k, pitch=1.15 - 0.06 * k, seed=830 + k), [-0.4, 0.4, 0.4, -0.4, -0.3][k]))
sfx.add(PT["built"], pan(word_hit(0.4, 150, 861), 0))
sfx.add(PT["setup"], pan(word_hit(0.42, 180, 862), 0))
for k, tc in enumerate(PT["setupChips"]):
    sfx.add(tc, pan(tick(2200 + 300 * k, 0.07, 0.02, seed=863 + k), 0.4))
sfx.add(PT["off"], pan(power_down(0.26), 0))
sfx.add(PT["click"], pan(ui_click(0.9, 0.85, seed=840), 0))
sfx.add(PT["click"], pan(kick(0.75), 0))
sfx.add(PT["click"], pan(power_on(0.52, seed=841), 0))
send.add(PT["click"], pan(power_on(0.24, seed=842), 0))
sfx.add(PT["ready"], pan(word_hit(0.5, 210, 866), 0))
sfx.add(PT["ready"], shimmer(0.5, 0.13, seed=843))

# ------------------------------------------------------------------ 10. back to the workstation → into the monitor
sfx.add(RET["glow"][0], shimmer(0.6, 0.07, seed=850))
sfx.add(RET["pull"][0], whoosh(RET["pull"][1] - RET["pull"][0], 2400, 260, peak=0.3, level=0.1, seed=851))
sfx.add(RET["pull"][1] - 0.05, pan(thock(0.14, 110), 0))
sfx.add(RET["approach"][0], whoosh(RET["approach"][1] - RET["approach"][0], 200, 1200, peak=0.7, level=0.07, seed=852))
sfx.add(FLY[0] - 0.3, riser(0.4, 0.1, seed=853))
sfx.add(FLY[0], whoosh(FLY[1] - FLY[0] + 0.12, 200, 5200, peak=0.8, level=0.26, seed=854))
sfx.add(FLY[1] - 0.02, pan(whump(0.28), 0))
send.add(FLY[1], pan(whump(0.13), 0))

# ------------------------------------------------------------------ 11. READY / TO BUILD / YOURS? — monepcs.qa
CW = CT["words"]
sfx.add(CW["ready"], pan(word_hit(0.3, 160, 870), -0.1))
sfx.add(CW["to"], pan(kin(0.1, 2000, 871), -0.1))
sfx.add(CW["yours"], pan(word_hit(0.36, 200, 872), -0.1))
sfx.add(CW["yours"] + 0.05, shimmer(0.4, 0.07, seed=873))
sfx.add(CT["hover"] - 0.5, swish(0.4, 0.02, 1200, 3000, 0.2, 0.0, seed=855))
sfx.add(CT["hover"], pan(blip(1760, 0.045, 0.08), 0.05))
sfx.add(CT["url"], pan(word_hit(0.3, 180, 874), 0))
sfx.add(CT["url"] + 0.25, swish(0.4, 0.06, 3000, 9000, -0.3, 0.3, seed=875))

# ------------------------------------------------------------------ ✦ the M1 signature
sfx.add(SG["fade"][0], whoosh(0.4, 2000, 200, peak=0.3, level=0.09, seed=880))
sfx.add(SG["split"], pan(zap_drop(0.2, 3600, 900, 0.08), 0))
sfx.add(SG["fly"][0], whoosh(0.3, 600, 5000, peak=0.5, level=0.14, pan_from=0, pan_to=-0.8, seed=881))
sfx.add(SG["fly"][0], whoosh(0.3, 650, 5200, peak=0.5, level=0.14, pan_from=0, pan_to=0.8, seed=882))
sfx.add(SG["fly"][0] + 0.24, pan(fold(0.34, 0.26), -0.3))
sfx.add(SG["fly"][0] + 0.26, pan(fold(0.34, 0.26), 0.3))
sfx.add(SG["yellow"][0], swish(SG["yellow"][1] - SG["yellow"][0], 0.045, 5000, 11000, -0.7, 0.2, seed=883))
sm0, sm1 = SG["merge"]
sfx.add(SG["fly"][1], pan(hum(sm1 - SG["fly"][1], 60, 90, level=0.08, shape=2.2), 0))  # the halves hang, then close
sfx.add(sm0 + 0.2, riser(sm1 - sm0 - 0.2, 0.08, seed=884))
sfx.add(SG["lock"], clash(1.0, seed=71, refined=True))  # ✦ the final clash — on the contact frame
sfx.add(SG["lock"], pan(sub_boom(0.3), 0))
send.add(SG["lock"], clash(0.5, seed=72, refined=True))
sfx.add(SG["wordmark"][0], shimmer(0.5, 0.16, seed=886))
sfx.add(SG["wordmark"][0], pan(chime([2637.0, 3135.96, 3951.07], 0.06, 0.05, 0.4), 0))
send.add(SG["wordmark"][0], shimmer(0.5, 0.1, seed=887))
sfx.add(SG["sweep"][0], swish(0.34, 0.05, 4000, 10000, -0.5, 0.5, seed=888))
sfx.add(SG["doha"], pan(kin(0.12, 2600, 889), 0))
sfx.add(SG["url"], pan(kin(0.1, 2200, 890), 0))

# ------------------------------------------------------------------ mixes
# the chat is busy while the narrator explains pricing / deposit: its UI sounds step back under that line
fxenv = np.ones(len(sfx.buf))
c0_, c1_ = secs(VO["confirm"]["start"] - 0.1), secs(VO["confirm"]["end"])
nf = secs(0.15)
fxenv[c0_ - nf : c0_] = np.linspace(1, db(-6), nf)
fxenv[c0_:c1_] = db(-6)
fxenv[c1_ : c1_ + nf] = np.linspace(db(-6), 1, nf)
wet = apply_reverb(send.buf, reverb_ir(1.8, 0.45), wet=1.0) * 0.4
N = secs(round(DUR * 60) / 60 + 0.03)  # a hair longer than the picture so -shortest keeps the last frame
music_b = music.buf[:N] * db(-4)
fx = (sfx.buf + wet)[:N]

vo, vsr = sf.read(os.path.join(ROOT, "public/audio/vo8.wav"))
vo = vo[:N] if vo.ndim == 1 else vo[:N].mean(axis=1)
vo = np.pad(vo, (0, max(0, N - len(vo))))
vo = hp(vo, 70)
# side-chain: a smooth envelope of the voice (attack 40 ms, release 320 ms) → −8 dB on music, −2.5 dB on SFX
lev = np.abs(vo)
blk = secs(0.01)
nb = len(lev) // blk + 1
pk = np.array([lev[i * blk : (i + 1) * blk].max() if i * blk < len(lev) else 0 for i in range(nb)])
gate = np.clip((20 * np.log10(pk + 1e-9) + 42) / 12, 0, 1)
sm = np.zeros_like(gate)
for i in range(1, len(gate)):
    a = 0.22 if gate[i] > sm[i - 1] else 0.03
    sm[i] = sm[i - 1] + a * (gate[i] - sm[i - 1])
side = np.repeat(sm, blk)[:N]
music_vo = music_b * (1 - (1 - db(-10)) * side)[:, None]
# the moments where the SFX may step forward (no narration on top, or only its onset)
lift = np.zeros(N)
for t0_, t1_, amt in [(I["contact"] - 0.05, I["contact"] + 0.7, 1.0), (CH["orderText"][0] - 0.05, CH["payoff"][1] + 0.3, 1.0),
                      (RT["arrive"] - 0.03, RT["arrive"] + 0.25, 0.6), (PT["click"] - 0.05, PT["click"] + 0.9, 1.0), (SG["lock"] - 0.05, SG["lock"] + 0.9, 1.0)]:
    i0_, i1_, f_ = secs(t0_), secs(t1_), secs(0.08)
    w_ = np.zeros(N)
    w_[i0_:i1_] = amt
    w_[i1_ : i1_ + f_] = np.linspace(amt, 0, len(w_[i1_ : i1_ + f_]))
    lift = np.maximum(lift, w_)
lift *= 1 - side  # never while the narrator is talking — the moments step forward only into the gaps
# SFX: −6 dB under the voice (the chat's UI a further −6 dB under the pricing line); at the five key moments the
# duck is released and the SFX step forward +2.5 dB
fx_vo = fx * ((1 - (1 - db(-6)) * side * (1 - lift)) * fxenv[:N] * (1 + (db(2.5) - 1) * lift))[:, None]
voice = pan(vo, 0) * db(7)


def finish(stereo, dest):
    out = master(stereo, -1.0)
    fade = np.ones(len(out))
    fade[: secs(0.004)] = np.linspace(0, 1, secs(0.004))
    fade[-secs(0.4) :] = np.linspace(1, 0, secs(0.4)) ** 1.5
    out = out * fade[:, None]
    write_wav(dest, out)

    def measure(path):
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
        lines = [l.strip() for l in r.splitlines()]
        return float([l for l in lines if l.startswith("I:")][-1].split()[1]), float([l for l in lines if l.startswith("Peak:")][-1].split()[1])

    def tp_limit(x, ceil):
        """look-ahead true-peak limiter: 4× oversampled peak detection, 1.5 ms look-ahead (instant attack),
        60 ms release — gain only ever moves smoothly, no clipping"""
        up = np.abs(resample_poly(x, 4, 1, axis=0)).max(axis=1)
        pk = up.reshape(-1, 4).max(axis=1)[: len(x)]
        pk = np.pad(pk, (0, len(x) - len(pk)), constant_values=0)
        g = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
        la = secs(0.0015)
        gmin = np.minimum.reduce([np.roll(g, -k) for k in range(la + 1)])
        rel = np.exp(-1 / secs(0.06))
        out_g = np.empty_like(gmin)
        cur = 1.0
        for i in range(len(gmin)):
            cur = gmin[i] if gmin[i] < cur else gmin[i] + (cur - gmin[i]) * rel
            out_g[i] = cur
        # smooth the attack over the look-ahead window as well
        k = np.hanning(2 * la + 1)
        k /= k.sum()
        sm_g = np.minimum(out_g, np.convolve(out_g, k, mode="same"))
        return x * sm_g[:, None]

    ceil = db(-2.6)
    for it in range(8):
        lufs, peak = measure(dest)
        if abs(lufs + 14) < 0.1 and peak <= -2.0:
            break
        out = tp_limit(out * db(-14 - lufs), ceil)
        write_wav(dest, out)
    lufs, peak = measure(dest)
    print(f"{os.path.basename(dest)}: {lufs:.1f} LUFS, true peak {peak:.1f} dBTP")


A_DIR = os.path.join(ROOT, "public/audio")
finish(voice + music_vo + fx_vo, os.path.join(A_DIR, "final8_vo.wav"))
finish(music_vo + fx_vo, os.path.join(A_DIR, "final8_bed_vo.wav"))
finish(music_b * db(1.5) + fx * (db(1.0) * (1 + (db(1.5) - 1) * lift))[:, None], os.path.join(A_DIR, "final8_novo.wav"))
