"""Full score + SFX for the final ad (~20.9 s, 116 BPM, A minor).

Every SFX time comes from the same sources the picture uses: the real capture
log (pointer contact / press / release frames) and the cue table in
timeline.json — so sound and picture can't drift. Original synthesis only (no
samples, no WhatsApp audio).

Music: intro ramp (logo) -> groove (homepage + requirements) -> lighter, airy
bars under the chat so each message sound reads -> full drive (sourcing +
builds) -> rising parts section -> a short breakdown for READY FOR YOU -> the
site's CTA and one final hit on the end card.
"""
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
T = json.load(open(os.path.join(ROOT, "timeline.json")))
LOG = json.load(open(os.path.join(ROOT, "public/cap/journey/log.json")))
CU = T["final"]["cues"]
V5 = T["v5"]
L5, HV = V5["logo"], V5["home"]
BEAT = T["beat"]
BAR = 4 * BEAT
DOWN = T["downbeat"]  # 1.10
DUR = CU["cta"]["duration"]
J0 = HV["captureStart"]
jt = lambda i: J0 + i / 60

# ------------------------------------------------------------------ events from the real capture
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
# contact = the frame the fingertip lands (pointer arrives over the element)
contacts = [c for c in contacts if c > 1.5]
# the homepage fingertip is composited to land at timeline v5.home.contact (hover begins under it)
contacts[0] = T["v5"]["home"]["contact"]
print("taps", [(round(p, 3), round(r, 3)) for p, r in taps])
print("contacts", [round(c, 3) for c in contacts])
CTA_TAP, BUILD, GAMING, RES, FPS_, COLOUR, SEND = taps
REL = CTA_TAP[1]
PASS = HV["pass"]
CH = CU["chat"]
RT = CU["route"]
PT = CU["parts"]
BU = CU["built"]
CT = CU["cta"]

music, sfx, send = Bus(DUR + 1.0), Bus(DUR + 1.0), Bus(DUR + 1.0)


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


# ------------------------------------------------------------------ music
A2, C3, E3, F2, G2 = 110.0, 130.81, 164.81, 87.31, 98.0
CH_AM = [220.0, 261.63, 329.63, 440.0]
CH_F = [174.61, 261.63, 349.23, 440.0]
CH_C = [196.0, 261.63, 329.63, 392.0]
CH_G = [196.0, 246.94, 293.66, 392.0]
CH_AM9 = [220.0, 261.63, 329.63, 493.88, 659.25]
bars = [DOWN + k * BAR for k in range(10)]  # 1.10 ... 19.72
prog = [(CH_AM, 55.0), (CH_F, 43.65), (CH_C, 65.41), (CH_G, 49.0), (CH_AM, 55.0), (CH_F, 43.65), (CH_C, 65.41), (CH_G, 49.0), (CH_AM, 55.0), (CH_F, 43.65)]

# intro: one continuous ramp under the logo (no jump into the groove)
pad_in = pad_chord([110.0, 164.81, 220.0, 329.63], DOWN + 0.3, cutoff=900, level=0.5)
music.add(0.0, pad_in * (np.linspace(0, 1, len(pad_in)) ** 0.8)[:, None])
for k, tb in enumerate([DOWN - 2 * BEAT, DOWN - BEAT]):
    grow = 0.35 + 0.32 * k
    music.add(tb, soft_kick(0.85 * grow, cutoff=500 + 1400 * grow))

