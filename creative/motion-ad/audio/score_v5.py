"""Score + SFX for style proof v5 (3.42 s). Frame-accurate to timeline.json and the
real capture log (hover / press / release). Energy ramps continuously from frame 0
— no sudden jump — and the hits are better transients, not more layers."""
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
LOG = json.load(open(os.path.join(ROOT, "public/cap/home5/log.json")))
V = T["v5"]
L5, H = V["logo"], V["home"]
BEAT = T["beat"]
DOWN = T["downbeat"]  # 1.10: the camera lands on the site
DUR = V["duration"] + 0.5

cap0 = H["captureStart"]
base = LOG[0]["meta"]["ctaBg"]
hover_t = next(cap0 + e["frame"] / 60 for e in LOG if e["meta"]["ctaBg"] and e["meta"]["ctaBg"] != base)
i_press = next(e["frame"] for e in LOG if e["mouse"]["down"])
press_t = cap0 + i_press / 60
release_t = next(cap0 + e["frame"] / 60 for e in LOG if e["frame"] > i_press and not e["mouse"]["down"])
contact_t = H["contact"]
pass_t = H["pass"]
print(f"hover {hover_t:.3f} contact {contact_t:.3f} press {press_t:.3f} release {release_t:.3f} pass {pass_t:.3f}")

music, sfx, send = Bus(DUR), Bus(DUR), Bus(DUR)


# ------------------------------------------------------------------ new transients
def lock_clack(level=1.0):
    """Two machined parts seating: a hard tick, a short metallic ring, a small low thud."""
    d = 0.22
    t = np.arange(secs(d)) / SR
    tick_ = bp(noise(d, 71), 2200, 9000) * np.exp(-t / 0.0022)
    ring = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / dk) for f, a, dk in [(1870, 0.5, 0.07), (2930, 0.35, 0.05), (4410, 0.22, 0.035)])
    thud = np.sin(2 * np.pi * np.cumsum(np.linspace(150, 90, len(t))) / SR) * np.exp(-t / 0.035)
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


# ------------------------------------------------------------------ music: one continuous ramp
AM = [220.0, 261.63, 329.63, 440.0]
FMAJ = [174.61, 261.63, 349.23, 440.0]
pad_in = pad_chord([110.0, 164.81, 220.0, 329.63], DOWN + 0.3, cutoff=900, level=0.5)
ramp = np.linspace(0, 1, len(pad_in)) ** 0.8
music.add(0.0, pad_in * ramp[:, None])
music.add(DOWN, pad_chord(AM, 4 * BEAT + 0.3, cutoff=1500, level=0.42))
music.add(DOWN + 4 * BEAT, pad_chord(FMAJ, 2 * BEAT + 0.4, cutoff=1500, level=0.42))

beats = [DOWN + k * BEAT for k in range(-2, 5)]  # 0.066, 0.583, 1.10, ...
for k, tb in enumerate(beats):
    if tb < 0 or tb > DUR - 0.1:
        continue
    # the pulse grows into the groove: filtered and quiet under the logo, full from the landing
    grow = min(1.0, 0.35 + 0.32 * k)
    music.add(tb, soft_kick(0.85 * grow, cutoff=500 + 1400 * grow))
    if tb >= DOWN - 0.01:
        music.add(tb, bass_note(55.0 if tb < DOWN + 4 * BEAT - 0.01 else 43.65, BEAT * 0.95, 0.45))
    if k >= 1:
        music.add(tb + BEAT / 2, pan(hat(0.05 + 0.04 * grow), 0.25))
# sidechain the bed under each pulse
env = np.ones(len(music.buf))
for tb in beats:
    if tb < 0:
        continue
    i, n = secs(tb), secs(0.2)
    if i + n < len(env):
        env[i : i + n] *= 1 - 0.45 * np.exp(-np.arange(n) / secs(0.06))
music.buf *= env[:, None]

