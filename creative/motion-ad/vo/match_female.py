"""The male narration, timed to the FEMALE performance (v8, Kokoro af_heart) line by line.

The female read is the master: vo/lines/female_ref/<id>.wav are her lines exactly as heard in the v8 cut
(her original takes with the pauses that cut widened, plus her reading of the new opening hook).
For each line the male voice (a Kokoro style blend, see VOICE) is synthesised and then:
  1. his internal pauses are matched to hers — each of her pauses is paired with his pause at the same
     point of the sentence and given her length; a pause she makes that he doesn't is inserted at his
     nearest word boundary; a pause he makes that she doesn't is shortened. (Silence edits only — the
     speech itself is never time-stretched, so no artefacts.)
  2. his speaking speed is tuned until the whole line lasts as long as hers (±2 %).
  3. the result is DTW-aligned to her line and the timing deviation reported (where each of his sounds
     falls relative to the same sound in her read).

  python3 match_female.py            → vo/lines/male_mature/*.wav + report.json
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import resample_poly, stft

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "lines", "female_ref")
OUT = os.path.join(HERE, "lines", "male_mature")
VOICE = os.environ.get("MALE_VOICE", "am_fenrir:3+am_onyx:2")  # 60 % am_fenrir + 40 % am_onyx
SR = 24000
FIX = [("kˈæɾɑːɹ", "kˈʌtɑːɹ"), ("wʌts ˈæp", "wˈɑtsæp"), ("jˈuː.ˈɛs.", "ðə jˌuːˈɛs."), ("mˈoʊnəpks.kˈɑː.", "ˈɛm wˈʌn pˈiː sˈiːs dˈɑːt kjˈuː ˈeɪ.")]
HOP = 0.01

k = Kokoro("/home/user/tts/kokoro-v1.0.onnx", "/home/user/tts/voices-v1.0.bin")
VOICES = np.load("/home/user/tts/voices-v1.0.bin")


def style(spec):
    parts = [(n, float(w)) for n, w in (p.split(":") for p in spec.split("+"))]
    return sum(VOICES[n] * w for n, w in parts) / sum(w for _, w in parts)


def phon(text):
    p = k.tokenizer.phonemize(text, "en-us")
    for a, b in FIX:
        p = p.replace(a, b)
    return p.replace("fɹʌmðə ðə jˌuːˈɛs.", "fɹʌm ðə jˌuːˈɛs,")


def env_db(x):
    h = int(SR * HOP)
    e = np.array([np.sqrt(np.mean(x[i : i + h] ** 2) + 1e-12) for i in range(0, len(x) - h, h)])
    return 20 * np.log10(e / e.max())


def trim(x):
    d = env_db(x)
    on = np.where(d > -40)[0]
    a, b = on[0], on[-1] + 1
    return x[max(0, int((a * HOP - 0.02) * SR)) : int((b * HOP + 0.06) * SR)]


def pauses(x, min_len=0.06):
    """internal pauses: [(start_s, end_s)] and the speech time before each"""
    d = env_db(x)
    sil = d < -36
    out, i = [], 0
    on = np.where(~sil)[0]
    first, last = on[0], on[-1]
    while i < len(sil):
        if sil[i]:
            j = i
            while j < len(sil) and sil[j]:
                j += 1
            if i > first and j < last and (j - i) * HOP >= min_len:
                out.append((i * HOP, j * HOP))
            i = j
        else:
            i += 1
    return out


def speech_frac(x, ps):
    total = len(trim(x)) / SR - sum(b - a for a, b in ps)
    res, removed = [], 0.0
    for a, b in ps:
        res.append((a - removed) / max(total, 1e-6))
        removed += b - a
    return res


def match_pauses(m, f):
    """give the male line the female's pause pattern"""
    pf, pm = pauses(f), pauses(m)
    ff, fm = speech_frac(f, pf), speech_frac(m, pm)
    used, edits = set(), []  # (pos_s in male, old_len, new_len)
    for (a, b), fr in zip(pf, ff):
        cand = [(abs(fr - g), j) for j, g in enumerate(fm) if j not in used and abs(fr - g) < 0.07]
        if cand:
            _, j = min(cand)
            used.add(j)
            edits.append((pm[j][0], pm[j][1] - pm[j][0], b - a))
        elif b - a >= 0.12:
            # insert at his nearest word boundary to the same point of the sentence
            sp = len(trim(m)) / SR - sum(y - x for x, y in pm)
            target, acc, t = fr * sp, 0.0, 0.0
            d = env_db(m)
            on = np.where(d > -40)[0]
            t = on[0] * HOP
            for x0, y0 in pm:
                if acc + (x0 - t) >= target:
                    break
                acc += x0 - t
                t = y0
            pos = t + (target - acc)
            i0, i1 = int((pos - 0.1) / HOP), int((pos + 0.1) / HOP)
            pos = (i0 + int(np.argmin(d[max(0, i0) : i1]))) * HOP
            edits.append((pos, 0.0, b - a))
    for j, (a, b) in enumerate(pm):
        if j not in used and b - a > 0.12:
            edits.append((a, b - a, 0.12))  # a pause she doesn't make: keep it short
    out, last = [], 0
    for pos, old, new in sorted(edits):
        i, n_old = int(pos * SR), int(old * SR)
        out.append(m[last:i])
        out.append(np.zeros(int(new * SR)))
        last = i + n_old
    out.append(m[last:])
    return np.concatenate(out), len(pf), len(pm)


