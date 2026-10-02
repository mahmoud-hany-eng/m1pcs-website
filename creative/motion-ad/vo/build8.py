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
VOICE = "am_fenrir"  # Kokoro-82M male voice (v10: a confident modern tech presenter)
SR = 48000

K = refine(VOICE)  # {line: {dur, kw:{word: onset}}} — overridden below by the verified onsets
WIDEN = {}
# word onsets (s into each line): DTW alignment of each spoken prefix against the full line (vo/align.py),
# every one verified by cutting the line there and transcribing both halves (previous word | keyword)
MANUAL = {
    "q": {"are": 0.05, "you": 0.2, "in": 0.38, "Qatar": 0.63, "looking": 1.36, "build": 1.77, "PC": 2.17},
    "show": {"properly": 1.10},
    "starts": {"m1": 0.17, "build": 0.80, "starts": 1.16, "with": 1.40, "you": 1.52},
    "tell": {"play": 0.70, "performance": 1.25, "budget": 2.58, "style": 3.16},
    "turn": {"choices": 0.47, "custom": 1.45, "quote": 1.95},
    "send": {"send": 0.25, "WhatsApp": 0.90},
    "confirm": {"price": 0.75, "availability": 1.48, "deposit": 2.76, "confirms": 3.37, "order": 4.12},
    "source": {"source": 0.17, "directly": 0.83, "us": 1.58, "US": 1.58, "ship": 2.38, "Qatar": 3.04},
    "real": {"pcs": 0.40, "PCs": 0.40, "built": 1.06, "customers": 1.61},
    "rest": {"rest": 0.98},
    "bsr": {"build": 0.26, "set": 0.77, "ready": 1.78},
    "cta": {"ready": 0.04, "to": 0.29, "build": 0.39, "yours": 0.66},
    "visit": {"mone": 0.42},
}


def warp(line, t):
    return t


VO = {}
START = {}


def put(lid, st):
    """place a narration line at st (s)"""
    k = K[lid]
    kws = dict(MANUAL.get(lid, k["kw"]))
    dur = k["dur"]
    START[lid] = round(st, 3)
    VO[lid] = {"start": round(st, 3), "end": round(st + dur, 3), "kw": {w: round(st + x, 3) for w, x in kws.items()}}


v = lambda lid, w=None: VO[lid]["kw"][w] if w else VO[lid]["start"]
e = lambda lid: VO[lid]["end"] - 0.08  # (the line's file carries ~0.1 s of tail silence)
GAP = 0.12  # a breath between sentences — no dramatic gaps

# ------------------------------------------------------------------ 0. the brand, in ~1.5 s
# halves establish (0–0.15) → one smooth inward move (0.15–0.72) → CLASH + spark → logo settles (~0.95)
# → M1 GAMING PCS + DOHA • QATAR readable (to ~1.6) → straight into the logo → monitor transformation.
intro = {"halvesIn": [0.0, 0.15], "merge": [0.15, 0.72]}
intro["contact"] = intro["merge"][1]
intro["spark"] = intro["contact"]
intro["wm"] = [intro["contact"] + 0.06, intro["contact"] + 0.32]
intro["doha"] = [intro["contact"] + 0.14, intro["contact"] + 0.4]
put("q", intro["contact"] + 0.1)  # the narrator starts right after the clash; "Qatar" lands under DOHA • QATAR
intro["words"] = {w.lower(): v("q", w) for w in ["are", "you", "in", "Qatar", "looking", "build", "PC"]}
p0 = 1.68  # logo complete at ~0.95, DOHA • QATAR fully readable ~1.12 → 1.62
intro["hold"] = [intro["wm"][1], p0 + 0.05]
intro["dohaOut"] = [p0 - 0.06, p0 + 0.12]
intro["pressure"] = [p0, p0 + 0.12]
intro["expand"] = [p0 + 0.12, p0 + 0.72]
intro["materialize"] = [p0 + 0.56, p0 + 0.96]
intro["powerOn"] = [p0 + 0.86, p0 + 1.1]
intro["pullBack"] = [p0 + 0.94, p0 + 1.84]
intro["collapse"] = [0.0, 0.0]  # (v8 key, unused)
intro["fill"] = [intro["contact"], intro["contact"]]  # (v8 key, unused)

