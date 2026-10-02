#!/usr/bin/env bash
# v9 final campaign deliverables (male voiceover refinement), from the rendered PNG sequences + the mixes:
#   Version A (voiceover)    out/v9_frames      + public/audio/final8_vo.wav
#   Version B (no voiceover) out/v9nv_frames    + public/audio/final8_novo.wav
#     (= Version A's frames, hard-linked, with only the frames whose kinetic copy differs re-rendered
#      from the FinalV8NoVO composition into out/v9_novo_frames)
# → masters (ProRes 422 HQ 10-bit, PCM 24-bit) + Instagram MP4s (H.264 High, BT.709, AAC 48 kHz),
#   clean voiceover / music+SFX stems, contact sheet, the two DOHA • QATAR hold stills.
set -euo pipefail
cd "$(dirname "$0")/.."
D=out/final
mkdir -p "$D"

# Version B frame set
rm -rf out/v9nv_frames && mkdir -p out/v9nv_frames
for f in out/v9_frames/*.png; do ln "$f" "out/v9nv_frames/$(basename "$f")"; done
for f in out/v9_novo_frames/*.png; do
  b=$(basename "$f" .png); n=${b#element-}
  dst="out/v9nv_frames/$(printf 'element-%04d.png' $((10#$n)))"
  rm -f "$dst"; cp "$f" "$dst"
done

[ -f out/M1_v9_VO_Instagram.mp4 ] || [ -f "$D/M1_v9_VO_Instagram.mp4" ] || FR=out/v9_frames WAV=public/audio/final8_vo.wav NAME=M1_v9_VO bash scripts/encode-final.sh
FR=out/v9nv_frames WAV=public/audio/final8_novo.wav NAME=M1_v9_NoVO bash scripts/encode-final.sh
for f in out/M1_v9_*_Instagram.mp4 out/M1_v9_*_MASTER_ProRes422HQ.mov; do [ -f "$f" ] && mv -f "$f" "$D/"; done

# stems (48 kHz / 24-bit)
cp public/audio/vo8.wav "$D/M1_v9_Voiceover_clean.wav"
cp public/audio/final8_bed_vo.wav "$D/M1_v9_MusicSFX_bed_for_VO.wav"
cp public/audio/final8_novo.wav "$D/M1_v9_NoVO_mix.wav"
cp vo/script_final.md "$D/M1_v9_Voiceover_Script.md"

# contact sheet (every 1.5 s) and the two location holds
ffmpeg -y -hide_banner -loglevel error -i "$D/M1_v9_VO_Instagram.mp4" -vf "select='not(mod(n\,90))',scale=216:384,tile=9x5" -frames:v 1 -q:v 3 "$D/M1_v9_contact_sheet.jpg"
python3 - <<'PY'
import json, shutil
V = json.load(open("timeline.json"))["v8"]
i = V["intro"]; s = V["sig"]
o = round(((i["doha"][1] + i["hold"][1]) / 2) * 60)
f = round((s["settled"] + V["duration"]) / 2 * 60)
shutil.copy(f"out/v9_frames/element-{o:04d}.png", "out/final/M1_v9_opening_logo_DOHA_QATAR.png")
shutil.copy(f"out/v9_frames/element-{f:04d}.png", "out/final/M1_v9_end_logo_DOHA_QATAR_url.png")
print("stills", o, f)
PY
ls -l "$D"
# motion QA (velocity curves sampled from the composition's own motion functions)
mkdir -p "$D/QA"
cp qa/out/*.png qa/out/motion_qa.json "$D/QA/" 2>/dev/null || true
