"""The male narration master (v13): clean, untrimmed takes on the female v8 timing.

What v12 did wrong (and this does not do):
  - it trimmed every take at -40 dB (+60 ms), and build8 cut it again 80 ms after the last sample above
    ~-30 dB of the peak, with no fade — the tails of "…WhatsApp." and "We set it up." were cut off;
  - it spliced digital silence into the read to copy her pauses, sometimes at a point where he does not
    pause at all ("into a | build"), with hard edges — heard as drop-outs;
  - each line was voiced with a different style row (Kokoro picks the speaker row by phoneme count), so
    short lines sounded like a different session.

Here, for every line:
  1. The v12 narrator exactly: the same blend (VOICE) with Kokoro's own conditioning (the style row for the
     line's length — a single fixed row was tried and changed his pace by up to ±30 % per line), and the raw
     model output (no trimming at all — the model's own silence before and after each line is kept).
  2. Pauses are only ever changed INSIDE a pause he actually makes (a stretch of real silence ≥ 50 ms):
     lengthened or shortened in its middle, ≥ 25 ms of his own silence kept on both sides, 10 ms
     crossfades. Where she pauses and he does not, nothing is inserted.
  3. His speed is tuned so the line lasts about as long as hers (within ±3 %), kept within 0.90–1.10 so
     the read stays one consistent performance.
  4. Every line is level-matched (BS.1770 K-weighted, gated speech loudness) to the same loudness.
  5. Handles: ≥ 200 ms of silence before the first sound and ≥ 300 ms after the last; 10 ms fade-in /
     20 ms fade-out at the very ends of the file (which are silence).
  6. 48 kHz / 24-bit mono WAV (resampled once from the model's 24 kHz float output, no lossy step).

  python3 vo/male_take.py   → vo/lines/male_take/<id>.wav + report.json
"""
import json
import os

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import lfilter, resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "lines", "female_ref")
OUT = os.path.join(HERE, "lines", "male_take")
VOICE = "am_fenrir:3+am_onyx:2"  # the v12 narrator: 60 % am_fenrir + 40 % am_onyx
MSR, SR = 24000, 48000
HOP = 0.005
FIX = [("kˈæɾɑːɹ", "kˈʌtɑːɹ"), ("wʌts ˈæp", "wˈɑtsæp"), ("jˈuː.ˈɛs.", "ðə jˌuːˈɛs."), ("mˈoʊnəpks.kˈɑː.", "ˈɛm wˈʌn pˈiː sˈiːs dˈɑːt kjˈuː ˈeɪ."),
       ("ʃˌʊdənt", "ʃˈʊdənt")]  # "shouldn't" carries the hook: full stress, so the "n't" is never swallowed
SILENT_DB = -45  # a 5 ms frame this far below the line's loudest frame is silence
TARGET_LUFS = -23.0  # per-line speech loudness (the mix sets the final level)

k = Kokoro("/home/user/tts/kokoro-v1.0.onnx", "/home/user/tts/voices-v1.0.bin")
_V = np.load("/home/user/tts/voices-v1.0.bin")
_parts = [(n, float(w)) for n, w in (p.split(":") for p in VOICE.split("+"))]
BLEND = sum(_V[n] * w for n, w in _parts) / sum(w for _, w in _parts)


def phon(text):
    p = k.tokenizer.phonemize(text, "en-us")
    for a, b in FIX:
        p = p.replace(a, b)
    return p.replace("fɹʌmðə ðə jˌuːˈɛs.", "fɹʌm ðə jˌuːˈɛs,")


def synth(text, speed):
    tokens = k.tokenizer.tokenize(phon(text))
    audio, _ = k._infer(tokens, BLEND[min(len(tokens), len(BLEND)) - 1], speed)  # raw model output, untrimmed
    return np.asarray(audio, dtype=np.float64)


def frames_db(x, sr):
    h = int(sr * HOP)
    n = len(x) // h
    e = np.sqrt((x[: n * h].reshape(n, h) ** 2).mean(1) + 1e-20)
    return 20 * np.log10(e / e.max())


def speech_span(x, sr):
    d = frames_db(x, sr)
    on = np.where(d > SILENT_DB)[0]
    return on[0] * HOP, (on[-1] + 1) * HOP


def pauses(x, sr, min_len=0.05):
    """real silences inside the line: [(start_s, end_s)]"""
    d = frames_db(x, sr)
    a, b = speech_span(x, sr)
    sil = d <= SILENT_DB
    out, i = [], int(a / HOP)
    while i < int(b / HOP):
        if sil[i]:
            j = i
            while j < len(sil) and sil[j]:
                j += 1
            if (j - i) * HOP >= min_len and j * HOP < b:
                out.append((i * HOP, j * HOP))
            i = j
        else:
            i += 1
    return out