# ------------------------------------------------------------------ 1. monitor / homepage
put("show", e("q") + GAP)
put("starts", e("show") + GAP)
starts = {"words": {"starts": v("starts", "starts"), "with": v("starts", "with"), "you": v("starts", "you")}, "out": e("starts") + 0.3}
home = {"captureStart": intro["powerOn"][0] - 0.02, "approach": [intro["pullBack"][1] - 0.2, e("starts") + 0.2]}
home["cursorIn"] = [v("starts", "you") - 1.25, v("starts", "you") - 0.04]  # the hand travels to Build Your PC through the line
home["hover"] = home["cursorIn"][1]
home["press"] = v("starts", "you") + 0.02  # "…starts with YOU" — click
home["release"] = home["press"] + 0.08

# ------------------------------------------------------------------ 2. Build My PC — each choice on its word
rel = home["release"]
quote = {"settle": [rel + 0.05, rel + 0.35], "build": {"path": [rel + 0.12, rel + 0.4], "press": rel + 0.45, "release": rel + 0.51}}
quote["scroll1"] = [quote["build"]["release"] + 0.06, quote["build"]["release"] + 0.5]
put("tell", max(e("starts") + GAP, quote["scroll1"][1] + 0.42 - MANUAL["tell"]["play"]))
g = v("tell", "play")
quote["gaming"] = {"path": [g - 0.4, g - 0.04], "press": g, "release": g + 0.07}
quote["games"] = {"path": [g + 0.1, g + 0.3], "press": g + 0.33, "release": g + 0.38, "type": [g + 0.42, g + 0.76], "text": "Valorant, CS2"}
pf = v("tell", "performance")
r0 = max(pf + 0.1, quote["games"]["type"][1] + 0.04)
quote["res"] = {"path": [r0, r0 + 0.2], "press": r0 + 0.24, "release": r0 + 0.3}
quote["fps"] = {"path": [r0 + 0.34, r0 + 0.52], "press": r0 + 0.56, "release": r0 + 0.62}
bd = v("tell", "budget")
quote["budget"] = {"path": [max(r0 + 0.66, bd - 0.34), bd], "press": bd + 0.04, "release": bd + 0.1, "type": [bd + 0.14, bd + 0.4], "text": "12000"}
lk = v("tell", "style")
quote["colour"] = {"path": [quote["budget"]["type"][1] + 0.02, max(lk + 0.06, quote["budget"]["type"][1] + 0.3)], "press": 0, "release": 0}
quote["colour"]["press"] = quote["colour"]["path"][1] + 0.04
quote["colour"]["release"] = quote["colour"]["press"] + 0.07

# ------------------------------------------------------------------ 3. the custom quote
put("turn", max(e("tell") + GAP, quote["colour"]["release"] + 0.1))
tu = v("turn")
quote["consolidate"] = [tu + 0.02, tu + 0.45]
quote["card"] = tu + 0.45
cu = v("turn", "custom")
quote["lines"] = [quote["card"] + 0.12 + 0.13 * i for i in range(4)]
quote["price"] = max(cu, quote["lines"][3] + 0.25)  # the price line lands on "custom quote"; the card then reads for ~0.7 s
quote["lift"] = [tu + 0.45, e("turn") + 0.25]
# ------------------------------------------------------------------ 4. → WhatsApp
put("send", e("turn") + GAP)
sk = v("send", "send")
quote["send"] = {"path": [sk - 0.42, sk - 0.03], "press": sk + 0.02, "release": sk + 0.09}
quote["scroll3"] = [quote["send"]["path"][0] - 0.62, quote["send"]["path"][0] - 0.04]
quote["attach"] = [sk - 0.62, sk - 0.08]  # card → compact attachment
quote["captureEnd"] = quote["send"]["release"] + 0.4
wa = v("send", "WhatsApp")
toPhone = {"lift": [wa - 0.22, wa + 0.05], "icon": [wa + 0.05, wa + 0.78], "camera": [wa - 0.36, wa + 1.15]}
toPhone["wake"] = toPhone["icon"][1]

