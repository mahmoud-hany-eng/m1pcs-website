"""Offline transcription (sherpa-onnx Whisper base.en) used to check the voiceover's
pronunciation and to measure reference pacing. Splits on silences; prints segment times."""
import sys
import numpy as np
import soundfile as sf
import sherpa_onnx
from scipy.signal import resample_poly

M = "/home/user/tts/sherpa-onnx-whisper-base.en/base.en-"
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=M + "encoder.onnx", decoder=M + "decoder.onnx", tokens=M + "tokens.txt", language="en", task="transcribe", num_threads=4)


def load(path):
    x, sr = sf.read(path, always_2d=True)
    x = x.mean(axis=1)
    if sr != 16000:
        x = resample_poly(x, 16000, sr)
    return x.astype(np.float32)


def segments(x, sr=16000, thr_db=-40, min_sil=0.25, pad=0.08):
    hop = int(0.01 * sr)
    e = np.array([np.sqrt(np.mean(x[i : i + hop] ** 2) + 1e-12) for i in range(0, len(x) - hop, hop)])
    db = 20 * np.log10(e / (e.max() + 1e-12))
    voiced = db > thr_db
    segs, start, sil = [], None, 0
    for i, v in enumerate(voiced):
        if v:
            if start is None:
                start = i
            sil = 0
        elif start is not None:
            sil += 1
            if sil * 0.01 >= min_sil:
                segs.append((start * 0.01, (i - sil + 1) * 0.01))
                start, sil = None, 0
    if start is not None:
        segs.append((start * 0.01, len(voiced) * 0.01))
    return [(max(0, a - pad), b + pad) for a, b in segs if b - a > 0.12]


def text(x, sr=16000):
    s = rec.create_stream()
    s.accept_waveform(sr, x)
    rec.decode_stream(s)
    return s.result.text.strip()


if __name__ == "__main__":
    x = load(sys.argv[1])
    thr = float(sys.argv[2]) if len(sys.argv) > 2 else -40
    for a, b in segments(x, thr_db=thr):
        print(f"{a:6.2f}-{b:6.2f}  {text(x[int(a*16000):int(b*16000)])}")
