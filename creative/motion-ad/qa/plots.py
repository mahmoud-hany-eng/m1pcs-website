"""Motion QA plots + numbers from qa/out/curves.json (sampled from the composition's own motion functions)."""
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, "out", "curves.json")))
OUT = os.path.join(HERE, "out")
R = {}


def deriv(t, y):
    return np.gradient(y, t)


plt.rcParams.update({"figure.facecolor": "#111", "axes.facecolor": "#161616", "axes.edgecolor": "#888", "text.color": "#ddd", "axes.labelcolor": "#ddd", "xtick.color": "#aaa", "ytick.color": "#aaa", "axes.grid": True, "grid.color": "#333", "font.size": 9})

# ---------------------------------------------------------------- logo halves
fig, ax = plt.subplots(2, 2, figsize=(12, 7))
for col, (key, mk) in enumerate([("introHalves", "intro"), ("endHalves", "sig")]):
    a = np.array(C[key])
    t, L, Rr, dy, rot = a.T
    m = C["meta"][mk]
    contact = m["contact"] if mk == "intro" else m["lock"]
    vL, vR = deriv(t, L), deriv(t, Rr)
    ax[0, col].plot(t, Rr, color="#f9c204", label="right half: x offset from final (px)")
    ax[0, col].plot(t, -L, "--", color="#e73225", label="left half (mirrored)")
    ax[0, col].plot(t, dy, color="#6cf", lw=0.8, label="common vertical float (px)")
    ax[0, col].axvline(contact, color="#fff", lw=0.6)
    ax[0, col].set_title(f"{'Opening' if mk == 'intro' else 'Closing'} logo halves — distance from centre")
    ax[0, col].legend(fontsize=7)
    ax[1, col].plot(t, -vR, color="#f9c204", label="inward speed, right (px/s)")
    ax[1, col].plot(t, vL, "--", color="#e73225", label="inward speed, left (px/s)")
    ax[1, col].axvline(contact, color="#fff", lw=0.6)
    ax[1, col].set_xlabel("time (s)")
    ax[1, col].legend(fontsize=7)
    mm = (t >= m["merge"][0]) & (t <= contact)
    i_c = np.argmin(np.abs(t - contact)) - 1
    acc = deriv(t, -vR)
    R[mk + "_halves"] = {
        "merge_duration_s": round(contact - m["merge"][0], 3),
        "travel_px_each": m["D0"],
        "peak_inward_speed_px_s": round(float((-vR[mm]).max()), 1),
        "speed_at_contact_px_s": round(float(-vR[i_c]), 1),
        "contact_over_peak": round(float(-vR[i_c] / (-vR[mm]).max()), 2),
        "compression_px": round(float(-Rr.min()), 2),
        "left_right_asymmetry_px": float(np.abs(L + Rr).max()),
        "max_speed_jump_between_frames_px_s": round(float(np.abs(np.diff(-vR[::4])).max()), 2),
        "accel_sign_changes_during_merge": int(np.sum(np.diff(np.sign(np.round(acc[mm], 3))) != 0)),
    }
fig.tight_layout()
fig.savefig(os.path.join(OUT, "qa_logo_halves_velocity.png"), dpi=110)

# ---------------------------------------------------------------- gallery camera
a = np.array(C["gallery"])
t, z, x = a.T
v = deriv(t, z)
acc = deriv(t, v)
g0, ge = C["meta"]["gallery"]["start"], C["meta"]["gallery"]["end"]
fig, ax = plt.subplots(3, 1, figsize=(12, 8), sharex=True)
ax[0].plot(t, z, color="#f9c204")
ax[0].set_ylabel("camera z")
ax[1].plot(t, v, color="#f9c204")
ax[1].set_ylabel("forward speed (units/s)")
ax[2].plot(t, x, color="#6cf")
ax[2].set_ylabel("lateral arc x")
ax[2].set_xlabel("time (s)")
inn = (t >= g0) & (t <= ge)
vmax = v[inn].max()
cruise = inn & (v >= 0.995 * vmax)
for b in C["builds"]:
    tr = np.array(b["track"])
    big = tr[(tr[:, 4] > 140) & (tr[:, 3] * 700 >= 520) & (np.abs(tr[:, 1] - 540) < 600)]
    if len(big):
        ax[1].axvspan(big[0, 0], big[-1, 0], ymin=0.02 + 0.07 * (b["n"] % 13) / 1.0 * 0, ymax=0.06, color="#e73225" if b["hero"] else "#777", alpha=0.6)
