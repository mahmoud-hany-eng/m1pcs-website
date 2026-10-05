"""Voice QA — the narration takes (vo/lines/male_take) and the placed track (public/audio/vo8.wav).

  python3 vo/qa_voice.py takes    every take: transcript, edges are silence, handles, no clipping, no hard edge
  python3 vo/qa_voice.py track    the placed narration: every line's start / end region, overlaps, gaps,
                                  sudden level steps, discontinuities, transcript of the whole track

"Hard edge" = a sample-to-sample jump far larger than the local signal could produce (a cut / splice click).
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)


def frames_db(x, sr, hop=0.005, ref=None):
    h = int(sr * hop)
    n = len(x) // h
    e = np.sqrt((x[: n * h].reshape(n, h) ** 2).mean(1) + 1e-20)
    return 20 * np.log10(e / (ref if ref else e.max()))


def hard_edges(x, sr):
    """positions where |x[n] - x[n-1]| is > 8× the local (2 ms) RMS of the difference signal and audible"""
    d = np.abs(np.diff(x))
    w = int(0.002 * sr)
    loc = np.sqrt(np.convolve(d**2, np.ones(w) / w, mode="same") + 1e-12)
    bad = np.where((d > 8 * loc) & (d > 10 ** (-50 / 20)))[0]
    return [round(i / sr, 3) for i in bad]


def takes():
    from asr import load, text

    d = os.path.join(HERE, "lines", "male_take")
    L = json.load(open(os.path.join(HERE, "lines.json")))
    ok = True
    for l in L:
        p = os.path.join(d, l["id"] + ".wav")
        x, sr = sf.read(p)
        info = sf.info(p)
        db = frames_db(x, sr)
        on = np.where(db > -45)[0]
        a, b = on[0] * 0.005, (on[-1] + 1) * 0.005
        edge_in, edge_out = db[:6].max(), db[-6:].max()
        peak = 20 * np.log10(np.abs(x).max())
        he = hard_edges(x, sr)
        t = text(load(p))
        flags = []
        if a < 0.19 or len(x) / sr - b < 0.29:
            flags.append("SHORT HANDLE")
        if edge_in > -60 or edge_out > -60:
            flags.append("EDGE NOT SILENT")
        if peak > -1:
            flags.append("HOT")
        if he:
            flags.append(f"HARD EDGE at {he[:5]}")
        ok &= not flags
        print(f"{l['id']:8s} {info.samplerate} Hz {info.subtype}  head {a:.2f}s tail {len(x)/sr-b:.2f}s  ends {edge_in:.0f}/{edge_out:.0f} dB  peak {peak:.1f} dBFS  "
              f"{'OK' if not flags else ' '.join(flags)}  | {t}")
    print("ALL TAKES OK" if ok else "TAKE PROBLEMS FOUND")


def track():
    from asr import load, segments, text

    V = json.load(open(os.path.join(ROOT, "timeline.json")))["v8"]
    VO = V["vo"]
    p = os.path.join(ROOT, "public", "audio", "vo8.wav")
    x, sr = sf.read(p)
    info = sf.info(p)
    print(f"vo8.wav: {info.samplerate} Hz, {info.subtype}, {info.channels} ch, {len(x)/sr:.2f} s")
    ref = np.sqrt(np.mean(x[np.abs(x) > 1e-4] ** 2))
    order = sorted(VO, key=lambda k: VO[k]["start"])
    ok = True
    for i, lid in enumerate(order):
        s, e = VO[lid]["start"], VO[lid]["end"]
        seg = x[int((s - 0.25) * sr) : int((e + 0.35) * sr)]
        db = frames_db(seg, sr, ref=ref * 10)
        # the 150 ms before the first sound and the 250 ms after the last must be quiet (no cut-in / cut-off)
        pre = db[: int(0.10 / 0.005)].max()
        post = db[-int(0.25 / 0.005):].max()
        he = hard_edges(seg, sr)
        nxt = VO[order[i + 1]]["start"] - e if i + 1 < len(order) else None
        flags = []
        if pre > -55:
            flags.append(f"sound right before start ({pre:.0f} dB)")
        if post > -55:
            flags.append(f"sound right after end ({post:.0f} dB)")
        if he:
            flags.append(f"hard edge {he[:3]}")
        if nxt is not None and nxt < 0.25:
            flags.append(f"gap to next only {nxt:.2f}s")
        ok &= not flags
        print(f"{lid:8s} {s:6.2f}–{e:6.2f}  gap→next {'' if nxt is None else f'{nxt:.2f}s':>6}  {'OK' if not flags else '; '.join(flags)}")
    # loudness per line (speech frames only)
    lv = {}
    for lid in order:
        seg = x[int(VO[lid]["start"] * sr) : int(VO[lid]["end"] * sr)]
        db = frames_db(seg, sr, hop=0.05, ref=1.0)
        lv[lid] = float(np.percentile(db, 75))
    med = np.median(list(lv.values()))
    print("line level (75th pct of 50 ms RMS, vs median):", {k: round(v - med, 1) for k, v in lv.items()})
    print("\ntranscript of the whole narration track:")
    y = load(p)
    for a, b in segments(y, thr_db=-45, min_sil=0.25):
        print(f"  {a:6.2f}-{b:6.2f}  {text(y[int(a*16000):int(b*16000)])}")
    print("TRACK OK" if ok else "TRACK PROBLEMS FOUND")


if __name__ == "__main__":
    {"takes": takes, "track": track}[sys.argv[1] if len(sys.argv) > 1 else "takes"]()
