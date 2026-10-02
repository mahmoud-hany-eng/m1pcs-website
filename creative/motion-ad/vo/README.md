# Voiceover (v8)

Narration is generated offline with **Kokoro-82M** (Apache-2.0), voice `af_heart`,
via `kokoro-onnx` — no cloud TTS, no samples.

1. Models (GitHub release assets, not committed):
   - `kokoro-v1.0.onnx`, `voices-v1.0.bin` from github.com/thewh1teagle/kokoro-onnx (release `model-files-v1.0`) → `/home/user/tts/`
   - pronunciation check: `sherpa-onnx-whisper-base.en` from github.com/k2-fsa/sherpa-onnx (release `asr-models`)
2. `pip install kokoro-onnx soundfile sherpa-onnx`
3. `python3 tts.py af_heart -` — one WAV per line (`lines.json`: text, per-line speed, keyword prefixes);
   brand words fixed at phoneme level (Qatar → "KUH-tar", M1, WhatsApp, U.S., monepcs.qa → "M-one P-Cs dot Q-A").
4. `python3 asr.py lines/af_heart/<id>.wav` — transcribe back to verify every line.
5. `python3 build8.py` — places the lines, widens a few natural pauses, derives every cue into
   `timeline.json["v8"]` and writes `public/audio/vo8.wav`.