# ------------------------------------------------------------------ 5. the conversation: sent → price/availability ✓ → deposit → ORDER CONFIRMED.
put("confirm", max(e("send") + GAP, toPhone["wake"] - 0.15))
c = v("confirm")
pr, av = v("confirm", "price"), v("confirm", "availability")
chat = {"attach": toPhone["wake"] + 0.08}
chat["proceed"] = max(c + 0.05, chat["attach"] + 0.32)
chat["typing"] = chat["proceed"] + 0.18
chat["reply"] = max(pr - 0.2, chat["typing"] + 0.22)
r_ = chat["reply"]
chat["tokens"] = [r_ + 0.12, r_ + 0.28, max(av - 0.05, r_ + 0.44)]
chat["checks"] = [chat["tokens"][0] + 0.2, max(av - 0.1, chat["tokens"][1] + 0.2), max(av + 0.2, chat["tokens"][2] + 0.2)]
chat["collapse"] = [chat["checks"][2] + 0.16, chat["checks"][2] + 0.36]
chat["order"] = v("confirm", "deposit") - 0.08
chat["paid"] = v("confirm", "confirms") - 0.3
chat["done"] = v("confirm", "order") - 0.05
chat["payoff"] = [chat["done"] + 0.08, chat["done"] + 0.5]
put("source", e("confirm") + 0.45)  # ORDER CONFIRMED. holds ~1 s, readable, before the narrator moves on
chat["orderText"] = [v("confirm", "order") - 0.02, v("source") + 0.3]
chat["push"] = v("source") - 0.12
chat["front"] = [chat["attach"] + 0.12, pr]

# ------------------------------------------------------------------ 6. U.S. → Qatar → the fan
route = {"stroke": [chat["push"], chat["push"] + 0.6], "head": chat["push"] + 0.32, "parcel": v("source", "us") + 0.15}
route["words"] = {"sourced": v("source", "source"), "directly": v("source", "directly"), "us": v("source", "us")}
route["us"] = v("source", "us") + 0.05
route["travel"] = [v("source", "us") + 0.3, v("source", "Qatar") - 0.04]
route["arrive"] = v("source", "Qatar")
route["qatarWord"] = v("source", "Qatar")
route["fan"] = [route["arrive"] + 0.3, route["arrive"] + 0.8]

# ------------------------------------------------------------------ 7. all 13 builds: ONE camera journey, ~6.3 s
gal = {"start": route["fan"][1] - 0.15}
gal["end"] = gal["start"] + 5.9
put("real", max(e("source") + GAP, gal["start"] + 0.4))
put("rest", gal["end"] - 0.05 - (K["rest"]["dur"] - 0.08) + 0.6)  # "M1 handles the rest." as the flagship settles
put("bsr", gal["end"] + 1.05 - MANUAL["bsr"]["build"])  # the flagship gets ~1.05 s, then BUILT. on "build"
gal["real"] = v("real") + 0.02
gal["builds"] = v("real", "pcs")
gal["textOut"] = e("real") + 0.4
parts = {"rest": v("rest"), "closer": [gal["end"] + 0.55, gal["end"] + 1.05]}
b_ = v("bsr", "build")
parts["labels"] = [b_ - 0.1 + 0.07 * i for i in range(5)]
parts["snaps"] = [b_ + 0.3 + 0.06 * i for i in range(5)]
parts["built"] = b_
parts["setup"] = v("bsr", "set")
parts["setupChips"] = [parts["setup"] + 0.2, parts["setup"] + 0.32, parts["setup"] + 0.44]
parts["off"] = v("bsr", "ready") + 0.38  # "…to use": the RGB drops out, a beat,
parts["click"] = e("bsr") + 0.06  # CLICK
parts["ready"] = parts["click"] + 0.03  # READY.
parts["hold"] = parts["click"] + 0.45

# ------------------------------------------------------------------ 8. back to the workstation → into the site
ret = {"glow": [parts["hold"], parts["hold"] + 0.32], "pull": [parts["hold"] + 0.05, parts["hold"] + 0.58]}
ret["approach"] = [ret["pull"][1] - 0.06, ret["pull"][1] + 0.44]
ret["cta0"] = parts["hold"] + 0.12
fly = [ret["approach"][1], ret["approach"][1] + 0.42]
put("cta", fly[1] - 0.5)  # "Ready to build yours?" as we fly into the site; YOURS? lands on the full-screen page
put("visit", e("cta") + GAP)
cta = {"words": {"ready": max(v("cta", "ready"), fly[1]), "to": max(v("cta", "to"), fly[1] + 0.12), "yours": max(v("cta", "yours"), fly[1] + 0.24)},
       "hover": max(v("cta", "build") + 0.05, fly[1] + 0.3),
       "url": v("visit", "mone") - 0.05}

