"""v8–v11 timeline — cut AROUND the voiceover.

1. Places every narration line on the timeline (a short natural beat between sentences; a few
   deliberate visual/SFX breaths where the picture carries the story).
2. Derives every picture / capture / audio cue from the narration's keyword onsets and writes them
   to timeline.json["v8"] (read by the captures, the Remotion composition and audio/score_v8.py).
3. Writes the voice track.

v11: the narrator is GRADY (Higgsfield preset). Higgsfield is not reachable from the build
environment, so until Grady's lines are delivered the edit is timed to a TIMING MODEL — an
offline read of the same script at the target pace (~4.1 syllables/s, a natural presenter
rate) in vo/lines/model_fenrir. The model is only a ruler: its audio is written to
public/audio/vo8_timing_model.wav (used for nothing but the bed's ducking envelope) and is never
mixed into a deliverable. With Grady's files in vo/lines/grady (see vo/grady.py), set
VO_DIR=lines/grady and the same script re-times the edit to his real read.
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
VO_DIR = os.path.join(HERE, os.environ.get("VO_DIR", "lines/model_fenrir"))
IS_MODEL = "model" in os.path.basename(VO_DIR)
VOICE = "Grady (Higgsfield preset)" if not IS_MODEL else "timing model (not a deliverable voice)"
SR = 48000


def line_audio(lid):
    x, sr = sf.read(os.path.join(VO_DIR, lid + ".wav"))
    if x.ndim > 1:
        x = x.mean(1)
    x = resample_poly(x, SR, sr) if sr != SR else x
    idx = np.where(np.abs(x) > 0.01 * max(1e-6, np.abs(x).max()) / 0.3)[0]
    a = max(0, idx[0] - int(0.03 * SR))
    return x[a : idx[-1] + int(0.08 * SR)], a / SR  # (audio from 30 ms before the first sound, where that is in the file)


# keyword onsets (s into each line, measured from the line's first sound). Timing model: DTW of each
# spoken prefix against the line (vo/align.py) + an ASR scan (vo/onsets.py), each value checked by
# cutting the line there and transcribing both halves. Grady: vo/grady.py writes onsets.json.
MODEL_ONSETS = {
    "q": {"are": 0.02, "you": 0.30, "in": 0.55, "Qatar": 0.72, "and": 1.32, "looking": 1.48, "build": 1.92, "PC": 2.25},
    "show": {"show": 0.33, "properly": 1.12},
    "starts": {"m1": 0.22, "build": 0.92, "starts": 1.24, "with": 1.48, "you": 1.70},
    "tell": {"play": 0.79, "performance": 1.46, "budget": 2.94, "style": 3.67},
    "turn": {"choices": 0.55, "custom": 1.55, "quotation": 2.08},
    "send": {"ready": 0.42, "send": 0.92, "WhatsApp": 1.61},
    "confirm": {"price": 1.40, "availability": 2.12, "deposit": 3.58, "confirms": 4.29, "order": 5.00},
    "source": {"source": 0.45, "directly": 2.16, "us": 2.95, "US": 2.95, "ship": 3.90, "Qatar": 4.59},
    "rest": {"m1": 0.62, "rest": 1.64},
    "real": {"real": 0.52, "pcs": 0.99, "PCs": 0.99, "built": 2.28, "customers": 2.92},
    "next": {"yours": 0.25, "next": 0.80},
    "bsr": {"build": 0.25, "set": 0.94, "ready": 2.10},
    "cta": {"ready": 0.02, "to": 0.27, "build": 0.37, "yours": 0.76},
    "visit": {"mone": 0.40},
}
LEAD = {}
AUDIO = {}
ONSETS = MODEL_ONSETS
if not IS_MODEL:
    ONSETS = json.load(open(os.path.join(VO_DIR, "onsets.json")))
    ONSETS["source"]["US"] = ONSETS["source"]["us"]
    ONSETS["real"]["PCs"] = ONSETS["real"]["pcs"]
for lid in ONSETS:
    AUDIO[lid], LEAD[lid] = line_audio(lid)

VO = {}
START = {}


def put(lid, st):
    """place a narration line so its first sound is at st (s)"""
    y = AUDIO[lid]
    START[lid] = round(st, 3)
    VO[lid] = {"start": round(st, 3), "end": round(st + len(y) / SR - 0.08, 3),
               "kw": {w: round(st + x - LEAD[lid], 3) for w, x in ONSETS[lid].items()}}  # onsets are file-relative


v = lambda lid, w=None: VO[lid]["kw"][w] if w else VO[lid]["start"]
e = lambda lid: VO[lid]["end"]
BEAT = 0.3  # the natural beat between sentences

# ------------------------------------------------------------------ 0. the question → the brand (~5.5 s)
# ARE YOU IN / QATAR? / LOOKING TO / BUILD A PC? land on the spoken words and stay readable; then the
# letters collapse into the two halves of the emblem, which strike together in one 0.8 s move —
# the clash — M1 GAMING PCS + DOHA • QATAR readable ~0.85 s, then the logo becomes the monitor.
put("q", 0.25)
W = {w.lower(): v("q", w) for w in ["are", "you", "in", "Qatar", "looking", "build", "PC"]}
intro = {"words": W}
intro["collapse"] = [W["pc"] + 0.5, W["pc"] + 0.85]  # BUILD A PC? readable ~0.5 s after it has landed
intro["halvesIn"] = [intro["collapse"][0] + 0.2, intro["collapse"][0] + 0.38]
intro["merge"] = [intro["halvesIn"][1], intro["halvesIn"][1] + 0.82]
intro["contact"] = intro["merge"][1]
intro["spark"] = intro["contact"]
intro["fill"] = [intro["contact"], intro["contact"]]
intro["wm"] = [intro["contact"] + 0.06, intro["contact"] + 0.32]
intro["doha"] = [intro["contact"] + 0.14, intro["contact"] + 0.4]
p0 = intro["contact"] + 1.25  # the finished brand reads ~0.85 s
intro["hold"] = [intro["wm"][1], p0 + 0.05]
intro["dohaOut"] = [p0 - 0.06, p0 + 0.12]
intro["pressure"] = [p0, p0 + 0.12]
intro["expand"] = [p0 + 0.12, p0 + 0.76]
intro["materialize"] = [p0 + 0.6, p0 + 1.02]
intro["powerOn"] = [p0 + 0.92, p0 + 1.18]
intro["pullBack"] = [p0 + 1.0, p0 + 2.0]
put("show", intro["contact"] + 0.06)  # "Let us show you how it's properly done." right after the clash

# ------------------------------------------------------------------ 1. the homepage → Build Your PC
put("starts", e("show") + BEAT)
starts = {"words": {"starts": v("starts", "starts"), "with": v("starts", "with"), "you": v("starts", "you")}, "out": e("starts") + 0.45}
home = {"captureStart": intro["powerOn"][0] - 0.02, "approach": [intro["pullBack"][1] - 0.2, e("starts") + 0.2]}
home["cursorIn"] = [v("starts", "you") - 1.25, v("starts", "you") - 0.04]
home["hover"] = home["cursorIn"][1]
home["press"] = v("starts", "you") + 0.03
home["release"] = home["press"] + 0.08

# ------------------------------------------------------------------ 2. Build My PC — one fluid sequence, each choice on its words
rel = home["release"]
quote = {"settle": [rel + 0.05, rel + 0.4], "build": {"path": [rel + 0.16, rel + 0.46], "press": rel + 0.52, "release": rel + 0.58}}
quote["scroll1"] = [quote["build"]["release"] + 0.08, quote["build"]["release"] + 0.6]
put("tell", max(e("starts") + BEAT, quote["scroll1"][1] + 0.42 - ONSETS["tell"]["play"]))
g = v("tell", "play")
quote["gaming"] = {"path": [g - 0.42, g - 0.04], "press": g, "release": g + 0.07}
quote["games"] = {"path": [g + 0.1, g + 0.3], "press": g + 0.33, "release": g + 0.38, "type": [g + 0.42, g + 0.78], "text": "Valorant, CS2"}
pf = v("tell", "performance")
r0 = max(pf + 0.02, quote["games"]["type"][1] + 0.04)
quote["res"] = {"path": [r0, r0 + 0.22], "press": r0 + 0.26, "release": r0 + 0.32}
quote["fps"] = {"path": [r0 + 0.5, r0 + 0.7], "press": r0 + 0.74, "release": r0 + 0.8}  # 1440p reads ~0.5 s before 144+
bd = v("tell", "budget")
quote["budget"] = {"path": [max(r0 + 0.86, bd - 0.36), bd], "press": bd + 0.04, "release": bd + 0.1, "type": [bd + 0.14, bd + 0.44], "text": "12000"}
lk = v("tell", "style")
quote["colour"] = {"path": [quote["budget"]["type"][1] + 0.04, max(lk + 0.04, quote["budget"]["type"][1] + 0.34)], "press": 0, "release": 0}
quote["colour"]["press"] = quote["colour"]["path"][1] + 0.04
quote["colour"]["release"] = quote["colour"]["press"] + 0.07

# ------------------------------------------------------------------ 3. the custom quotation — it visibly completes, then holds
put("turn", max(e("tell") + BEAT, quote["colour"]["release"] + 0.55))  # White reads ~0.6 s before the quote forms
tu = v("turn")
quote["consolidate"] = [tu + 0.05, tu + 0.6]
quote["card"] = tu + 0.6
cu = v("turn", "custom")
quote["lines"] = [quote["card"] + 0.14 + 0.15 * i for i in range(4)]
quote["price"] = max(cu, quote["lines"][3] + 0.25)
quote["lift"] = [tu + 0.5, e("turn") + 0.45]
# ------------------------------------------------------------------ 4. → WhatsApp: the quote leaves the monitor, travels, the phone wakes
put("send", e("turn") + BEAT)
sk = v("send", "send")
quote["send"] = {"path": [sk - 0.45, sk - 0.03], "press": sk + 0.02, "release": sk + 0.09}
quote["scroll3"] = [quote["send"]["path"][0] - 0.62, quote["send"]["path"][0] - 0.04]
quote["attach"] = [sk - 0.62, sk - 0.08]  # completed card → compact attachment (the card has read ≥ 0.8 s)
quote["captureEnd"] = quote["send"]["release"] + 0.4
wa = v("send", "WhatsApp")
toPhone = {"lift": [wa - 0.25, wa + 0.05], "icon": [wa + 0.05, wa + 1.0], "camera": [wa - 0.45, wa + 1.45]}
toPhone["wake"] = toPhone["icon"][1]

# ------------------------------------------------------------------ 5. WhatsApp: quote → price/availability ✓ → deposit → ORDER CONFIRMED.
put("confirm", max(e("send") + BEAT, toPhone["wake"] - 0.1))
c = v("confirm")
pr, av = v("confirm", "price"), v("confirm", "availability")
chat = {"attach": toPhone["wake"] + 0.1}
chat["proceed"] = max(c + 0.1, chat["attach"] + 0.45)
chat["typing"] = chat["proceed"] + 0.25
chat["reply"] = max(pr - 0.2, chat["typing"] + 0.35)
r_ = chat["reply"]
chat["tokens"] = [r_ + 0.15, r_ + 0.35, max(av - 0.05, r_ + 0.55)]
chat["checks"] = [chat["tokens"][0] + 0.22, max(av - 0.1, chat["tokens"][1] + 0.22), max(av + 0.22, chat["tokens"][2] + 0.22)]
chat["collapse"] = [chat["checks"][2] + 0.2, chat["checks"][2] + 0.42]
chat["order"] = v("confirm", "deposit") - 0.1
chat["paid"] = max(v("confirm", "confirms") - 0.25, chat["order"] + 0.5)
chat["done"] = v("confirm", "order") - 0.05
chat["payoff"] = [chat["done"] + 0.08, chat["done"] + 0.5]
put("source", e("confirm") + 0.65)  # a visual beat: ORDER CONFIRMED. registers (~1.3 s) before the narrator moves on
chat["orderText"] = [v("confirm", "order") - 0.02, v("source") + 0.3]
chat["push"] = v("source") - 0.12
chat["front"] = [chat["attach"] + 0.15, pr]

# ------------------------------------------------------------------ 6. U.S. → Qatar (real travel) → breath → the RGB fan
route = {"stroke": [chat["push"], chat["push"] + 0.65], "head": chat["push"] + 0.35, "parcel": v("source", "us") + 0.15}
route["words"] = {"sourced": v("source", "source"), "directly": v("source", "directly"), "us": v("source", "us")}
route["us"] = v("source", "us") + 0.05
route["travel"] = [v("source", "us") + 0.35, v("source", "Qatar") - 0.04]
route["arrive"] = v("source", "Qatar")
route["qatarWord"] = v("source", "Qatar")
route["fan"] = [route["arrive"] + 0.55, route["arrive"] + 1.15]

# ------------------------------------------------------------------ 7. all 13 builds — ONE camera journey (~7 s) → the flagship settles ~1.25 s
gal = {"start": route["fan"][1] - 0.15}
gal["end"] = gal["start"] + 7.0
put("rest", max(e("source") + 0.5, gal["start"] - 0.3))  # "From there, M1 handles the rest." as the flight begins
put("real", e("rest") + BEAT)
put("next", e("real") + BEAT)  # "…and yours could be next." as the flagship arrives
put("bsr", max(gal["end"] + 1.25, e("next") + BEAT) - ONSETS["bsr"]["build"])  # BUILT. on "build"
gal["real"] = v("real", "real")
gal["builds"] = v("real", "pcs")
gal["textOut"] = e("real") + 0.5
parts = {"rest": v("rest"), "closer": [gal["end"] + 0.6, gal["end"] + 1.15]}
b_ = v("bsr", "build")
parts["labels"] = [b_ - 0.1 + 0.08 * i for i in range(5)]
parts["snaps"] = [b_ + 0.34 + 0.07 * i for i in range(5)]
parts["built"] = b_
parts["setup"] = v("bsr", "set")
parts["setupChips"] = [parts["setup"] + 0.22, parts["setup"] + 0.36, parts["setup"] + 0.5]
parts["off"] = v("bsr", "ready") - 0.5  # "…and get it": the RGB drops out —
parts["click"] = v("bsr", "ready") - 0.03  # "READY": CLICK, it all comes on
parts["ready"] = parts["click"] + 0.03
parts["hold"] = max(e("bsr") + 0.5, parts["ready"] + 1.1)  # READY. gets its beat (music / SFX, no voice)

# ------------------------------------------------------------------ 8. back to the workstation → into the site
ret = {"glow": [parts["hold"], parts["hold"] + 0.38], "pull": [parts["hold"] + 0.06, parts["hold"] + 0.76]}
ret["approach"] = [ret["pull"][1] - 0.08, ret["pull"][1] + 0.56]
ret["cta0"] = parts["hold"] + 0.15
fly = [ret["approach"][1], ret["approach"][1] + 0.46]
put("cta", fly[1] + 0.12)  # on the full-screen site: READY → TO BUILD → YOURS?
put("visit", e("cta") + 0.35)
cta = {"words": {"ready": v("cta", "ready"), "to": v("cta", "to"), "yours": v("cta", "yours")}, "hover": v("cta", "build") + 0.05,
       "url": v("visit", "mone") - 0.05}

# ------------------------------------------------------------------ 9. website → M1 logo → M1 GAMING PCS → DOHA • QATAR → monepcs.qa → hold
sig_start = v("visit", "mone") + 0.75  # the address is on screen while he says it
sig = {"fade": [sig_start, sig_start + 0.3], "split": sig_start + 0.33}
sig["fly"] = [sig["split"] + 0.02, sig["split"] + 0.55]
sig["merge"] = [sig["fly"][1] + 0.04, sig["fly"][1] + 0.68]
sig["lock"] = sig["merge"][1]
sig["dip"] = [sig["lock"] - 0.2, sig["lock"]]
sig["yellow"] = [sig["lock"] + 0.05, sig["lock"] + 0.32]
sig["wordmark"] = [sig["lock"] + 0.2, sig["lock"] + 0.5]
sig["gaming"] = sig["lock"] + 0.32
sig["sweep"] = [sig["lock"] + 0.6, sig["lock"] + 0.9]
sig["doha"] = sig["lock"] + 0.42
sig["url"] = sig["lock"] + 0.56
sig["settled"] = sig["url"] + 0.36
duration = round(sig["settled"] + 1.25, 2)  # M1 GAMING PCs + DOHA • QATAR + monepcs.qa held ~1.25 s

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

# ------------------------------------------------------------------ the voice track
track = np.zeros(int((duration + 0.5) * SR))
for lid, st in START.items():
    y = AUDIO[lid]
    i = int(st * SR)
    track[i : i + len(y)] += y[: max(0, len(track) - i)]
track = track[: int(duration * SR)]
os.makedirs(os.path.join(ROOT, "public", "audio"), exist_ok=True)
if IS_MODEL:
    # the ruler only: its envelope ducks the bed where Grady will speak; never mixed into a deliverable
    sf.write(os.path.join(ROOT, "public", "audio", "vo8_timing_model.wav"), track, SR, subtype="PCM_24")
    if os.path.exists(os.path.join(ROOT, "public", "audio", "vo8.wav")):
        os.remove(os.path.join(ROOT, "public", "audio", "vo8.wav"))
else:
    sf.write(os.path.join(ROOT, "public", "audio", "vo8.wav"), track, SR, subtype="PCM_24")
print("duration", duration, "| voice:", VOICE)
for lid in sorted(START, key=START.get):
    print(f"{lid:8s} {VO[lid]['start']:6.2f} – {VO[lid]['end']:6.2f}  ", {k: round(t, 2) for k, t in VO[lid]['kw'].items()})

# ------------------------------------------------------------------ the script / Grady slot sheet (vo/script_final.md)
LINES = {l["id"]: l for l in json.load(open(os.path.join(HERE, "lines.json")))}
order = sorted(START, key=START.get)
words = sum(len(LINES[l]["text"].split()) for l in order)
speech = sum(VO[l]["end"] - VO[l]["start"] for l in order)
span = VO[order[-1]]["end"] - VO[order[0]]["start"]
SYNC = {"q": ["Qatar", "build", "PC"], "show": ["properly"], "starts": ["starts", "you"], "tell": ["play", "performance", "budget", "style"],
        "turn": ["custom"], "send": ["send", "WhatsApp"], "confirm": ["price", "availability", "deposit", "order"],
        "source": ["source", "us", "Qatar"], "rest": ["rest"], "real": ["real", "pcs"], "next": ["next"], "bsr": ["build", "set", "ready"],
        "cta": ["ready", "to", "yours"], "visit": ["mone"]}
md = [
    "# M1 Gaming PCs — final voiceover script + Grady timing sheet (v11)",
    "",
    f"Narrator: **Grady** (Higgsfield preset). Status: **{'Grady delivered and placed' if not IS_MODEL else 'Grady still to be generated and inserted'}** — "
    "Higgsfield cannot be reached from the build environment, and no other voice is used in any deliverable.",
    "",
    f"The edit is timed to a natural presenter read of this script: {words} words, ~4.1 syllables/s inside sentences "
    f"(≈{words / speech * 60:.0f} wpm), a ~0.3 s beat between sentences (≈{words / (speech + BEAT * (len(order) - 1)) * 60:.0f} wpm "
    f"as continuous narration), {words / duration * 60:.0f} wpm averaged over the {duration:.1f} s film.",
    "Generate Grady at his natural, unhurried speed (the target is ~140 wpm as heard), one file per line, named as in the first column.",
    "",
    "| File | Slot in | Slot out | Line | Picture cues (word → time) |",
    "|---|---|---|---|---|",
]
for lid in order:
    cues = ", ".join(f"{w} {VO[lid]['kw'][w]:.2f}" for w in SYNC.get(lid, []) if w in VO[lid]["kw"])
    md.append(f"| `{lid}.wav` | {VO[lid]['start']:.2f} s | {VO[lid]['end']:.2f} s | {LINES[lid]['text']} | {cues} |")
md += [
    "",
    "Order note: “These are real PCs…” and “And yours could be next.” play over the 13-build flight and “We build it, set it up, "
    "and get it ready to use.” over the hero PC that follows it — the picture's order (builds → hero → BUILT / SET UP / READY).",
    "",
    "Deliberate breaths (music / SFX, no voice): the logo clash between the first two lines; after ORDER CONFIRMED.; Qatar → RGB fan; "
    "after READY.; the return to the workstation.",
    "",
    "Pronunciation to check in Grady's read: Qatar = “KUH-tar” · M1 = “em one” · WhatsApp = one word · U.S. = “the you-ess” · "
    "monepcs.qa = “M-one P-Cs dot Q-A”.",
    "",
]
open(os.path.join(HERE, "script_final.md"), "w").write("\n".join(md))
