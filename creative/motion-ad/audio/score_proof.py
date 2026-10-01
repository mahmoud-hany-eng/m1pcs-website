"""Score + SFX for the style proof (0–4.4 s), synced to timeline.json and the
real capture log (hover / press / release frames)."""
import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
T = json.load(open(os.path.join(ROOT, "timeline.json")))
LOG = json.load(open(os.path.join(ROOT, "public/cap/home/log.json")))
P, L = T["proof"]["home"], T["proof"]["logo"]
BEAT = T["beat"]
DOWN = T["downbeat"]
DUR = T["proof"]["duration"] + 0.6  # tail

# real interaction times from the capture
cap0 = P["captureStart"]
hover_t = next(cap0 + e["frame"] / 60 for e in LOG if e["meta"]["ctaBg"] and e["meta"]["ctaBg"] != LOG[0]["meta"]["ctaBg"])
press_t = next(cap0 + e["frame"] / 60 for e in LOG if e["mouse"]["down"])
i_press = next(e["frame"] for e in LOG if e["mouse"]["down"])
release_t = next(cap0 + e["frame"] / 60 for e in LOG if e["frame"] > i_press and not e["mouse"]["down"])
print(f"hover {hover_t:.3f}  press {press_t:.3f}  release(nav) {release_t:.3f}")

music = Bus(DUR)
sfx = Bus(DUR)
verb_send = Bus(DUR)

# ---------------------------------------------------------------- music
A1, C2, E2, F1, G1 = 55.0, 65.41, 82.41, 43.65, 49.0
AM = [220.0, 261.63, 329.63, 440.0]
FMAJ = [174.61, 261.63, 349.23, 440.0]

# intro: dark A-minor bed under the logo, opening up into the downbeat
music.add(0.0, pad_chord([110.0, 164.81, 220.0], DOWN + 0.2, cutoff=650, level=0.55))
# from the downbeat: bar 1 Am, bar 2 F
bar = 4 * BEAT
music.add(DOWN, pad_chord(AM, bar + 0.25, cutoff=1500, level=0.42))
music.add(DOWN + bar, pad_chord(FMAJ, bar + 0.5, cutoff=1500, level=0.42))
for b in range(8):
    tb = DOWN + b * BEAT
    if tb > DUR - 0.1:
        break
    root = A1 if b < 4 else F1
    music.add(tb, kick(0.85))
    music.add(tb, bass_note(root, BEAT * 0.95, 0.5))
    music.add(tb + BEAT / 2, pan(hat(0.16), 0.25))
    if b % 2 == 1:
        music.add(tb, pan(hat(0.08, open_=True), -0.2))
# a quiet pluck motif answering the click
for k, (dt, f) in enumerate([(0.0, 659.25), (BEAT / 2, 880.0), (BEAT, 783.99)]):
    music.add(DOWN + bar + dt, pan(pluck(f, 0.12), 0.3 - 0.3 * k))
    verb_send.add(DOWN + bar + dt, pan(pluck(f, 0.12), 0.0))

# sidechain: duck music under each kick
env = np.ones(len(music.buf))
for b in range(8):
    i = secs(DOWN + b * BEAT)
    n = secs(0.22)
    if i + n < len(env):
        env[i : i + n] *= 1 - 0.55 * np.exp(-np.arange(n) / secs(0.07))
music.buf *= env[:, None]

# ---------------------------------------------------------------- shot 1 SFX
sfx.add(0.0, crackle(0.85, density=40, level=0.22))
# slice snaps: same order/timing as LogoReveal (centre rows first)
order = sorted(range(16), key=lambda i: abs(i - 7.5))
for rank, i in enumerate(order):
    st = 0.12 + rank * 0.021
    land = st + 0.16
    side = -1 if i % 2 == 0 else 1
    sfx.add(land, pan(tick(1700 + 90 * (rank % 5), 0.3, 0.04, seed=100 + i), side * 0.55))
# red streak: a fast zip panned left -> right
sfx.add(0.12, whoosh(0.4, 900, 6500, peak=0.5, level=0.22, pan_from=-0.9, pan_to=0.9, seed=3))
# pixel blocks: little digital blips across the wordmark build
for k in range(26):
    tt = 0.3 + 0.4 * k / 26 + 0.01 * rng.standard_normal()
    f = [1318.5, 1567.98, 1760.0, 2093.0, 2349.3][k % 5]
    sfx.add(tt, pan(blip(f, 0.07), -0.6 + 1.2 * k / 26))
# specular sweep
sfx.add(0.8, shimmer(0.45, 0.32))
verb_send.add(0.8, shimmer(0.45, 0.2))
# the push into the notch: riser that cuts exactly on the downbeat
sfx.add(L["pushStart"] - 0.08, riser(DOWN - (L["pushStart"] - 0.08), 0.42))
sfx.add(DOWN - 0.32, whoosh(0.42, 200, 2500, peak=0.75, level=0.35, pan_from=0, pan_to=0, seed=12))
# impact
sfx.add(DOWN, pan(sub_boom(0.95), 0))
verb_send.add(DOWN, pan(sub_boom(0.4), 0))

# ---------------------------------------------------------------- shot 2 SFX
# hand enters: soft air passing right -> centre
sfx.add(P["cursorIn"] - 0.02, whoosh(0.55, 400, 2600, peak=0.35, level=0.13, pan_from=0.8, pan_to=0.1, seed=33))
# real hover state engages
sfx.add(hover_t, pan(tick(4200, 0.22, 0.03, seed=7), 0.25))
# real press / release
sfx.add(press_t, pan(ui_click(0.75, 1.0, seed=8), 0.2))
sfx.add(release_t, pan(ui_click(0.45, 1.35, seed=9), 0.2))
verb_send.add(press_t, pan(ui_click(0.3), 0.2))
# the button floods the frame: rising swoosh into a soft whump
sfx.add(release_t, whoosh(P["expandEnd"] - release_t + 0.05, 220, 5200, peak=0.92, level=0.42, pan_from=0.25, pan_to=0, seed=44))
sfx.add(P["expandEnd"] - 0.01, pan(whump(0.5), 0))
# the V opens: airy downward shoop
sfx.add(P["expandEnd"], whoosh(0.4, 7000, 600, peak=0.2, level=0.28, pan_from=-0.3, pan_to=0.3, seed=55))
verb_send.add(P["expandEnd"], whoosh(0.4, 7000, 600, peak=0.2, level=0.2, seed=56))

# ---------------------------------------------------------------- mix
ir = reverb_ir(1.8, 0.5)
wet = apply_reverb(verb_send.buf, ir, wet=1.0) * 0.45
mix = music.buf * db(-3) + sfx.buf * db(0) + wet
out = master(mix, -1.0)
# fade the tail only after the proof ends
tail = secs(T["proof"]["duration"])
fade = np.ones(len(out))
fade[tail:] = np.linspace(1, 0, len(out) - tail)
out *= fade[:, None]
dest = os.path.join(ROOT, "public/audio/proof.wav")
write_wav(dest, out)
print("wrote", dest, f"{len(out)/SR:.2f}s")
