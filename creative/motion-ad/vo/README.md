# Voiceover (v11 — Grady)

The narrator is **Grady**, the Higgsfield preset voice chosen by the client. Higgsfield cannot be reached
from the build environment (its hosts are refused by the network policy), so Grady's lines must be
generated in Higgsfield and dropped in. **No other voice is used in any deliverable.**

Until then the edit is timed to a **timing model**: an offline read of the same 14-line script at the
target pace (Kokoro-82M `am_fenrir`, ~4.1 syllables/s inside sentences, a ~0.3 s beat between them) in
`lines/model_fenrir/`. It is a ruler only — `build8.py` writes it to `public/audio/vo8_timing_model.wav`,
which the score uses solely to duck the music where Grady will speak.

## Inserting Grady
1. In Higgsfield, generate Grady at his natural speed, one file per line, the 14 lines of
   `script_final.md` (names `q.wav … visit.wav`, or `01…14` in script order; wav/mp3/m4a).
2. `python3 vo/grady.py <folder>` — converts, measures each sync word in his read (`align.py` DTW,
   checked by `onsets.py` ASR scan), places each line so its words land on the picture's cues, remixes
   (`audio/score_v8.py`, voice-first ducking) and swaps the mix into the delivered VO videos without
   re-rendering. It prints every sync error and slot overrun.
3. If anything does not fit: `bash scripts/rebuild-for-grady.sh` re-times the picture to Grady's real
   read (timeline → site recapture → render → deliver).

## Files
- `lines.json` — the script (14 lines), per-line model speed, the keyword prefixes used for alignment.
- `tts.py` — the timing-model read (`CLAUSE=0.2 python3 tts.py am_fenrir - lines/model_fenrir`).
- `align.py` — keyword onsets by open-end DTW of each spoken prefix (works across speakers).
- `onsets.py` — keyword onsets by ASR scan (no synthesis; any voice).
- `asr.py` — offline Whisper (sherpa-onnx) transcription.
- `build8.py` — places the lines, derives every picture / capture / audio cue into `timeline.json["v8"]`,
  writes `script_final.md` (script + Grady timing sheet). `VO_DIR=lines/grady` re-times to Grady.