kicks = []
for b, (chord, root) in enumerate(prog):
    t0 = bars[b]
    section = "groove" if b < 2 else "chat" if b < 4 else "drive" if b < 6 else "rise" if b < 8 else "break"
    cutoff = {"groove": 1500, "chat": 1900, "drive": 1700, "rise": 1300 + 0, "break": 1200}[section]
    padlvl = {"groove": 0.42, "chat": 0.36, "drive": 0.4, "rise": 0.42, "break": 0.5}[section]
    if b < 9:
        music.add(t0, pad_chord(chord, BAR + 0.35, cutoff=cutoff, level=padlvl))
    for q in range(4):
        tb = t0 + q * BEAT
        if tb > DUR:
            break
        if section in ("groove", "drive", "rise"):
            music.add(tb, kick(0.9 if section != "groove" else 0.82))
            kicks.append(tb)
        elif section == "chat" and q in (0, 2):
            music.add(tb, soft_kick(0.75, cutoff=1300))
            kicks.append(tb)
        elif section == "break" and q == 0 and b == 8:
            music.add(tb, soft_kick(0.7, cutoff=900))
            kicks.append(tb)
        # bass
        if section == "groove":
            music.add(tb, bass_note(root, BEAT * 0.95, 0.45))
        elif section == "chat" and q in (0, 2):
            music.add(tb, bass_note(root, BEAT * 1.9, 0.36))
        elif section in ("drive", "rise"):
            music.add(tb, bass_note(root, BEAT * 0.48, 0.42))
            music.add(tb + BEAT / 2, bass_note(root * 2, BEAT * 0.45, 0.3))
        # hats / claps
        if section in ("groove", "drive", "rise"):
            music.add(tb + BEAT / 2, pan(hat(0.09), 0.25))
        if section in ("drive", "rise") and q in (1, 3):
            music.add(tb, pan(snap_clap(0.32), -0.05))
        if section == "rise":
            for s16 in (0.25, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.035 + 0.03 * (b - 6) + 0.02 * q / 3), -0.3))
        if section == "chat":
            for s16 in (0.25, 0.5, 0.75):
                music.add(tb + BEAT * s16, pan(hat(0.03), 0.35 if s16 != 0.5 else -0.35))
    # chat bars: a quiet pluck arpeggio, airy and out of the way of message sounds
    if section == "chat":
        arp = [chord[1] * 2, chord[2] * 2, chord[3] * 2, chord[2] * 2]
        for e in range(8):
            music.add(t0 + e * BEAT / 2, pan(pluck(arp[e % 4], 0.07, 0.35), -0.4 + 0.8 * (e % 2)))

# CTA: half-time pulse back in, then the end-card hit
music.add(CT["cta0"] - 0.03, soft_kick(0.8, cutoff=1200))
kicks.append(CT["cta0"] - 0.03)
music.add(bars[9], soft_kick(0.75, cutoff=1300))
kicks.append(bars[9])
music.add(bars[9], pad_chord(CH_F, 0.6, cutoff=1300, level=0.4))
FINAL = bars[9] + BEAT  # 20.24 — the end card lands on the beat
music.add(FINAL, pad_chord(CH_AM9, DUR - FINAL + 0.6, cutoff=2400, level=0.55))
music.add(FINAL, bass_note(55.0, 0.66, 0.55))

# sidechain the bed under every kick
env = np.ones(len(music.buf))
for tb in kicks:
    i, n = secs(tb), secs(0.2)
    if 0 <= i and i + n < len(env):
        env[i : i + n] *= 1 - 0.42 * np.exp(-np.arange(n) / secs(0.06))
music.buf *= env[:, None]

# ------------------------------------------------------------------ shot 1: logo (as approved in v5)
sfx.add(0.0, whoosh(L5["lock"] + 0.02, 500, 5200, peak=0.85, level=0.22, pan_from=-0.85, pan_to=-0.05, seed=101))
sfx.add(0.0, whoosh(L5["lock"] + 0.02, 520, 5400, peak=0.85, level=0.22, pan_from=0.85, pan_to=0.05, seed=102))
sfx.add(L5["lock"], pan(lock_clack(0.8), 0))
send.add(L5["lock"], pan(lock_clack(0.35), 0))
sfx.add(L5["lock"] + 0.005, pan(tick(6200, 0.12, 0.03, seed=103), 0))
sfx.add(L5["wordmark"][0], shimmer(0.34, 0.16))
sfx.add(0.42, riser(L5["passEnd"] - 0.42, 0.26))
sfx.add(L5["passEnd"] - 0.2, whoosh(0.42, 180, 3200, peak=0.5, level=0.34, pan_from=-0.3, pan_to=0.3, seed=104))
sfx.add(DOWN, pan(whump(0.42), 0))
send.add(DOWN, pan(whump(0.2), 0))

# ------------------------------------------------------------------ shot 2: homepage
sfx.add(HV["scrollStart"], whoosh(HV["scrollEnd"] - HV["scrollStart"], 300, 1800, peak=0.3, level=0.07, seed=105))
sfx.add(contacts[0], pan(glass_tap(0.55), 0.25))
sfx.add(CTA_TAP[0], pan(ui_click(0.7, 1.0, seed=106), 0.2))
sfx.add(REL, pan(ui_click(0.38, 1.4, seed=107), 0.2))
send.add(CTA_TAP[0], pan(ui_click(0.25), 0.2))

