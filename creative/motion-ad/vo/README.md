# Voiceover (v12 — mature male on the female v8 timing)

The narrator is a mature male read (Kokoro-82M v1.0, a style blend of 60 % `am_fenrir` + 40 % `am_onyx`:
medium-low, grounded, conversational) **performed on the female v8 read** (Kokoro `af_heart`), which is the
master for timing, cadence, pauses and emphasis. No voice conversion model is available offline, so the
match is made line by line:

1. `female_ref.py` — her lines exactly as heard in the v8 cut, plus her reading of the new opening line.
2. `match_female.py` — for each line, his read gets her pause pattern (silence edits only; the speech is
   never time-stretched) and his speaking speed is tuned until the line lasts as long as hers (±2 %). Each
   line is DTW-aligned to hers and the timing deviation is reported → `lines/male_mature/report.json`.
3. `align.py "am_fenrir:3+am_onyx:2" lines/male_mature` — keyword onsets; every one checked by cutting the
   line there and transcribing both halves (`asr.py`); the verified set is `lines/male_mature/onsets.json`.
4. `build8.py` — places his lines with her gaps between sentences (a gap is longer only where the picture
   needs it, and that is reported), derives every picture / capture / audio cue into
   `timeline.json["v8"]`, writes `public/audio/vo8.wav` and `script_final.md` (script + her/his timing).

## Files
- `lines.json` — the script (16 lines: her v8 script, with the new opening line), keyword prefixes.
- `tts.py` — Kokoro reads (the v8 `af_heart` takes in `lines/af_heart`).
- `onsets.py` — keyword onsets by ASR scan (a cross-check).
- `asr.py` — offline Whisper (sherpa-onnx) transcription.
- `lines/` — generated audio (not committed), except `lines/male_mature/*.json` (report, onsets).
