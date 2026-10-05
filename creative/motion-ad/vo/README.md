# Voiceover (v13 — complete, untrimmed male narration on the female v8 timing)

Narrator: Kokoro-82M v1.0, style blend 60 % `am_fenrir` + 40 % `am_onyx` (mature, medium-low, conversational),
on the timing of the female v8 read (Kokoro `af_heart`) as the master.

1. `female_ref.py` — her lines as heard in the v8 cut, plus her reading of the opening line.
2. `male_take.py` — his takes: the raw model output, never trimmed (≥ 0.2 s handle before the first sound,
   ≥ 0.3 s after the last); her pauses copied only into pauses he actually makes (edits inside silence, 10 ms
   crossfades, never inside a word); speed tuned per line (0.90–1.10) toward her length; every line
   level-matched (BS.1770); 48 kHz / 24-bit mono, no lossy step anywhere. → `lines/male_take/`
3. `align.py "am_fenrir:3+am_onyx:2" lines/male_take` + `verify_onsets.py lines/male_take` — keyword onsets
   (the picture's sync points), each checked by cutting the take there and transcribing both halves;
   the few the checker cannot settle are set by hand from the cut transcripts (`onsets_report.json`).
4. `build8.py` — places each WHOLE take with her gaps between sentences (later only where the picture needs it;
   the voice is never shortened), derives every picture / capture / audio cue into `timeline.json["v8"]`,
   writes `public/audio/vo8.wav` and `script_final.md`.
5. `qa_voice.py takes|track` — transcripts, silent edges, handles, clipping, hard edges, line boundaries, gaps.

v12's cut-outs and how v13 avoids them: v12 trimmed each take twice (the second cut 80 ms after the last loud
sample, no fade — the tails of "…WhatsApp." and "We set it up." were lost) and spliced digital silence into
places where he does not pause. v13 does neither (steps 2 and 4).

## Files
- `lines.json` — the script (16 lines), keyword prefixes.
- `tts.py` — Kokoro reads (the v8 `af_heart` takes in `lines/af_heart`).
- `onsets.py` — keyword onsets by ASR scan (a cross-check); `asr.py` — offline Whisper (sherpa-onnx).
- `match_female.py` — the v12 method (kept for reference; superseded by `male_take.py`).
- `lines/` — generated audio (not committed), except the JSON reports / onsets of `male_mature` and `male_take`.