# ------------------------------------------------------------------ shot 3: pill -> emblem -> through the V
sfx.add(REL + 0.005, pan(fold(0.4, 0.5), 0.1))
send.add(REL + 0.005, pan(fold(0.4, 0.25), 0.1))
sfx.add(REL + 0.17, pan(lock_clack(0.45, pitch=0.8, seed=73), 0))  # the emblem forms
sfx.add(REL + 0.05, riser(PASS - REL - 0.05, 0.2, seed=113))
sfx.add(PASS - 0.24, whoosh(0.36, 200, 5200, peak=0.62, level=0.36, pan_from=0.25, pan_to=-0.1, seed=108))
sfx.add(PASS, pan(kick(0.75), 0))
sfx.add(PASS, pan(sub_boom(0.36), 0))
send.add(PASS, whoosh(0.5, 6000, 500, peak=0.15, level=0.16, seed=110))

# ------------------------------------------------------------------ shot 4: the requirements (each tap its own colour)
def tap_set(contact, press, release, p, tone):
    sfx.add(contact, pan(glass_tap(0.42), p))
    sfx.add(press, pan(ui_click(0.55, tone, seed=int(press * 100)), p))
    sfx.add(release, pan(ui_click(0.26, tone * 1.3, seed=int(release * 100)), p))


tap_set(contacts[1], BUILD[0], BUILD[1], -0.15, 1.0)
tap_set(contacts[2], GAMING[0], GAMING[1], -0.3, 1.05)
tap_set(contacts[3], RES[0], RES[1], -0.1, 1.12)
tap_set(contacts[4], FPS_[0], FPS_[1], 0.15, 1.2)
tap_set(contacts[5], COLOUR[0], COLOUR[1], -0.1, 1.28)
# YOUR PC. / YOUR WAY.
sfx.add(BUILD[1] + 0.03, pan(thock(0.5, 170), -0.1))
sfx.add(BUILD[1] + 0.11, pan(thock(0.5, 200), 0.1))
# flicks
sfx.add(3.14, whoosh(0.5, 400, 3000, peak=0.35, level=0.14, pan_from=0, pan_to=0, seed=121))
sfx.add(4.48, whoosh(0.48, 420, 3200, peak=0.35, level=0.12, seed=122))
sfx.add(5.34, whoosh(0.74, 300, 2200, peak=0.3, level=0.08, seed=123))
# micro-motions
sfx.add(GAMING[1], pan(zap_drop(0.18, 900, 2600, 0.07), -0.3))  # magnetic snap
sfx.add(RES[1] - 0.02, swish(0.22, 0.12, 2500, 7000, -0.4, 0.2, seed=124))  # underline travel
sfx.add(FPS_[1] + 0.06, pan(chime([2637.0, 3520.0], 0.12, 0.05, 0.12), 0.2))  # confirm tick
sfx.add(COLOUR[1], shimmer(0.42, 0.14, seed=125))  # glow
# the request assembling: four pills land, each a little higher
for k, (st, f) in enumerate([(5.24, 1.0), (5.29, 1.06), (5.34, 1.12), (5.40, 1.19)]):
    sfx.add(st, swish(0.36, 0.08, 600, 3800, -0.5 + 0.33 * k, 0.1, seed=130 + k))
    sfx.add(st + 0.42, pan(lock_clack(0.22, pitch=f * 1.25, seed=140 + k), 0.2))
sfx.add(5.36, pan(chime([880.0, 1318.5], 0.05, 0.09, 0.3), 0))
# Send
tap_set(contacts[6], SEND[0], SEND[1], 0.1, 0.95)
send.add(SEND[0], pan(ui_click(0.25), 0.1))

# ------------------------------------------------------------------ shot 5: WhatsApp
SR_ = SEND[1]
sfx.add(SR_ + 0.02, whoosh(0.42, 500, 5000, peak=0.6, level=0.24, pan_from=0.5, pan_to=-0.5, seed=150))  # icon rises
sfx.add(SR_ + 0.4, pan(pop_out(0.42), 0.3))  # request sent
sfx.add(SR_ + 0.5, pan(tick(4200, 0.12, 0.02, seed=151), 0.35))  # read ticks
sfx.add(CH["quote"], pan(tick_in(0.42), -0.3))
for k in range(4):
    sfx.add(CH["quote"] + 0.14 + 0.06 * k, pan(tick(3600 + 200 * k, 0.07, 0.015, seed=152 + k), -0.3))