for a_ in ax:
    a_.axvline(g0, color="#888", lw=0.5)
    a_.axvline(ge, color="#888", lw=0.5)
ax[0].set_title("Gallery — ONE global camera progress (ease-in → constant cruise → ease-out into the flagship)")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "qa_gallery_velocity.png"), dpi=110)
seg = np.diff(np.sign(np.round(acc[inn], 1)))
R["gallery"] = {
    "duration_s": round(ge - g0, 3),
    "ease_in_pct": round(float((t[cruise][0] - g0) / (ge - g0) * 100), 1),
    "cruise_pct": round(float((t[cruise][-1] - t[cruise][0]) / (ge - g0) * 100), 1),
    "ease_out_pct": round(float((ge - t[cruise][-1]) / (ge - g0) * 100), 1),
    "cruise_speed": round(float(vmax), 1),
    "speed_never_decreases_before_ease_out": bool(np.all(np.diff(v[inn & (t < t[cruise][-1])]) >= -1e-3 * vmax)),
    "speed_never_increases_after_cruise": bool(np.all(np.diff(v[inn & (t > t[cruise][-1])]) <= 1e-3 * vmax)),
    "local_speed_minima_inside_flight": int(np.sum((v[1:-1] < v[:-2] - 1e-6) & (v[1:-1] < v[2:] - 1e-6) & inn[1:-1])),
}
# per build: identifiable (≥ 380 px tall, ≥ 70% in frame) and big (≥ 520 px, ≥ 85% in frame)
BB = {}
vis = {}
for b in C["builds"]:
    tr = np.array(b["track"])
    dt = tr[1, 0] - tr[0, 0]
    s = tr[:, 3]
    h = 700 * s
    xx, yy = tr[:, 1], tr[:, 2]
    ok = tr[:, 4] > 520
    inside = (xx > 120) & (xx < 960) & (yy - h / 2 > -0.15 * h) & (yy + h / 2 < 1920 + 0.15 * h)
    vis[b["n"]] = {"identifiable_s": round(float(np.sum(ok & inside & (h >= 380)) * dt), 2), "big_s": round(float(np.sum(ok & inside & (h >= 520)) * dt), 2), "hero_pass": b["hero"]}
R["gallery_builds"] = vis
R["gallery_all_13"] = sorted(vis) == list(range(1, 14))

# ---------------------------------------------------------------- word arrival
a = np.array(C["word"])
t, e = a.T
size = 236
y = (1 - e) * 0.5 * size
fig, ax = plt.subplots(1, 2, figsize=(12, 3.5))
ax[0].plot(t, y, color="#f9c204")
ax[0].set_title("Kinetic word: translateY (px, 236 px type)")
ax[1].plot(t, -deriv(t, y), color="#f9c204")
ax[1].set_title("speed (px/s): one acceleration → travel → one deceleration")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "qa_word_velocity.png"), dpi=110)
sp = -deriv(t, y)
R["word"] = {"peaks_in_speed": int(np.sum((sp[1:-1] > sp[:-2]) & (sp[1:-1] > sp[2:]))), "overshoot": bool(e.max() > 1 + 1e-9), "travel_s": float(t[-1])}

# ---------------------------------------------------------------- monitor / phone camera
a = np.array(C["camera"])
t = a[:, 0]
pos = a[:, 1:4]
sp = np.linalg.norm(np.gradient(pos, t, axis=0), axis=1)
yaw = np.degrees(np.gradient(a[:, 4], t))
pitch = np.degrees(np.gradient(a[:, 5], t))
fig, ax = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
ax[0].plot(t, sp, color="#f9c204")
ax[0].set_ylabel("camera speed (world mm/s)")
ax[0].set_title("Monitor → phone camera (monotone spline through the keys, Gaussian time-smoothed σ = 0.3 s)")
ax[1].plot(t, yaw, color="#6cf", label="yaw rate (°/s)")
ax[1].plot(t, pitch, color="#e73225", label="pitch rate (°/s)")
ax[1].legend(fontsize=7)
ax[1].set_xlabel("time (s)")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "qa_camera_velocity.png"), dpi=110)
fr = sp[::2][t[::2] < t[-1] - 1.4]  # (the last 1.4 s is the deliberate accelerating push into the check → route transition)
R["camera"] = {"max_frame_to_frame_speed_jump_pct_of_peak": round(float(np.abs(np.diff(fr)).max() / fr.max() * 100), 2), "peak_speed": round(float(fr.max()), 1)}
json.dump(R, open(os.path.join(OUT, "motion_qa.json"), "w"), indent=2)
print(json.dumps(R, indent=1))
