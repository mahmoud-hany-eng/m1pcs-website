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
from scipy.signal import lfilter, resample_poly

from kw import refine

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
VOICE = "am_michael"  # Kokoro-82M male voice (v9 refinement)
SR = 48000

K = refine(VOICE)  # {line: {dur, kw:{word: onset}}}
# natural pauses inside a line that the edit widens: (line, pause start, pause end, extra seconds)
WIDEN = {
    "tell": [(1.8, 1.87, 0.3), (3.44, 3.9, 0.1)],
    "source": [(4.76, 5.23, 0.5)],  # after "the U.S." — the parcel's journey
}
# word onsets read from the male read's pauses / stop closures (seconds into each line; the slowed lines
# re-mapped from the first read by DTW alignment of the two takes)
MANUAL = {
    "q": {"are": 0.17, "you": 0.37, "in": 0.64, "Qatar": 0.95, "and": 2.12, "looking": 2.27, "build": 2.8, "PC": 3.35},
    "tell": {"tell": 0.18, "play": 1.17, "performance": 1.99, "budget": 4.1, "look": 5.51},
    "starts": {"at": 0.15, "m1": 0.45, "it": 1.13, "starts": 1.36, "with": 1.7, "you": 1.9},
    "source": {"source": 1.3, "directly": 3.06, "us": 3.82, "US": 3.82, "ship": 5.41, "Qatar": 6.41},
    "real": {"real": 0.72, "pcs": 1.18, "PCs": 1.18, "customers": 3.7},
    "cta": {"ready": 0.09, "to": 0.6, "build": 0.85, "yours": 1.2},
    "confirm": {"pricing": 1.8, "availability": 2.4, "then": 3.9, "deposit": 4.45, "order": 5.85},
    "send": {"quotation": 1.58, "send": 2.89, "WhatsApp": 3.8},
    "next": {"yours": 0.45, "next": 1.25},
    "visit": {"mone": 0.6},
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
START = {}


def put(lid, st):
    """place a narration line at st (s) — the next line's position is decided from the picture around it"""
    k = K[lid]
    kws = dict(k["kw"])
    kws.update(MANUAL.get(lid, {}))
    dur = warp(lid, k["dur"])
    START[lid] = round(st, 3)
    VO[lid] = {"start": round(st, 3), "end": round(st + dur, 3), "kw": {w: round(st + warp(lid, x), 3) for w, x in kws.items()}}


v = lambda lid, w=None: VO[lid]["kw"][w] if w else VO[lid]["start"]
e = lambda lid: VO[lid]["end"]

# ------------------------------------------------------------------ picture cues (seconds)
# The opening question: words appear as they are said; then a deliberate PAUSE in which the letters
# become the two halves of the emblem, which float, then close slowly and meet — a sword-clash spark.
put("q", 0.5)
eq = e("q")
intro = {
    "words": {"are": v("q", "are"), "you": v("q", "you"), "in": v("q", "in"), "qatar": v("q", "Qatar"),
              "looking": v("q", "looking"), "build": v("q", "build"), "pc": v("q", "PC")},
    "collapse": [eq + 0.15, eq + 0.7],
    "halvesIn": [eq + 0.45, eq + 0.9],
    "merge": [eq + 0.85, eq + 2.0],
}
intro["contact"] = intro["merge"][1]
intro["spark"] = intro["contact"]
intro["fill"] = [intro["contact"] + 0.08, intro["contact"] + 0.3]  # the real logo art takes over the shapes
intro["wm"] = [intro["contact"] + 0.35, intro["contact"] + 0.7]
intro["doha"] = [intro["contact"] + 0.6, intro["contact"] + 0.95]
put("show", intro["contact"] + 0.4)
intro["hold"] = [intro["wm"][1], e("show") + 0.4]
intro["dohaOut"] = [e("show") + 0.35, e("show") + 0.63]
p0 = e("show") + 0.55
intro["pressure"] = [p0, p0 + 0.4]
intro["expand"] = [p0 + 0.4, p0 + 1.12]
intro["materialize"] = [p0 + 0.94, p0 + 1.42]
intro["powerOn"] = [p0 + 1.34, p0 + 1.64]
intro["pullBack"] = [p0 + 1.46, p0 + 2.6]
put("starts", intro["powerOn"][0] + 0.15)

starts = {"words": {"starts": v("starts", "starts"), "with": v("starts", "with"), "you": v("starts", "you")}, "out": e("starts") + 0.35}

home = {"captureStart": intro["powerOn"][0] - 0.02, "approach": [intro["pullBack"][1] - 0.2, e("starts") + 0.2]}
home["cursorIn"] = [e("starts") - 0.75, e("starts") - 0.05]
home["hover"] = home["cursorIn"][1]
home["press"] = e("starts") + 0.18
home["release"] = home["press"] + 0.09

put("tell", e("starts") + 1.3)
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
put("turn", e("tell") + 0.45)
tu = v("turn")
quote["consolidate"] = [tu + 0.05, tu + 0.7]
quote["card"] = tu + 0.7
bt = v("turn", "build")
quote["lines"] = [bt - 0.3, bt - 0.05, bt + 0.2, bt + 0.45]
quote["price"] = bt + 0.8
quote["lift"] = [tu + 0.6, e("turn") + 0.2]  # the card floats forward off the screen plane, then settles
put("send", e("turn") + 0.45)
se = v("send")
quote["scroll3"] = [se + 0.15, se + 0.85]
quote["send"] = {"path": [v("send", "send") - 0.5, v("send", "send") - 0.04], "press": v("send", "send") + 0.02, "release": v("send", "send") + 0.1}
quote["attach"] = [v("send", "quotation") - 0.1, v("send", "send") - 0.1]  # card → compact attachment
quote["captureEnd"] = quote["send"]["release"] + 0.4

wa = v("send", "WhatsApp")
toPhone = {"lift": [wa - 0.3, wa + 0.05], "icon": [wa + 0.05, wa + 1.0], "camera": [wa - 0.45, wa + 1.45]}
toPhone["wake"] = toPhone["icon"][1]

put("confirm", max(e("send") + 0.55, toPhone["wake"] + 0.4))
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
put("source", chat["done"] + 1.55)  # ORDER CONFIRMED. holds, readable, before the narrator moves on
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

# the gallery: ONE continuous camera journey (~8.6 s): ease in, cruise, one deceleration into the flagship
gal = {"start": route["fan"][1] - 0.15}
gal["end"] = gal["start"] + 8.6
put("real", gal["start"] + 1.45)
put("build", gal["end"] + 1.55)  # the flagship settles ~1.5 s before the build sequence
put("rest", v("build") - 0.4 - K["rest"]["dur"])
put("setup", e("build") + 0.75)  # PAUSE
put("ready", e("setup") + 0.75)  # PAUSE
gal["real"] = v("real", "real")
gal["builds"] = v("real", "pcs")
gal["textOut"] = e("real") + 0.25
parts = {"rest": v("rest"), "closer": [v("build") - 0.35, v("build") + 0.1]}
parts["labels"] = [v("build") + 0.05 + 0.13 * i for i in range(5)]
parts["snaps"] = [v("build") + 0.55 + 0.1 * i for i in range(5)]
parts["built"] = v("build") + 0.25
parts["setup"] = v("setup") + 0.2
parts["setupChips"] = [v("setup") + 0.45, v("setup") + 0.65, v("setup") + 0.85]
# the line finishes — then the RGB drops out, a held breath, CLICK, READY.
parts["off"] = e("ready") - 0.12
parts["click"] = e("ready") + 0.22
parts["ready"] = parts["click"] + 0.04
parts["hold"] = parts["click"] + 1.15

put("next", parts["hold"] + 0.5)
ret = {"glow": [parts["hold"], parts["hold"] + 0.55], "pull": [parts["hold"] + 0.15, parts["hold"] + 1.2]}
ret["approach"] = [ret["pull"][1] - 0.1, v("next", "next") + 0.3]
ret["cta0"] = parts["hold"] + 0.2
fly = [ret["approach"][1], ret["approach"][1] + 0.8]
put("cta", fly[1] + 0.12)
put("visit", e("cta") + 0.4)
cta = {"words": {"ready": v("cta", "ready"), "to": v("cta", "to"), "yours": v("cta", "yours")}, "hover": v("cta", "build") + 0.1,
       "url": v("visit", "mone") - 0.05}
sig_start = e("visit") + 0.05
sig = {"fade": [sig_start - 0.3, sig_start + 0.05], "split": sig_start + 0.1}
sig["fly"] = [sig["split"] + 0.03, sig["split"] + 0.78]  # strips fly and fold into the two separated halves
sig["merge"] = [sig["fly"][1] + 0.18, sig["fly"][1] + 1.33]  # float → slow close → contact
sig["lock"] = sig["merge"][1]
sig["dip"] = [sig["lock"] - 0.35, sig["lock"]]
sig["yellow"] = [sig["lock"] + 0.1, sig["lock"] + 0.5]  # the spark's light runs down to the wordmark
sig["wordmark"] = [sig["lock"] + 0.45, sig["lock"] + 0.82]
sig["gaming"] = sig["lock"] + 0.65
sig["sweep"] = [sig["lock"] + 0.9, sig["lock"] + 1.25]
sig["doha"] = sig["lock"] + 0.95
sig["url"] = sig["lock"] + 1.15
sig["settled"] = sig["url"] + 0.4
duration = round(sig["settled"] + 1.7, 2)  # DOHA • QATAR + monepcs.qa held ~1.6 s after everything has settled

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


def shelf(x, f0, gain_db, kind, sr=SR, S=0.7):
    """RBJ shelving biquad"""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / sr
    al = np.sin(w) / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    c = np.cos(w)
    if kind == "low":
        b = [A * ((A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al)]
        a = [(A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al]
    else:
        b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al)]
        a = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


# gentle warmth only (no compression): +1.5 dB low shelf at 220 Hz, −1 dB air shelf above 7.5 kHz
track = shelf(shelf(track, 220, 1.5, "low"), 7500, -1.0, "high")
os.makedirs(os.path.join(ROOT, "public", "audio"), exist_ok=True)
sf.write(os.path.join(ROOT, "public", "audio", "vo8.wav"), track, SR, subtype="PCM_24")
print("duration", duration)
for lid in sorted(START, key=START.get):
    print(f"{lid:8s} {VO[lid]['start']:6.2f} – {VO[lid]['end']:6.2f}  ", {k: round(t, 2) for k, t in VO[lid]['kw'].items()})


# ------------------------------------------------------------------ the script as used (vo/script_final.md)
LINES = {l["id"]: l for l in json.load(open(os.path.join(HERE, "lines.json")))}
order = sorted(START, key=START.get)
words = sum(len(LINES[l]["text"].split()) for l in order)
speech = sum(VO[l]["end"] - VO[l]["start"] for l in order)
span = VO[order[-1]]["end"] - VO[order[0]]["start"]
md = [
    "# M1 Gaming PCs — final voiceover (as used, v9 male read)",
    "",
    f"Voice: **Kokoro-82M v1.0** (offline neural TTS, Apache-2.0), voice **`{VOICE}`** (male, American English),",
    f"per-line speed {min(LINES[l]['speed'] for l in order)}–{max(LINES[l]['speed'] for l in order)} (listed below), clause pause 0.22 s;" " gentle warmth EQ only (+1.5 dB low shelf at 220 Hz,",
    "−1 dB shelf above 7.5 kHz) — no compression, no limiting on the stem.",
    f"Pace: {words} words — {words / speech * 60:.0f} wpm while speaking, {words / span * 60:.0f} wpm over the whole narration including the pauses.",
    "",
    "| # | In | Out | Speed | Line |",
    "|---|---|---|---|---|",
]
for k, l in enumerate(order, 1):
    md.append(f"| {k} | {VO[l]['start']:.2f} s | {VO[l]['end']:.2f} s | {LINES[l]['speed']} | {LINES[l]['text']} |")
md += [
    "",
    "Pauses held on purpose: after *“…looking to build a PC?”* the picture takes "
    f"{VO['show']['start'] - VO['q']['end']:.1f} s (the two halves of the logo close and clash) before *“Then let us show you how it's properly done.”*; "
    f"*“We build it.”* — {VO['setup']['start'] - VO['build']['end']:.2f} s — *“We set it up.”* — {VO['ready']['start'] - VO['setup']['end']:.2f} s — *“And we make sure it's ready to use.”*",
    "",
    "Pronunciation (fixed at phoneme level, then checked by transcribing every line back with an offline Whisper model):",
    "Qatar = “KUH-tar” (kˈʌtɑːɹ) · M1 = “em one” · WhatsApp = one word, “WOTS-app” · U.S. = “the you-ess” · monepcs.qa = “M-one P-Cs dot Q-A”.",
    "",
]
open(os.path.join(HERE, "script_final.md"), "w").write("\n".join(md))
