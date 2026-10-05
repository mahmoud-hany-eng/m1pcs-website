"""v8–v12 timeline — cut AROUND the voiceover.

1. Places every narration line on the timeline.
2. Derives every picture / capture / audio cue from the narration's keyword onsets and writes them
   to timeline.json["v8"] (read by the captures, the Remotion composition and audio/score_v8.py).
3. Writes the voice track (public/audio/vo8.wav).

v12: the narrator is a mature male read (vo/lines/male_mature, made by vo/match_female.py) performed on
the FEMALE v8 read: every line has her length (±2 %) and her pause pattern, and the lines are placed with
her gaps between sentences (FEMALE_GAP, measured from the v8 cut). The picture follows the voice; where
the picture needs a minimum (a choice must read before the next one, the 13-build flight is 7.0 s, …)
that is a max() and the deviation from her gap is reported.
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
VO_DIR = os.path.join(HERE, os.environ.get("VO_DIR", "lines/male_mature"))
IS_MODEL = "model" in os.path.basename(VO_DIR)
VOICE = "Kokoro-82M v1.0 style blend am_fenrir:3+am_onyx:2 (mature male), performed on the v8 female read"
SR = 48000


def line_audio(lid):
    x, sr = sf.read(os.path.join(VO_DIR, lid + ".wav"))
    if x.ndim > 1:
        x = x.mean(1)
    x = resample_poly(x, SR, sr) if sr != SR else x
    idx = np.where(np.abs(x) > 0.01 * max(1e-6, np.abs(x).max()) / 0.3)[0]
    a = max(0, idx[0] - int(0.03 * SR))
    return x[a : idx[-1] + int(0.08 * SR)], a / SR  # (audio from 30 ms before the first sound, where that is in the file)


# keyword onsets (s into each line file): DTW of each spoken prefix against the line (vo/align.py), every
# value checked by cutting the line there and transcribing both halves (offline Whisper); the few where
# DTW slipped by a word were re-found at the word boundary the transcription confirms. → onsets.json
LEAD = {}
AUDIO = {}
ONSETS = json.load(open(os.path.join(VO_DIR, "onsets.json")))
for lid in ONSETS:
    AUDIO[lid], LEAD[lid] = line_audio(lid)

VO = {}
START = {}
# the female v8 cut: where each line began, and the silence before it (s) — the master timing
FEMALE_START = {"q": 0.40, "show": 4.05, "starts": 7.35, "tell": 10.55, "turn": 16.55, "send": 19.85, "confirm": 23.95, "source": 30.05,
                "real": 37.60, "rest": 42.10, "build": 44.50, "setup": 46.05, "ready": 47.60, "next": 51.20, "cta": 53.50, "visit": 55.20}
FEMALE_GAP = {"show": 0.79, "starts": 1.19, "tell": 1.28, "turn": 0.34, "send": 0.34, "confirm": 0.52, "source": 1.02, "real": 1.83,
              "rest": 0.81, "build": 0.40, "setup": 0.48, "ready": 0.51, "next": 1.72, "cta": 0.85, "visit": 0.34}
GAP_NOTE = {}


def put(lid, st):
    """place a narration line so its first sound is at st (s)"""
    y = AUDIO[lid]
    START[lid] = round(st, 3)
    VO[lid] = {"start": round(st, 3), "end": round(st + len(y) / SR - 0.08, 3),
               "kw": {w: round(st + x - LEAD[lid], 3) for w, x in ONSETS[lid].items()}}  # onsets are file-relative


v = lambda lid, w=None: VO[lid]["kw"][w] if w else VO[lid]["start"]
e = lambda lid: VO[lid]["end"]
_prev = []


def after(lid, *floors, why=""):
    """place lid her gap after the previous line — or later, if the picture needs it (floors are start times)"""
    prev = _prev[-1]
    st = e(prev) + FEMALE_GAP[lid]
    fl = max(floors) if floors else -1
    if fl > st + 0.005:
        GAP_NOTE[lid] = f"+{fl - st:.2f} s ({why})"
        st = fl
    put(lid, st)
    _prev.append(lid)


# ------------------------------------------------------------------ 0. the hook → YOU → the brand
# YOUR NEXT PC / SHOULDN'T START / WITH A PRESET. — then IT SHOULD START / WITH / YOU. (big, M1 yellow);
# YOU collapses into the two halves of the emblem, which strike together in one 0.82 s move — the clash —
# M1 GAMING PCS + DOHA • QATAR readable, then the logo becomes the monitor.
put("q", FEMALE_START["q"])
_prev.append("q")
W = {w.lower(): v("q", w) for w in ["next", "pc", "shouldnt", "start1", "with1", "preset", "it", "should2", "start2", "with2", "you"]}
W["your"] = v("q")
intro = {"words": W}
intro["collapse"] = [W["you"] + 0.42, W["you"] + 0.74]  # YOU. lands, reads, then becomes the emblem
intro["halvesIn"] = [intro["collapse"][0] + 0.18, intro["collapse"][0] + 0.36]
intro["merge"] = [intro["halvesIn"][1], intro["halvesIn"][1] + 0.82]
intro["contact"] = intro["merge"][1]
intro["spark"] = intro["contact"]
intro["fill"] = [intro["contact"], intro["contact"]]
intro["wm"] = [intro["contact"] + 0.06, intro["contact"] + 0.32]
intro["doha"] = [intro["contact"] + 0.14, intro["contact"] + 0.4]
p0 = intro["contact"] + 1.2  # the finished brand (M1 GAMING PCs + DOHA • QATAR) reads ~0.9 s
intro["hold"] = [intro["wm"][1], p0 + 0.05]
intro["dohaOut"] = [p0 - 0.06, p0 + 0.12]
intro["pressure"] = [p0, p0 + 0.12]
intro["expand"] = [p0 + 0.12, p0 + 0.76]
intro["materialize"] = [p0 + 0.6, p0 + 1.02]
intro["powerOn"] = [p0 + 0.92, p0 + 1.18]
intro["pullBack"] = [p0 + 1.0, p0 + 2.0]
after("show", intro["contact"] + 0.06, why="the clash plays clean before he speaks")

# ------------------------------------------------------------------ 1. the homepage → Build Your PC
after("starts", intro["pullBack"][1] - 0.3, why="the homepage is on screen")
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
after("tell", quote["scroll1"][1] + 0.42 - (ONSETS["tell"]["play"] - LEAD["tell"]), why="the form is on screen before 'play'")
g = v("tell", "play")
quote["gaming"] = {"path": [g - 0.42, g - 0.04], "press": g, "release": g + 0.07}
quote["games"] = {"path": [g + 0.1, g + 0.3], "press": g + 0.33, "release": g + 0.38, "type": [g + 0.42, g + 0.78], "text": "Valorant, CS2"}
pf = v("tell", "performance")
r0 = max(pf + 0.02, quote["games"]["type"][1] + 0.04)
quote["res"] = {"path": [r0, r0 + 0.22], "press": r0 + 0.26, "release": r0 + 0.32}
quote["fps"] = {"path": [r0 + 0.5, r0 + 0.7], "press": r0 + 0.74, "release": r0 + 0.8}  # 1440p reads ~0.5 s before 144+
bd = v("tell", "budget")
quote["budget"] = {"path": [max(r0 + 0.86, bd - 0.36), bd], "press": bd + 0.04, "release": bd + 0.1, "type": [bd + 0.14, bd + 0.44], "text": "12000"}
lk = v("tell", "look")
quote["colour"] = {"path": [quote["budget"]["type"][1] + 0.04, max(lk + 0.04, quote["budget"]["type"][1] + 0.34)], "press": 0, "release": 0}
quote["colour"]["press"] = quote["colour"]["path"][1] + 0.04
quote["colour"]["release"] = quote["colour"]["press"] + 0.07

# ------------------------------------------------------------------ 3. the custom quotation — it visibly completes, then holds
after("turn", quote["colour"]["release"] + 0.45, why="White reads before the quote forms")
tu = v("turn")
quote["consolidate"] = [tu + 0.05, tu + 0.6]
quote["card"] = tu + 0.6
bt = v("turn", "build")
quote["lines"] = [quote["card"] + 0.14 + 0.15 * i for i in range(4)]
quote["price"] = max(bt + 0.1, quote["lines"][3] + 0.25)
quote["lift"] = [tu + 0.5, e("turn") + 0.45]
# ------------------------------------------------------------------ 4. → WhatsApp: the quote leaves the monitor, travels, the phone wakes
after("send")
sk = v("send", "send")
quote["send"] = {"path": [sk - 0.45, sk - 0.03], "press": sk + 0.02, "release": sk + 0.09}
quote["scroll3"] = [quote["send"]["path"][0] - 0.62, quote["send"]["path"][0] - 0.04]
quote["attach"] = [sk - 0.62, sk - 0.08]  # completed card → compact attachment
quote["captureEnd"] = quote["send"]["release"] + 0.4
wa = v("send", "WhatsApp")
toPhone = {"lift": [wa - 0.25, wa + 0.05], "icon": [wa + 0.05, wa + 1.0], "camera": [wa - 0.45, wa + 1.45]}
toPhone["wake"] = toPhone["icon"][1]

# ------------------------------------------------------------------ 5. WhatsApp: quote → price/availability ✓ → deposit → ORDER CONFIRMED.
after("confirm", toPhone["wake"] - 0.1, why="the phone is awake")
c = v("confirm")
pr, av = v("confirm", "pricing"), v("confirm", "availability")
chat = {"attach": toPhone["wake"] + 0.1}
chat["proceed"] = max(c + 0.1, chat["attach"] + 0.45)
chat["typing"] = chat["proceed"] + 0.25
chat["reply"] = max(pr - 0.2, chat["typing"] + 0.35)
r_ = chat["reply"]
chat["tokens"] = [r_ + 0.15, r_ + 0.35, max(av - 0.05, r_ + 0.55)]
chat["checks"] = [chat["tokens"][0] + 0.22, max(av - 0.1, chat["tokens"][1] + 0.22), max(av + 0.22, chat["tokens"][2] + 0.22)]
chat["collapse"] = [chat["checks"][2] + 0.2, chat["checks"][2] + 0.42]
chat["order"] = max(v("confirm", "deposit") - 0.1, chat["collapse"][1] + 0.1)
chat["paid"] = max(v("confirm", "order") - 0.55, chat["order"] + 0.5)
chat["done"] = max(v("confirm", "order") - 0.05, chat["paid"] + 0.3)
chat["payoff"] = [chat["done"] + 0.08, chat["done"] + 0.5]
after("source")  # her 1.0 s beat: ORDER CONFIRMED. registers before the narrator moves on
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

# ------------------------------------------------------------------ 7. all 13 builds — ONE camera journey (7.0 s) → the flagship → BUILT / SET UP / READY
gal = {"start": route["fan"][1] - 0.15}
gal["end"] = gal["start"] + 7.0
after("real", gal["start"] + 0.5, why="the flight has begun")  # "These are real PCs…" over the builds
after("rest")  # "Then M1 takes care of the rest." as the flight lands on the flagship
after("build", gal["end"] + 1.2 - (ONSETS["build"]["build"] - LEAD["build"]), why="the flagship settles ~1.2 s before BUILT")
after("setup")
after("ready")
gal["real"] = v("real", "real")
gal["builds"] = v("real", "pcs")
gal["textOut"] = e("real") + 0.5
parts = {"rest": v("rest"), "closer": [gal["end"] + 0.6, gal["end"] + 1.15]}
b_ = v("build", "build")
parts["labels"] = [b_ - 0.1 + 0.08 * i for i in range(5)]
parts["snaps"] = [b_ + 0.34 + 0.07 * i for i in range(5)]
parts["built"] = b_
parts["setup"] = v("setup", "set")
parts["setupChips"] = [parts["setup"] + 0.22, parts["setup"] + 0.36, parts["setup"] + 0.5]
parts["off"] = v("ready", "ready") - 0.5  # "…make sure it's": the RGB drops out —
parts["click"] = v("ready", "ready") - 0.03  # "READY": CLICK, it all comes on
parts["ready"] = parts["click"] + 0.03
parts["hold"] = max(e("ready") + 0.8, parts["ready"] + 1.1)  # READY. gets its beat (music / SFX, no voice)

# ------------------------------------------------------------------ 8. back to the workstation ("…and yours could be next") → into the site
ret = {"glow": [parts["hold"], parts["hold"] + 0.45], "pull": [parts["hold"] + 0.06, parts["hold"] + 0.96]}
ret["approach"] = [ret["pull"][1] - 0.08, ret["pull"][1] + 0.62]
ret["cta0"] = parts["hold"] + 0.15
fly = [ret["approach"][1], ret["approach"][1] + 0.5]
after("next")
after("cta", fly[1] + 0.35, why="the site is full screen")  # READY → TO BUILD → YOURS?
after("visit")
cta = {"words": {"ready": v("cta", "ready"), "to": v("cta", "to"), "yours": v("cta", "yours")}, "hover": v("cta", "build") + 0.05,
       "url": v("visit", "mone") - 0.05}

# ------------------------------------------------------------------ 9. website → M1 logo → M1 GAMING PCS → DOHA • QATAR → monepcs.qa → hold
sig_start = e("visit") + 0.05  # the address is on screen while he says it
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
sf.write(os.path.join(ROOT, "public", "audio", "vo8.wav"), track, SR, subtype="PCM_24")
stale = os.path.join(ROOT, "public", "audio", "vo8_timing_model.wav")
if os.path.exists(stale):
    os.remove(stale)
print("duration", duration, "| voice:", VOICE)
for lid in sorted(START, key=START.get):
    print(f"{lid:8s} {VO[lid]['start']:6.2f} – {VO[lid]['end']:6.2f}  ", {k: round(t, 2) for k, t in VO[lid]['kw'].items()})

# ------------------------------------------------------------------ the script + timing sheet (vo/script_final.md)
LINES = {l["id"]: l for l in json.load(open(os.path.join(HERE, "lines.json")))}
REP = json.load(open(os.path.join(VO_DIR, "report.json")))["lines"]
order = sorted(START, key=START.get)
words = sum(len(LINES[l]["text"].split()) for l in order)
md = [
    "# M1 Gaming PCs — final voiceover script (v12)",
    "",
    "Narrator: mature male (Kokoro-82M v1.0, style blend 60 % am_fenrir + 40 % am_onyx), performed on the **female v8 read** "
    "(Kokoro af_heart) as the master: each line has her length (±2 %) and her pauses (vo/match_female.py), and the lines sit "
    "with her gaps between them. Only the opening line is new; the rest is her script word for word.",
    "",
    f"{words} words · film {duration:.2f} s.",
    "",
    "| # | Line | Her length | His length | Her gap before | His gap before | Timing deviation (median / p90) |",
    "|---|---|---|---|---|---|---|",
]
for i, lid in enumerate(order, 1):
    r = REP[lid]
    gap = "" if i == 1 else f"{VO[lid]['start'] - VO[order[i - 2]]['end']:.2f} s" + (f" — {GAP_NOTE[lid]}" if lid in GAP_NOTE else "")
    md.append(f"| {i} | {LINES[lid]['text']} | {r['female_s']:.2f} s | {r['male_s']:.2f} s | "
              f"{'' if i == 1 else f'{FEMALE_GAP[lid]:.2f} s'} | {gap} | {r['timing_dev_median_s']:.2f} / {r['timing_dev_p90_s']:.2f} s |")
md += [
    "",
    "Timing deviation: his line DTW-aligned to hers — how far each of his sounds falls from the same sound in her read.",
    "A gap longer than hers is a local picture need (named in the row); no line is sped up or slowed down globally.",
    "",
    "Pronunciation: Qatar = “KUH-tar” · M1 = “em one” · WhatsApp = one word · the U.S. = “the you-ess” · "
    "monepcs.qa = “M-one P-Cs dot Q-A”.",
    "",
]
open(os.path.join(HERE, "script_final.md"), "w").write("\n".join(md))
