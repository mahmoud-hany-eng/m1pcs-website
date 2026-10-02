# Voiceover (v10 — tech-presenter read)

Narration is generated offline with **Kokoro-82M v1.0** (Apache-2.0), male voice **`am_fenrir`**,
via `kokoro-onnx` — no cloud TTS, no samples. (v8 used `af_heart`, v9 `am_michael`; v10 replaced the
latter, which read too slow / breathy / deep. am_fenrir measured: median F0 ≈ 139 Hz — a normal male
register — the widest pitch movement of the male voices, the highest harmonics-to-noise ratio of the
natural-sounding ones, and the least low-end weight.)

1. Models (GitHub release assets, not committed):
   - `kokoro-v1.0.onnx`, `voices-v1.0.bin` from github.com/thewh1teagle/kokoro-onnx (release `model-files-v1.0`) → `/home/user/tts/`
   - pronunciation check: `sherpa-onnx-whisper-base.en` from github.com/k2-fsa/sherpa-onnx (release `asr-models`)
2. `pip install kokoro-onnx soundfile sherpa-onnx`
3. `CLAUSE=0.14 python3 tts.py am_fenrir -` — one WAV per line (`lines.json`: text, per-line speed, keyword prefixes).
   Each line's speed is set so every line runs at the same articulation rate (~4.7 syllables/s — Kokoro's
   own speed factor is not linear across sentences). Brand words fixed at phoneme level (Qatar → "KUH-tar",
   M1, WhatsApp, U.S., monepcs.qa → "M-one P-Cs dot Q-A").
4. `python3 align.py am_fenrir` — keyword onsets by open-end DTW of each spoken prefix against the full line;
   the onsets used (MANUAL in `build8.py`) were each verified by cutting the line there and transcribing
   both halves with `asr.py`.
5. `python3 build8.py` — places the lines (a short breath between sentences), derives every picture /
   capture / audio cue into `timeline.json["v8"]`, writes `public/audio/vo8.wav` (48 kHz / 24-bit,
   clarity EQ only: 80 Hz high-pass, −1.5 dB below 180 Hz, +1.5 dB presence above 2.8 kHz, no compression)
   and `script_final.md` (the script as used, with in/out times and the measured pace).
