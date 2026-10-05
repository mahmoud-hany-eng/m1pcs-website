"""Keyword onsets for the narration takes, each one verified by transcription.

For every keyword: the DTW estimate (vo/align.py) is checked by cutting the take at a grid of points around
it and transcribing both halves (offline Whisper). A cut point is valid when the left half ends with the
word before the keyword and the right half starts with the keyword. The estimate is kept if it lies in the
valid region; otherwise the onset is put 0.10 s before the end of the valid region (a cut stays "valid" until
~0.1 s into the keyword, the most the transcriber still recognises) but never before its start. A keyword
with no valid cut is reported for a manual check. Scans are cached per keyword (survives restarts).

  python3 vo/verify_onsets.py lines/male_take  → <dir>/onsets.json (+ onsets_report.json)
"""
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from asr import load, text  # noqa: E402

ALIAS = {"m1": ["m1", "m", "em", "and1", "n1"], "pc": ["pc", "p"], "pcs": ["pcs", "pc", "p"], "shouldnt": ["shouldn", "should"],
         "whatsapp": ["whats", "what"], "us": ["us", "u"], "qatar": ["qatar", "cut", "kat", "guitar", "khat", "cat"],
         "mone": ["m1", "m", "mone", "em"], "yours": ["yours", "your"], "set": ["set", "said", "sat"], "it": ["it", "its"],
         "then": ["then", "and"], "done": ["done", "dun"]}
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("'", "").replace("’", "")).split()


def env(x):
    h = 160
    e = np.array([np.sqrt(np.mean(x[i : i + h] ** 2) + 1e-12) for i in range(0, len(x) - h, h)])
    return 20 * np.log10(e / e.max())


def main(d):
    d = os.path.join(HERE, d) if not os.path.isabs(d) else d
    A = json.load(open(os.path.join(d, "align.json")))
    L = {l["id"]: l for l in json.load(open(os.path.join(HERE, "lines.json")))}
    out, rep = {}, {}
    cache_p = os.path.join(d, "onsets_scan_cache.json")
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    for lid, kws in A.items():
        x = load(os.path.join(d, lid + ".wav"))
        E = env(x)
        out[lid] = {}
        for w, est in kws.items():
            key = re.sub(r"\d$", "", w.lower())
            toks = ALIAS.get(key, [key])
            prev = norm(L[lid]["kw"][w])[-1]
            ck = f"{lid}:{w}:{est}"
            if ck in cache:
                valid = cache[ck]
            else:
                valid = []
                for t in np.arange(max(0.03, est - 0.4), min(len(x) / 16000 - 0.05, est + 0.26), 0.02):
                    i = int(t * 16000)
                    l, r = norm(text(x[:i])), norm(text(x[i:]))
                    okr = bool(r) and any(r[0].startswith(k) for k in toks)
                    okl = bool(l) and (l[-1] == prev or l[-1][:3] == prev[:3])
                    if okr and okl:
                        valid.append(round(float(t), 3))
                cache[ck] = valid
                json.dump(cache, open(cache_p, "w"))
            if not valid:
                out[lid][w], status = est, "NO VALID CUT — check"
            elif valid[0] - 0.04 <= est <= valid[-1] + 0.04:
                out[lid][w], status = est, "dtw ok"
            else:
                out[lid][w], status = round(max(valid[0], valid[-1] - 0.10), 3), f"moved from {est:.3f}"
            rep[f"{lid}:{w}"] = {"dtw": est, "valid": [valid[0], valid[-1]] if valid else None, "used": out[lid][w], "status": status}
            print(f"{lid:8s} {w:12s} dtw {est:6.3f}  valid {('%.2f-%.2f' % (valid[0], valid[-1])) if valid else '   -     '}  → {out[lid][w]:.3f}  {status}", flush=True)
    json.dump(out, open(os.path.join(d, "onsets.json"), "w"), indent=1)
    json.dump(rep, open(os.path.join(d, "onsets_report.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "lines/male_take")
