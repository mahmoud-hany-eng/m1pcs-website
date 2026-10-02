"""Voiceover: Kokoro-82M (Apache-2.0, offline ONNX) — one WAV per line so the edit
can be cut around the narration. Pronunciation of the brand words is fixed at the
phoneme level (Qatar, M1, WhatsApp, U.S., monepcs.qa)."""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
TTS = "/home/user/tts"
voice = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
speed_override = float(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "-" else None
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, "lines", voice)
os.makedirs(out, exist_ok=True)
k = Kokoro(os.path.join(TTS, "kokoro-v1.0.onnx"), os.path.join(TTS, "voices-v1.0.bin"))

FIX = [
    ("kˈæɾɑːɹ", "kˈʌtɑːɹ"),            # Qatar → "KUH-tar"
    ("wʌts ˈæp", "wˈɑtsæp"),           # WhatsApp as one word
    ("jˈuː.ˈɛs.", "ðə jˌuːˈɛs."),       # the U.S. (no dotted pauses) — "the" re-added below
    ("mˈoʊnəpks.kˈɑː.", "ˈɛm wˈʌn pˌiːsˈiːz dˈɑːt kjˌuː ˈeɪ."),  # monepcs.qa → "M-one P-Cs dot Q-A"
]
meta = []
for line in json.load(open(os.path.join(HERE, "lines.json"))):
    ph = k.tokenizer.phonemize(line["text"], "en-us")
    for a, b in FIX:
        ph = ph.replace(a, b)
    ph = ph.replace("fɹʌmðə ðə jˌuːˈɛs.", "fɹʌm ðə jˌuːˈɛs,")
    speed = speed_override or line.get("speed", 0.95)

    def say(p):
        a, r = k.create(p, voice=voice, speed=speed, is_phonemes=True, clause_pause=0.14)
        return a, r

    audio, sr = say(ph)
    sf.write(os.path.join(out, line["id"] + ".wav"), audio, sr, subtype="PCM_24")
    # keyword onsets: duration of the line's own prefix, said the same way (refined in timeline.py)
    kws = {}
    for name, prefix in line.get("kw", {}).items():
        pp = k.tokenizer.phonemize(prefix, "en-us")
        for a, b in FIX:
            pp = pp.replace(a, b)
        pa, _ = say(pp.rstrip(".?!,") )
        kws[name] = round(len(pa) / sr, 3)
    meta.append({"id": line["id"], "dur": round(len(audio) / sr, 3), "speed": speed, "kw": kws, "phonemes": ph})
    print(f'{line["id"]:8s} {len(audio)/sr:5.2f}s  {ph}')
json.dump({"voice": voice, "sr": sr, "lines": meta}, open(os.path.join(out, "meta.json"), "w"), indent=1)
print("total", round(sum(m["dur"] for m in meta), 2))