# ------------------------------------------------------------------ 9. the signature: halves → clash → M1 GAMING PCS → DOHA • QATAR → monepcs.qa → hold
sig_start = v("visit", "mone") + 0.62  # the address is on screen while he says it
sig = {"fade": [sig_start, sig_start + 0.25], "split": sig_start + 0.28}
sig["fly"] = [sig["split"] + 0.02, sig["split"] + 0.44]
sig["merge"] = [sig["fly"][1] + 0.03, sig["fly"][1] + 0.55]
sig["lock"] = sig["merge"][1]
sig["dip"] = [sig["lock"] - 0.2, sig["lock"]]
sig["yellow"] = [sig["lock"] + 0.04, sig["lock"] + 0.26]
sig["wordmark"] = [sig["lock"] + 0.16, sig["lock"] + 0.44]
sig["gaming"] = sig["lock"] + 0.26
sig["sweep"] = [sig["lock"] + 0.5, sig["lock"] + 0.8]
sig["doha"] = sig["lock"] + 0.36
sig["url"] = sig["lock"] + 0.48
sig["settled"] = sig["url"] + 0.32
duration = round(max(sig["settled"] + 1.2, VO["visit"]["end"] + 0.4), 2)  # M1 + DOHA • QATAR + monepcs.qa held ~1.2 s

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
    y = resample_poly(x, SR, sr)
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


# clarity, not weight (no compression): 80 Hz high-pass, −1.5 dB low shelf at 180 Hz, +1.5 dB presence shelf from 2.8 kHz
from scipy.signal import butter, sosfilt  # noqa: E402

track = sosfilt(butter(2, 80, "hp", fs=SR, output="sos"), track)
track = shelf(shelf(track, 180, -1.5, "low"), 2800, 1.5, "high")
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
    "# M1 Gaming PCs — final voiceover (as used, v10: tech-presenter read)",
    "",
    f"Voice: **Kokoro-82M v1.0** (offline neural TTS, Apache-2.0), voice **`{VOICE}`** (male, young-adult American English, normal speaking register ~139 Hz),",
    f"per-line speed {min(LINES[l]['speed'] for l in order)}–{max(LINES[l]['speed'] for l in order)} (listed below), clause pause 0.16 s;" " each line's speed set so every line runs at the same ~4.4 syllables/s;",
    "clarity EQ only (80 Hz high-pass, −1.5 dB below 180 Hz, +1.5 dB presence above 2.8 kHz) — no compression, no limiting on the stem.",
    f"Pace: {words} words — {words / speech * 60:.0f} wpm within sentences, {words / (speech + GAP * (len(order) - 1)) * 60:.0f} wpm as continuous speech with the sentence breaths, {words / span * 60:.0f} wpm over the whole film (the picture-only moments included).",
    "",
    "| # | In | Out | Speed | Line |",
    "|---|---|---|---|---|",
]
for k, l in enumerate(order, 1):
    md.append(f"| {k} | {VO[l]['start']:.2f} s | {VO[l]['end']:.2f} s | {LINES[l]['speed']} | {LINES[l]['text']} |")
md += [
    "",
    "Sentences follow each other with a short breath (~0.1–0.2 s); the only longer gaps are where the picture carries the story "
    "(the WhatsApp icon flight, ORDER CONFIRMED., the build flight, the return to the workstation).",
    "",
    "Pronunciation (fixed at phoneme level, then checked by transcribing every line back with an offline Whisper model):",
    "Qatar = “KUH-tar” (kˈʌtɑːɹ) · M1 = “em one” · WhatsApp = one word, “WOTS-app” · U.S. = “the you-ess” · monepcs.qa = “M-one P-Cs dot Q-A”.",
    "",
]
open(os.path.join(HERE, "script_final.md"), "w").write("\n".join(md))
