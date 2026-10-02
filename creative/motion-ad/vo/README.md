# Voiceover (v9 — male read)

Narration is generated offline with **Kokoro-82M v1.0** (Apache-2.0), male voice **`am_michael`**,
via `kokoro-onnx` — no cloud TTS, no samples. (v8 used `af_heart`; the v9 refinement replaced it.)

1. Models (GitHub release assets, not committed):
   - `kokoro-v1.0.onnx`, `voices-v1.0.bin` from github.com/thewh1teagle/kokoro-onnx (release `model-files-v1.0`) → `/home/user/tts/`
   - pronunciation check: `sherpa-onnx-whisper-base.en` from github.com/k2-fsa/sherpa-onnx (release `asr-models`)
2. `pip install kokoro-onnx soundfile sherpa-onnx`
3. `CLAUSE=0.22 python3 tts.py am_michael -` — one WAV per line (`lines.json`: text, per-line speed 0.71–0.84,
   keyword prefixes); brand words fixed at phoneme level (Qatar → "KUH-tar", M1, WhatsApp, U.S., monepcs.qa → "M-one P-Cs dot Q-A").
4. `python3 asr.py lines/am_michael/<id>.wav` — transcribe back to verify every line (all 16 word-for-word).
5. `python3 build8.py` — places the lines around the picture (the pauses the brief asks for are held: after the
   opening question, and between "We build it." / "We set it up." / "And we make sure it's ready to use."),
   widens a few natural pauses, derives every cue into `timeline.json["v8"]`, writes `public/audio/vo8.wav`
   (48 kHz / 24-bit, gentle warmth EQ only: +1.5 dB low shelf @ 220 Hz, −1 dB shelf above 7.5 kHz, no compression)
   and `script_final.md` (the script as used, with in/out times and the measured pace).