def frac_of_speech(x, sr, ps):
    """where each pause falls, as a fraction of the speech (pauses excluded)"""
    a, b = speech_span(x, sr)
    total = (b - a) - sum(q - p for p, q in ps)
    res, gone = [], 0.0
    for p, q in ps:
        res.append((p - a - gone) / max(total, 1e-6))
        gone += q - p
    return res


def resize_pause(x, sr, p, q, new):
    """set the silence [p, q) to `new` s by cutting / extending its middle (inside the silence only)"""
    keep = 0.025
    old = q - p
    mid = int((p + q) / 2 * sr)
    if new >= old:
        return xfade(xfade(x[:mid], np.zeros(int((new - old) * sr)), sr), x[mid:], sr)
    cut = old - max(new, 2 * keep)
    c0, c1 = int(mid - cut / 2 * sr), int(mid + cut / 2 * sr)
    return xfade(x[:c0], x[c1:], sr)


def xfade(a, b, sr, ms=10):
    """a then b, joined with a short linear crossfade (used only inside silence)"""
    f = min(int(ms / 1000 * sr), len(a), len(b))
    if f == 0:
        return np.concatenate([a, b])
    w = np.linspace(0, 1, f)
    return np.concatenate([a[:-f], a[-f:] * (1 - w) + b[:f] * w, b[f:]])


def match_pauses(m, f, sr):
    pm, pf = pauses(m, sr), pauses(f, sr)
    fm, ff = frac_of_speech(m, sr, pm), frac_of_speech(f, sr, pf)
    pairs, used = [], set()
    for (fp, fq), fr in zip(pf, ff):
        cand = [(abs(fr - g), j) for j, g in enumerate(fm) if j not in used and abs(fr - g) < 0.08]
        if cand:
            _, j = min(cand)
            used.add(j)
            pairs.append((j, fq - fp))
    # edit from the end so earlier positions stay valid
    for j, new in sorted(pairs, key=lambda t: -t[0]):
        p, q = pm[j]
        m = resize_pause(m, sr, p, q, new)
    return m, [(round(pm[j][1] - pm[j][0], 3), round(new, 3)) for j, new in sorted(pairs)], len(pf), len(pm)


# ---------------------------------------------------------------- BS.1770 K-weighting at 48 kHz
_KB1, _KA1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
_KB2, _KA2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]


def loudness(x):
    y = lfilter(_KB2, _KA2, lfilter(_KB1, _KA1, x))
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([np.mean(y[i : i + blk] ** 2) for i in range(0, max(1, len(y) - blk), hop)])
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[lk > -70]
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return -0.691 + 10 * np.log10(z.mean())


def finish(x):
    """24 kHz model audio → 48 kHz, handles, end fades, level"""
    y = resample_poly(x, SR, MSR)
    a, b = speech_span(y, SR)
    pre = max(0, int((0.2 - a) * SR))
    post = max(0, int((0.3 - (len(y) / SR - b)) * SR))
    y = np.concatenate([np.zeros(pre), y, np.zeros(post)])
    fi, fo = int(0.010 * SR), int(0.020 * SR)
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo)
    g = TARGET_LUFS - loudness(y)
    return y * 10 ** (g / 20), g


def main():
    os.makedirs(OUT, exist_ok=True)
    lines = json.load(open(os.path.join(HERE, "lines.json")))
    rep = {}
    for line in lines:
        lid = line["id"]
        refp = os.path.join(REF, lid + ".wav")
        speed = 1.0
        if os.path.exists(refp) and not line.get("no_female_ref"):
            f, fsr = sf.read(refp)
            f = resample_poly(f, MSR, fsr) if fsr != MSR else f
            fa, fb = speech_span(f, MSR)
            target = fb - fa
            for _ in range(6):
                m = synth(line["text"], speed)
                m2, pairs, nf, nm = match_pauses(m, f, MSR)
                a, b = speech_span(m2, MSR)
                ratio = (b - a) / target
                if abs(ratio - 1) < 0.03 or speed in (0.9, 1.1):
                    break
                speed = float(np.clip(speed * ratio, 0.9, 1.1))
        else:  # a line with no female reference (the v13 "Let us show you how it is done."): his natural read
            m2 = synth(line["text"], speed)
            pairs, nf, nm, target = [], 0, len(pauses(m2, MSR)), None
        y, gain = finish(m2)
        sf.write(os.path.join(OUT, lid + ".wav"), y.astype(np.float32), SR, subtype="PCM_24")
        a, b = speech_span(y, SR)
        rep[lid] = {"speed": round(speed, 3), "speech_s": round(b - a, 3), "female_s": round(target, 3) if target else None,
                    "lead_s": round(a, 3), "tail_s": round(len(y) / SR - b, 3), "pauses_set_to_hers": pairs,
                    "her_pauses": nf, "his_pauses": nm, "gain_db": round(gain, 2), "loudness": round(loudness(y), 2)}
        print(lid, rep[lid], flush=True)
    json.dump({"voice": VOICE, "sample_rate": SR, "lines": rep}, open(os.path.join(OUT, "report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
