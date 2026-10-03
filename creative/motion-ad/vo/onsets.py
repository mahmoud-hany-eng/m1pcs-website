"""Keyword onsets for ANY voice (no synthesis needed — works on Grady's delivered lines as well as on
a timing model): for each keyword, cut the line at candidate times around a syllable-proportional
estimate and transcribe the right-hand part with the offline Whisper model; the latest cut whose
transcript still STARTS with the keyword is the keyword's onset (a cut any later clips the word).

  python3 onsets.py <lines-dir>          → <lines-dir>/onsets.json  {line: {keyword: seconds}}
"""
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asr  # noqa: E402

ALIAS = {
    "qatar": ["qatar", "katar", "cutter", "cuttar", "qata", "kata", "gutter", "cut"],
    "pc": ["pc", "p.c", "pcs", "piece", "pieces", "pc's"],
    "pcs": ["pcs", "pc", "pc's", "p.c", "piece"],
    "m1": ["m1", "m", "em", "emm", "m-1", "and"],
    "mone": ["m1", "m", "em", "emm", "m-1", "mpc", "m1pc"],
    "us": ["us", "u.s", "usa", "u", "you"],
    "whatsapp": ["whatsapp", "whats", "what's", "what"],
}
VOWELS = re.compile(r"[aeiouy]+")


def syl(word):
    return max(1, len(VOWELS.findall(word.lower())))


def norm(text):
    w = re.sub(r"[^a-z0-9.'\- ]", " ", text.lower()).split()
    return w[0].strip(".-") if w else ""


def matches(first, kw):
    k = kw.lower()
    if k in ALIAS:
        return any(first.startswith(a) for a in ALIAS[k])
    return first.startswith(k[: max(3, min(len(k), 4))]) if len(k) > 2 else first == k


def transcribe(x, sr):
    seg = np.concatenate([np.zeros(sr // 10), x, np.zeros(sr // 10)])
    y = resample_poly(seg, 16000, sr).astype(np.float32)
    s = asr.rec.create_stream()
    s.accept_waveform(16000, y)
    asr.rec.decode_stream(s)
    return s.result.text


def main(d):
    lines = json.load(open(os.path.join(HERE, "lines.json")))
    out = {}
    for line in lines:
        path = os.path.join(d, line["id"] + ".wav")
        x, sr = sf.read(path)
        if x.ndim > 1:
            x = x.mean(1)
        idx = np.where(np.abs(x) > 0.01 * np.abs(x).max() / 0.3)[0]
        a, b = idx[0] / sr, idx[-1] / sr
        words = line["text"].split()
        total = sum(syl(w) for w in words)
        res = {}
        for kw, prefix in line.get("kw", {}).items():
            n = len(prefix.split())
            est = a + (b - a) * sum(syl(w) for w in words[:n]) / total
            best = None
            for c in np.arange(max(0, est - 0.7), min(b, est + 0.55), 0.025):
                i = int(c * sr)
                first = norm(transcribe(x[i : i + int(1.1 * sr)], sr))
                if matches(first, kw):
                    best = c
            res[kw] = round(float(best if best is not None else est), 3)
            if best is None:
                print(f"  ! {line['id']}:{kw} not found by ASR — using the estimate {est:.2f}", flush=True)
        out[line["id"]] = res
        print(line["id"], res, flush=True)
    json.dump(out, open(os.path.join(d, "onsets.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
