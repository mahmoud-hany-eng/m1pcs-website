"""The female master reference for v12: vo/lines/female_ref/<id>.wav.

Her lines exactly as heard in the v8 cut — the v8 af_heart takes (vo/lines/af_heart, made by vo/tts.py
with the v8 script, commit a62d436) with the pauses that cut widened (WIDEN: (from s, to s, extra silence s)
inserted mid-pause) — plus her reading of the new opening line (af_heart, speed 0.9).
vo/match_female.py then performs the male voice on these.
"""
import json
import os

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, "lines", "af_heart"), os.path.join(HERE, "lines", "female_ref")
WIDEN = {"tell": [(1.05, 1.30, 0.35), (2.50, 2.58, 0.35), (3.17, 3.42, 0.35)], "source": [(3.55, 3.91, 0.45)]}
HOOK = "Your next PC shouldn't start with a preset. It should start with you."

os.makedirs(OUT, exist_ok=True)
for l in json.load(open(os.path.join(SRC, "meta.json")))["lines"]:
    if l["id"] == "q":
        continue  # the old opening question is replaced by the hook
    x, sr = sf.read(os.path.join(SRC, l["id"] + ".wav"))
    pieces, last = [], 0
    for a, b, extra in WIDEN.get(l["id"], []):
        mid = int((a + b) / 2 * sr)
        pieces += [x[last:mid], np.zeros(int(extra * sr))]
        last = mid
    pieces.append(x[last:])
    sf.write(os.path.join(OUT, l["id"] + ".wav"), np.concatenate(pieces), sr, subtype="PCM_24")
k = Kokoro("/home/user/tts/kokoro-v1.0.onnx", "/home/user/tts/voices-v1.0.bin")
a, sr = k.create(k.tokenizer.phonemize(HOOK, "en-us"), voice="af_heart", speed=0.9, is_phonemes=True, clause_pause=0.14)
sf.write(os.path.join(OUT, "q.wav"), a, sr, subtype="PCM_24")
print("female reference →", OUT)