sfx.add(CH["proceed"], pan(pop_out(0.42), 0.3))
sfx.add(CH["proceed"] + 0.25, pan(tick(4200, 0.1, 0.02, seed=156), 0.35))
sfx.add(CH["confirm"], pan(typing(0.24, 0.16), -0.3))
sfx.add(CH["confirm"] + 0.22, pan(tick_in(0.3), -0.3))
sfx.add(CH["confirm"] + 0.26, pan(typing(0.28, 0.07, seed=96), -0.3))  # checking
sfx.add(CH["confirm"] + 0.56, pan(chime([1318.5, 1975.5], 0.3, 0.08, 0.3), -0.2))  # confirmed
send.add(CH["confirm"] + 0.56, pan(chime([1318.5, 1975.5], 0.12, 0.08, 0.3), -0.2))
sfx.add(CH["order"], pan(tick_in(0.4), -0.3))
sfx.add(CH["order"] + 0.12, pan(thock(0.22, 240), -0.3))
sfx.add(CH["paid"], pan(pop_out(0.4), 0.3))
sfx.add(CH["paid"] + 0.03, pan(paper_click(0.28), 0.35))
sfx.add(CH["done"], pan(tick_in(0.35), -0.2))
sfx.add(CH["done"] + 0.1, pan(kick(0.35), 0))
sfx.add(CH["done"] + 0.1, pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.34, 0.045, 0.45), 0))  # order confirmed
send.add(CH["done"] + 0.1, pan(chime([1046.5, 1318.5, 1568.0, 2093.0], 0.16, 0.045, 0.45), 0))
sfx.add(CH["done"] + 0.05, riser(CH["end"] - CH["done"] + 0.3, 0.14, seed=160))  # travel begins under it

# ------------------------------------------------------------------ shot 6: sourcing
sfx.add(CH["end"] - 0.02, whoosh(0.38, 900, 6000, peak=0.5, level=0.22, pan_from=0.3, pan_to=-0.6, seed=161))
sfx.add(CH["end"] + 0.34, pan(tick(2400, 0.3, 0.04, seed=162), -0.6))  # U.S. node
sfx.add(10.28, pan(thock(0.45, 160), -0.15))
sfx.add(10.36, pan(thock(0.45, 190), 0.15))
travel = RT["arrive"] - RT["draw"]
sfx.add(RT["draw"], whoosh(travel + 0.1, 250, 3600, peak=0.7, level=0.24, pan_from=-0.7, pan_to=0.7, seed=163))
sfx.add(RT["draw"], pan(sweep(220, 440, travel) * env_bell(travel, 0.7) * 0.05, np.linspace(-0.6, 0.6, secs(travel))))
sfx.add(RT["arrive"], pan(kick(0.5), 0.5))
sfx.add(RT["arrive"], pan(ping(1760, 0.16), 0.55))
send.add(RT["arrive"], pan(ping(1760, 0.12), 0.55))
sfx.add(RT["out"] - 0.1, riser(CU["builds"]["b0"] + 0.4 - RT["out"], 0.2, seed=164))

# ------------------------------------------------------------------ shot 7: real builds
B0 = CU["builds"]["b0"]
sfx.add(11.97, pan(sub_boom(0.4), 0))  # the field opens on the beat
sfx.add(11.97, shimmer(0.6, 0.16, seed=165))
send.add(11.97, shimmer(0.6, 0.12, seed=166))
sfx.add(12.48, pan(thock(0.5, 150), 0))  # REAL BUILDS.
for tp, p0, p1, lv, sd in [(12.36, 0.5, 1.0, 0.32, 167), (12.66, -0.4, -1.0, 0.22, 168), (12.98, 0.5, 1.0, 0.2, 169), (13.32, -0.5, -1.0, 0.2, 170)]:
    sfx.add(tp, whoosh(0.36, 300, 4200, peak=0.55, level=lv, pan_from=p0 * 0.4, pan_to=p1, seed=sd))
sfx.add(13.55, shimmer(0.7, 0.14, seed=171))  # RGB as the flagship comes forward
sfx.add(13.55, pan(chime([440.0, 659.25, 880.0], 0.05, 0.1, 0.6), 0))
sfx.add(CU["builds"]["land"] - 0.02, pan(whump(0.3), 0))