# ------------------------------------------------------------------ shot 1
# halves swinging in from both sides, converging on the lock
sfx.add(0.0, whoosh(L5["lock"] + 0.02, 500, 5200, peak=0.85, level=0.22, pan_from=-0.85, pan_to=-0.05, seed=101))
sfx.add(0.0, whoosh(L5["lock"] + 0.02, 520, 5400, peak=0.85, level=0.22, pan_from=0.85, pan_to=0.05, seed=102))
sfx.add(L5["lock"], pan(lock_clack(0.8), 0))
send.add(L5["lock"], pan(lock_clack(0.35), 0))
sfx.add(L5["lock"] + 0.005, pan(tick(6200, 0.12, 0.03, seed=103), 0))  # the seam light
# wordmark rising
sfx.add(L5["wordmark"][0], shimmer(0.34, 0.16))
# the dolly: a smooth rise that hands straight into the pass
sfx.add(0.42, riser(L5["passEnd"] - 0.42, 0.26))
sfx.add(L5["passEnd"] - 0.2, whoosh(0.42, 180, 3200, peak=0.5, level=0.34, pan_from=-0.3, pan_to=0.3, seed=104))
# landing: weight, not a bang
sfx.add(DOWN, pan(whump(0.42), 0))
send.add(DOWN, pan(whump(0.2), 0))

# ------------------------------------------------------------------ shot 2
sfx.add(H["scrollStart"], whoosh(H["scrollEnd"] - H["scrollStart"], 300, 1800, peak=0.3, level=0.07, seed=105))
sfx.add(hover_t, pan(blip(2349.3, 0.08, 0.06), 0.25))  # hover: a quiet tone as the button warms
sfx.add(contact_t, pan(glass_tap(0.55), 0.25))
sfx.add(press_t, pan(ui_click(0.7, 1.0, seed=106), 0.2))
sfx.add(release_t, pan(ui_click(0.38, 1.4, seed=107), 0.2))
send.add(press_t, pan(ui_click(0.25), 0.2))

# ------------------------------------------------------------------ shot 3: surface lifts -> through the red V
sfx.add(release_t, whoosh(pass_t - release_t + 0.06, 160, 4800, peak=0.9, level=0.38, pan_from=0.25, pan_to=0, seed=108))
sfx.add(release_t + 0.02, riser(pass_t - release_t - 0.02, 0.16))
sfx.add(pass_t, pan(kick(0.8), 0))
sfx.add(pass_t, pan(sub_boom(0.42), 0))
sfx.add(pass_t, whoosh(0.5, 6000, 500, peak=0.15, level=0.22, pan_from=-0.2, pan_to=0.2, seed=109))
send.add(pass_t, whoosh(0.5, 6000, 500, peak=0.15, level=0.18, seed=110))

# ------------------------------------------------------------------ mix + loudness
wet = apply_reverb(send.buf, reverb_ir(1.6, 0.42), wet=1.0) * 0.4
mix = music.buf * db(-4) + sfx.buf + wet
out = master(mix, -1.0)
tail = secs(V["duration"])
fade = np.ones(len(out))
fade[tail:] = np.linspace(1, 0, len(out) - tail)
out *= fade[:, None]
dest = os.path.join(ROOT, "public/audio/proof-v5.wav")
write_wav(dest, out)

# normalise integrated loudness to −14 LUFS (Instagram), keeping peaks ≤ −1 dBFS
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", dest, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
lufs = float([l for l in r.splitlines() if l.strip().startswith("I:")][-1].split()[1])
gain = db(-14 - lufs)
out2 = out * gain
ceil = db(-1)
if np.abs(out2).max() > ceil:
    out2 = ceil * np.tanh(out2 / ceil)  # soft ceiling at -1 dBFS
write_wav(dest, out2)
print(f"measured {lufs:.1f} LUFS -> normalised to -14; wrote {dest}")