def feats(x):
    f, t, Z = stft(x, SR, nperseg=int(SR * 0.025), noverlap=int(SR * 0.025) - int(SR * HOP))
    S = np.abs(Z) ** 2
    edges = np.geomspace(100, 7000, 31)
    M = np.log(np.stack([S[(f >= edges[i]) & (f < edges[i + 1])].sum(0) for i in range(30)]) + 1e-10)
    M = M - M.mean(0, keepdims=True)  # per-frame spectral shape (less speaker-dependent)
    M = (M - M.mean(1, keepdims=True)) / (M.std(1, keepdims=True) + 1e-6)  # per-band normalisation
    return M.T


def dtw_dev(m, f):
    A, B = feats(m), feats(f)
    D = np.sqrt(((A[:, None, :] - B[None, :, :]) ** 2).sum(-1))
    n, mm = D.shape
    C = np.full((n + 1, mm + 1), np.inf)
    C[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(1, mm + 1):
            C[i, j] = D[i - 1, j - 1] + min(C[i - 1, j - 1], C[i - 1, j], C[i, j - 1])
    i, j, path = n, mm, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        k_ = np.argmin([C[i - 1, j - 1], C[i - 1, j], C[i, j - 1]])
        i, j = (i - 1, j - 1) if k_ == 0 else (i - 1, j) if k_ == 1 else (i, j - 1)
    dev = np.array([abs(a - b) * HOP for a, b in path])
    return float(np.median(dev)), float(np.percentile(dev, 90))


def main():
    os.makedirs(OUT, exist_ok=True)
    lines = json.load(open(os.path.join(HERE, "lines.json")))
    sty = style(VOICE)
    report = {}
    for line in lines:
        f, fsr = sf.read(os.path.join(REF, line["id"] + ".wav"))
        f = trim(resample_poly(f, SR, fsr) if fsr != SR else f)
        target = len(f) / SR
        speed = line.get("speed", 0.95)
        for it in range(5):
            m, _ = k.create(phon(line["text"]), voice=sty, speed=speed, is_phonemes=True, clause_pause=0.14)
            m = trim(m)
            m2, nf, nm = match_pauses(m, f)
            m2 = trim(m2)
            ratio = (len(m2) / SR) / target
            if abs(ratio - 1) < 0.02:
                break
            speed = speed * ratio
        sf.write(os.path.join(OUT, line["id"] + ".wav"), m2, SR, subtype="PCM_24")
        med, p90 = dtw_dev(m2, f)
        report[line["id"]] = {"speed": round(speed, 3), "female_s": round(target, 2), "male_s": round(len(m2) / SR, 2),
                              "female_pauses": [round(b - a, 2) for a, b in pauses(f)], "male_pauses": [round(b - a, 2) for a, b in pauses(m2)],
                              "timing_dev_median_s": round(med, 3), "timing_dev_p90_s": round(p90, 3)}
        print(line["id"], report[line["id"]], flush=True)
    json.dump({"voice": VOICE, "lines": report}, open(os.path.join(OUT, "report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