# ------------------------------------------------------------------ shot 8: parts -> built
P0, DT = PT["t0"], PT["dt"]
part_sfx = [
    lambda t: sfx.add(t, pan(zap_drop(0.22, 2600, 420, 0.15), 0)),  # CPU drops in
    lambda t: sfx.add(t, swish(0.18, 0.26, 900, 6000, -0.9, -0.1, seed=180)),  # GPU slides
    lambda t: sfx.add(t + 0.05, pan(lock_clack(0.35, pitch=1.3, seed=181), 0.3)),  # RAM snaps
    lambda t: sfx.add(t + 0.07, pan(lock_clack(0.38, pitch=0.85, seed=182), 0)),  # STORAGE locks
    lambda t: sfx.add(t, swish(0.2, 0.22, 700, 5000, 0.9, 0.2, seed=183)),  # COOLING curves in
    lambda t: (sfx.add(t + 0.1, pan(kick(0.45), 0)), sfx.add(t + 0.1, pan(thock(0.35, 120), 0))),  # PSU lands
]
for i, f in enumerate(part_sfx):
    ti = P0 + i * DT
    f(ti)
    sfx.add(ti + 0.3, pan(tick(3000 + 260 * i, 0.12, 0.025, seed=190 + i), 0))  # absorbed: a light step up
for i in range(3):  # BUILT. SET UP. READY.
    sfx.add(BU["t0"] + i * BU["dt"], pan(thock(0.55, 150 + 30 * i), 0))
    sfx.add(BU["t0"] + i * BU["dt"], pan(kick(0.35), 0))
sfx.add(BU["t0"] + 2 * BU["dt"], shimmer(0.5, 0.14, seed=195))

# ------------------------------------------------------------------ shot 9: ready / delivery
RY = CU["ready"]["t0"]
sfx.add(RY, pan(thock(0.45, 170), -0.1))
sfx.add(RY + 0.08, pan(thock(0.45, 200), 0.1))
sfx.add(RY + 0.24, pan(tick(2800, 0.14, 0.03, seed=196), 0))
sfx.add(CT["toCta"], whoosh(0.56, 200, 3000, peak=0.6, level=0.22, pan_from=-0.2, pan_to=0.5, seed=197))
send.add(CT["toCta"] + 0.2, shimmer(0.6, 0.1, seed=198))

# ------------------------------------------------------------------ shot 10: CTA + end card
E0 = CT["end0"]
sfx.add(CT["cta0"], pan(thock(0.35, 160), -0.15))
sfx.add(E0, whoosh(0.4, 400, 4000, peak=0.6, level=0.2, pan_from=0.2, pan_to=0, seed=199))
sfx.add(FINAL, pan(kick(0.95), 0))
sfx.add(FINAL, pan(sub_boom(0.55), 0))
sfx.add(FINAL, pan(chime([440.0, 659.25, 880.0, 1318.5], 0.16, 0.03, 0.8), 0))
send.add(FINAL, pan(chime([440.0, 659.25, 880.0, 1318.5], 0.2, 0.03, 0.8), 0))
sfx.add(E0 + 0.42, shimmer(0.46, 0.16, seed=200))  # light sweep

# ------------------------------------------------------------------ mix + loudness
wet = apply_reverb(send.buf, reverb_ir(1.8, 0.45), wet=1.0) * 0.4
mix = music.buf * db(-4) + sfx.buf + wet
mix = mix[: secs(DUR)]
out = master(mix, -1.0)
# fades: no click in, a short tail out
fade = np.ones(len(out))
fade[: secs(0.004)] = np.linspace(0, 1, secs(0.004))
fade[-secs(0.3) :] = np.linspace(1, 0, secs(0.3)) ** 1.5
out *= fade[:, None]
dest = os.path.join(ROOT, "public/audio/final.wav")
write_wav(dest, out)

# normalise to -14 LUFS integrated with a -1 dBTP ceiling (oversampled true-peak limiter)
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", dest, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
lufs = float([l for l in r.splitlines() if l.strip().startswith("I:")][-1].split()[1])
out2 = out * db(-14 - lufs)
ceil = db(-1.3)
from scipy.signal import resample_poly

for _ in range(4):
    up = resample_poly(out2, 4, 1, axis=0)
    tp = np.abs(up).max()
    if tp <= ceil:
        break
    out2 = ceil * np.tanh(out2 / ceil) if tp > ceil * 1.02 else out2 * (ceil / tp)
write_wav(dest, out2)
print(f"measured {lufs:.1f} LUFS -> normalised to -14; wrote {dest}")
