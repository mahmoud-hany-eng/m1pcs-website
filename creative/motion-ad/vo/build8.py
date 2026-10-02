"""v8 timeline — cut AROUND the voiceover.

1. Places every narration line (vo/lines/<voice>/*.wav) on the timeline, widening a
   few natural pauses so the picture can act on each phrase (the list in "tell",
   the U.S. → Qatar journey in "source").
2. Derives every picture / capture / audio cue from the narration's keyword onsets
   and writes them to timeline.json["v8"] (read by the captures, the Remotion
   composition and audio/score_v8.py — one source of truth).
3. Assembles the clean voiceover track public/audio/vo8.wav (48 kHz / 24-bit).
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from kw import refine

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
VOICE = "af_heart"
SR = 48000

K = refine(VOICE)  # {line: {dur, kw:{word: onset}}}
# natural pauses inside a line that the edit widens: (line, pause start, pause end, extra seconds)
WIDEN = {
    "tell": [(1.05, 1.30, 0.35), (2.50, 2.58, 0.35), (3.17, 3.42, 0.35)],
    "source": [(3.55, 3.91, 0.45)],
}
# line start times (s) — the edit
START = {
    "q": 0.40, "show": 4.05, "starts": 7.35, "tell": 10.55, "turn": 16.55, "send": 19.85,
    "confirm": 23.95, "source": 30.05, "real": 37.60, "rest": 42.10, "build": 44.50,
    "setup": 46.05, "ready": 47.60, "next": 50.60, "cta": 52.90, "visit": 54.60,
}
# a few onsets the prefix method can't see (word-initial vowels / list rhythm), measured by hand from the pauses
MANUAL = {
    "q": {"are": 0.02, "you": 0.2, "in": 0.38, "and": 1.39, "looking": 1.52, "build": 2.02},
    "tell": {"tell": 0.0, "play": 0.72, "performance": 1.42, "budget": 2.72, "look": 3.62},
    "starts": {"at": 0.0, "m1": 0.18, "it": 0.86, "with": 1.45},
    "source": {"directly": 2.2, "us": 3.12},
    "real": {"real": 0.52, "pcs": 0.86, "customers": 2.86},
    "cta": {"ready": 0.0, "to": 0.5, "build": 0.7, "yours": 1.0},
    "confirm": {"pricing": 1.25, "availability": 1.93, "then": 2.98, "deposit": 3.38, "order": 4.5},
}


def warp(line, t):
    """line-local time → time after widened pauses"""
    out = t
    for a, b, extra in WIDEN.get(line, []):
        if t >= b:
            out += extra
        elif t > a:
            out += extra * (t - a) / (b - a)
    return out


VO = {}
for lid, st in START.items():
    k = K[lid]
    kws = dict(k["kw"])
    kws.update(MANUAL.get(lid, {}))
    dur = warp(lid, k["dur"])
    VO[lid] = {"start": st, "end": round(st + dur, 3), "kw": {w: round(st + warp(lid, v), 3) for w, v in kws.items()}}

v = lambda lid, w=None: VO[lid]["kw"][w] if w else VO[lid]["start"]
e = lambda lid: VO[lid]["end"]

# ------------------------------------------------------------------ picture cues (seconds)
# The opening question: words appear as they are said; the letters then collapse into the emblem.
intro = {
    "words": {"are": v("q", "are"), "you": v("q", "you"), "in": v("q", "in"), "qatar": v("q", "Qatar"),
              "looking": v("q", "looking"), "build": v("q", "build"), "pc": v("q", "PC")},
    "collapse": [e("q") + 0.08, e("q") + 0.62],
    "lineA": [e("q") + 0.3, e("q") + 0.62],
    "lineB": [e("q") + 0.36, e("q") + 0.66],
    "spark": e("q") + 0.64,
    "fill": [e("q") + 0.66, e("q") + 0.92],
    "wm": [e("q") + 0.82, e("q") + 1.08],
    "doha": [e("q") + 1.0, e("q") + 1.34],
}
intro["hold"] = [intro["wm"][1], e("show") + 0.22]  # DOHA • QATAR readable for ~1.8 s
intro["dohaOut"] = [e("show") + 0.12, e("show") + 0.4]
p0 = e("show") + 0.32
intro["pressure"] = [p0, p0 + 0.36]
intro["expand"] = [p0 + 0.36, p0 + 1.08]
intro["materialize"] = [p0 + 0.9, p0 + 1.38]
intro["powerOn"] = [p0 + 1.3, p0 + 1.6]
intro["pullBack"] = [p0 + 1.42, p0 + 2.5]

starts = {"words": {"starts": v("starts", "starts"), "with": v("starts", "with"), "you": v("starts", "you")}, "out": e("starts") + 0.35}

home = {"captureStart": intro["powerOn"][0] - 0.02, "approach": [intro["pullBack"][1] - 0.2, e("starts") + 0.2]}
home["cursorIn"] = [e("starts") - 0.75, e("starts") - 0.05]
home["hover"] = home["cursorIn"][1]
home["press"] = e("starts") + 0.18
home["release"] = home["press"] + 0.09

t = v("tell")
quote = {
    "settle": [home["release"] + 0.05, home["release"] + 0.45],
    "build": {"path": [home["release"] + 0.3, home["release"] + 0.62], "press": home["release"] + 0.72, "release": home["release"] + 0.8},
}
quote["scroll1"] = [quote["build"]["release"] + 0.12, quote["build"]["release"] + 0.72]
g = v("tell", "play")
quote["gaming"] = {"path": [g - 0.5, g - 0.06], "press": g + 0.02, "release": g + 0.1}
quote["games"] = {"path": [g + 0.16, g + 0.42], "press": g + 0.46, "release": g + 0.52, "type": [g + 0.58, g + 1.12], "text": "Valorant, CS2"}
pf = v("tell", "performance")
quote["res"] = {"path": [pf - 0.12, pf + 0.2], "press": pf + 0.26, "release": pf + 0.33}
quote["fps"] = {"path": [pf + 0.42, pf + 0.72], "press": pf + 0.8, "release": pf + 0.87}
bd = v("tell", "budget")
quote["budget"] = {"path": [bd - 0.42, bd + 0.02], "press": bd + 0.06, "release": bd + 0.12, "type": [bd + 0.2, bd + 0.62], "text": "12000"}
lk = v("tell", "look")
quote["colour"] = {"path": [lk - 0.5, lk + 0.02], "press": lk + 0.08, "release": lk + 0.15}
tu = v("turn")
quote["consolidate"] = [tu + 0.05, tu + 0.7]
quote["card"] = tu + 0.7
bt = v("turn", "build")
quote["lines"] = [bt - 0.3, bt - 0.05, bt + 0.2, bt + 0.45]
quote["price"] = bt + 0.8
quote["lift"] = [tu + 0.6, e("turn") + 0.2]  # the card floats forward off the screen plane, then settles
se = v("send")
quote["scroll3"] = [se + 0.15, se + 0.85]
quote["send"] = {"path": [v("send", "send") - 0.5, v("send", "send") - 0.04], "press": v("send", "send") + 0.02, "release": v("send", "send") + 0.1}
quote["attach"] = [v("send", "quotation") - 0.1, v("send", "send") - 0.1]  # card → compact attachment
quote["captureEnd"] = quote["send"]["release"] + 0.4

wa = v("send", "WhatsApp")
toPhone = {"lift": [wa - 0.3, wa + 0.05], "icon": [wa + 0.05, wa + 1.0], "camera": [wa - 0.45, wa + 1.45]}
toPhone["wake"] = toPhone["icon"][1]

c = v("confirm")
chat = {
    "attach": toPhone["wake"] + 0.2,
    "proceed": c + 0.05,
    "typing": c + 0.55,
    "reply": v("confirm", "pricing") - 0.25,
    "tokens": [v("confirm", "pricing") + 0.05, v("confirm", "pricing") + 0.35, v("confirm", "availability") + 0.05],
    "checks": [v("confirm", "pricing") + 0.3, v("confirm", "availability") - 0.05, v("confirm", "availability") + 0.35],
}
chat["collapse"] = [chat["checks"][2] + 0.18, chat["checks"][2] + 0.4]
chat["order"] = v("confirm", "deposit") - 0.05
chat["paid"] = v("confirm", "order") - 0.55
chat["done"] = v("confirm", "order") + 0.05
chat["payoff"] = [chat["done"] + 0.1, chat["done"] + 0.6]
chat["orderText"] = [chat["done"] + 0.15, v("source") + 0.35]  # ORDER CONFIRMED. — the big moment
chat["push"] = v("source") - 0.15
chat["front"] = [chat["attach"] + 0.2, v("confirm", "pricing")]  # phone turns toward the viewer

so = v("source")
route = {"stroke": [chat["push"], chat["push"] + 0.75], "head": chat["push"] + 0.4, "parcel": v("source", "us") + 0.2}
route["words"] = {"sourced": v("source", "source"), "directly": v("source", "directly"), "us": v("source", "us")}
route["us"] = v("source", "us") + 0.05
route["travel"] = [v("source", "us") + 0.35, v("source", "Qatar") - 0.05]
route["arrive"] = v("source", "Qatar")
route["qatarWord"] = v("source", "Qatar")
route["fan"] = [e("source") + 0.2, e("source") + 0.95]

gal = {"start": route["fan"][1] - 0.15, "end": v("rest") + 0.25}
gal["real"] = v("real", "real")
gal["builds"] = v("real", "pcs")
gal["textOut"] = e("real") + 0.25
parts = {"rest": v("rest"), "closer": [v("build") - 0.35, v("build") + 0.1]}
parts["labels"] = [v("build") + 0.05 + 0.13 * i for i in range(5)]
parts["snaps"] = [v("build") + 0.55 + 0.1 * i for i in range(5)]
parts["built"] = v("build") + 0.25
parts["setup"] = v("setup") + 0.2
parts["setupChips"] = [v("setup") + 0.45, v("setup") + 0.65, v("setup") + 0.85]
parts["off"] = v("ready", "ready") - 0.32
parts["click"] = v("ready", "ready") + 0.02
parts["ready"] = v("ready", "ready") + 0.06
parts["hold"] = e("ready") + 0.25

ret = {"glow": [parts["hold"], parts["hold"] + 0.55], "pull": [parts["hold"] + 0.15, parts["hold"] + 1.2]}
ret["approach"] = [ret["pull"][1] - 0.1, v("next", "next") + 0.3]
ret["cta0"] = parts["hold"] + 0.2
fly = [ret["approach"][1], ret["approach"][1] + 0.8]
cta = {"words": {"ready": v("cta", "ready"), "to": v("cta", "to"), "yours": v("cta", "yours")}, "hover": v("cta", "build") + 0.1,
       "url": v("visit", "mone") - 0.05}
sig_start = e("visit") + 0.05
sig = {"fade": [sig_start - 0.3, sig_start + 0.05], "split": sig_start + 0.1, "fly": [sig_start + 0.13, sig_start + 0.73]}
sig["dip"] = [sig["fly"][1], sig["fly"][1] + 0.24]
sig["lock"] = sig["dip"][1]
sig["yellow"] = [sig["fly"][0] + 0.1, sig["lock"] - 0.03]
sig["wordmark"] = [sig["lock"] + 0.06, sig["lock"] + 0.42]
sig["gaming"] = sig["lock"] + 0.26
sig["sweep"] = [sig["lock"] + 0.45, sig["lock"] + 0.8]
sig["doha"] = sig["lock"] + 0.5
sig["url"] = sig["lock"] + 0.66
sig["settled"] = sig["url"] + 0.35
duration = round(sig["settled"] + 1.6, 2)  # DOHA • QATAR + monepcs.qa held ~1.6 s after everything has settled

r3 = lambda o: json.loads(json.dumps(o), parse_float=lambda x: round(float(x), 3))
V8 = r3({
    "duration": duration, "viewport": {"width": 720, "height": 1280, "dpr": 2.25}, "voice": VOICE,
    "vo": VO, "intro": intro, "starts": starts, "home": home, "quote": quote, "toPhone": toPhone, "chat": chat,
    "route": route, "gallery": gal, "parts": parts, "ret": ret, "fly": fly, "cta": cta, "sig": sig,
})
tl_path = os.path.join(ROOT, "timeline.json")
T = json.load(open(tl_path))
T["v8"] = V8
json.dump(T, open(tl_path, "w"), indent=2)

# ------------------------------------------------------------------ the clean voiceover track
track = np.zeros(int((duration + 0.5) * SR))
for lid, st in START.items():
    x, sr = sf.read(os.path.join(HERE, "lines", VOICE, lid + ".wav"))
    x = resample_poly(x, SR, sr)
    pieces, last = [], 0
    for a, b, extra in WIDEN.get(lid, []):
        mid = int((a + b) / 2 * SR)
        pieces += [x[last:mid], np.zeros(int(extra * SR))]
        last = mid
    pieces.append(x[last:])
    y = np.concatenate(pieces)
    i = int(st * SR)
    track[i : i + len(y)] += y
track = track[: int(duration * SR)]
os.makedirs(os.path.join(ROOT, "public", "audio"), exist_ok=True)
sf.write(os.path.join(ROOT, "public", "audio", "vo8.wav"), track, SR, subtype="PCM_24")
print("duration", duration)
for lid in START:
    print(f"{lid:8s} {VO[lid]['start']:6.2f} – {VO[lid]['end']:6.2f}  ", {k: round(t, 2) for k, t in VO[lid]['kw'].items()})
