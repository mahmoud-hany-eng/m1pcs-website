"""Keyword onsets by alignment: each keyword's spoken prefix (same voice, same speed) is aligned to the
full line with open-end DTW on log-band spectra; where the prefix's content ends in the full line is
where the keyword begins. (More robust than prefix duration, which phrase-final lengthening inflates.)"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import stft

HERE = os.path.dirname(os.path.abspath(__file__))
HOP = 0.005
FIX = [("kˈæɾɑːɹ", "kˈʌtɑːɹ"), ("wʌts ˈæp", "wˈɑtsæp"), ("jˈuː.ˈɛs.", "ðə jˌuːˈɛs."), ("mˈoʊnəpks.kˈɑː.", "ˈɛm wˈʌn pˈiː sˈiːs dˈɑːt kjˈuː ˈeɪ.")]


def feats(x, sr):
    f, t, Z = stft(x, sr, nperseg=int(sr * 0.025), noverlap=int(sr * 0.025) - int(sr * HOP))
    S = np.abs(Z) ** 2
    edges = np.geomspace(80, 8000, 41)
    M = np.stack([S[(f >= edges[i]) & (f < edges[i + 1])].sum(0) for i in range(40)])
    L = np.log(M + 1e-10)
    return (L - L.mean(0, keepdims=True)).T, np.log(S.sum(0) + 1e-10)


def open_end_dtw(A, B):
    """A (prefix) fully aligned to the start of B; returns the B index where A ends"""
    D = np.sqrt(((A[:, None, :] - B[None, :, :]) ** 2).sum(-1))
    n, m = D.shape
    C = np.full((n, m), np.inf)
    C[0, 0] = D[0, 0]
    for j in range(1, m):
        C[0, j] = C[0, j - 1] + D[0, j]
    for i in range(1, n):
        prev = C[i - 1]
        row = np.empty(m)
        row[0] = prev[0] + D[i, 0]
        diag = np.concatenate([[np.inf], prev[:-1]])
        best = np.minimum(prev, diag)
        for j in range(1, m):
            row[j] = D[i, j] + min(best[j], row[j - 1])
        C[i] = row
    # normalise by path length estimate (i + j) to compare end points fairly
    norm = C[-1] / (n + np.arange(m))
    return int(np.argmin(norm))


def main(voice):
    k = Kokoro("/home/user/tts/kokoro-v1.0.onnx", "/home/user/tts/voices-v1.0.bin")
    lines = json.load(open(os.path.join(HERE, "lines.json")))
    out = {}
    for line in lines:
        x, sr = sf.read(os.path.join(HERE, "lines", voice, line["id"] + ".wav"))
        B, eB = feats(x, sr)
        res = {}
        for name, prefix in line.get("kw", {}).items():
            pp = k.tokenizer.phonemize(prefix, "en-us")
            for a, b in FIX:
                pp = pp.replace(a, b)
            pa, _ = k.create(pp.rstrip(".?!,"), voice=voice, speed=line["speed"], is_phonemes=True, clause_pause=0.16)
            idx = np.where(np.abs(pa) > 0.01)[0]
            pa = pa[: idx[-1] + 1]  # drop the prefix's trailing silence
            A, _ = feats(pa, sr)
            j = open_end_dtw(A, B[: int(len(A) * 2.2) + 40])
            # snap to the quietest point within 60 ms after the aligned end (the boundary)
            w = eB[j : j + 12]
            j2 = j + int(np.argmin(w)) if len(w) else j
            res[name] = round(j2 * HOP + 0.012, 3)
        out[line["id"]] = res
        print(line["id"], res, flush=True)
    json.dump(out, open(os.path.join(HERE, "lines", voice, "align.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "am_fenrir")
