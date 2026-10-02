"""Refine keyword onsets: the prefix estimate (said alone, so slightly long because of
phrase-final lengthening) snapped to the deepest energy dip just before it."""
import json
import os
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))


def envelope(x, sr, hop=0.005, win=0.02):
    h, w = int(sr * hop), int(sr * win)
    return np.array([np.sqrt(np.mean(x[i : i + w] ** 2) + 1e-12) for i in range(0, len(x) - w, h)]), hop


def refine(voice="am_fenrir"):
    meta = json.load(open(os.path.join(HERE, "lines", voice, "meta.json")))
    out = {}
    for l in meta["lines"]:
        x, sr = sf.read(os.path.join(HERE, "lines", voice, l["id"] + ".wav"))
        e, hop = envelope(x, sr)
        db = 20 * np.log10(e / e.max())
        res = {}
        for k, est in l["kw"].items():
            a, b = int((est - 0.3) / hop), int((est + 0.04) / hop)
            a, b = max(1, a), min(len(db) - 1, b)
            i = a + int(np.argmin(db[a:b]))
            res[k] = round(i * hop + 0.01, 3)
        out[l["id"]] = {"dur": l["dur"], "kw": res}
    return out


if __name__ == "__main__":
    for k, v in refine().items():
        print(k, v)
