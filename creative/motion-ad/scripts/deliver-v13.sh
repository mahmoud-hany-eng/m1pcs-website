#!/usr/bin/env bash
# v13 final deliverables (technical polish: complete untrimmed narration, clean mix, full-quality exports),
# from the rendered PNG sequences + the mixes:
#   Version A (voiceover)    out/v13_frames      + public/audio/final8_vo.wav
#   Version B (no voiceover) out/v13nv_frames    + public/audio/final8_novo.wav
#     (= Version A's frames, hard-linked, with only the frames whose kinetic copy differs re-rendered
#      from the FinalV8NoVO composition into out/v13_novo_frames)
# → masters (ProRes 422 HQ 10-bit, PCM 24-bit) + Instagram MP4s (H.264 High, BT.709, AAC 48 kHz),
#   clean voiceover / music+SFX stems, contact sheet, the two DOHA • QATAR hold stills.
set -euo pipefail
cd "$(dirname "$0")/.."
D=out/final
mkdir -p "$D"

# Version B frame set
rm -rf out/v13nv_frames && mkdir -p out/v13nv_frames
for f in out/v13_frames/*.png; do ln "$f" "out/v13nv_frames/$(basename "$f")"; done
for f in out/v13_novo_frames/*.png; do
  b=$(basename "$f" .png); n=${b#element-}
  dst="out/v13nv_frames/$(printf 'element-%04d.png' $((10#$n)))"
  rm -f "$dst"; cp "$f" "$dst"
done

VNAME=M1_v13_MaleVO
FR=out/v13_frames WAV=public/audio/final8_vo.wav NAME=$VNAME bash scripts/encode-final.sh
FR=out/v13nv_frames WAV=public/audio/final8_novo.wav NAME=M1_v13_NoVO bash scripts/encode-final.sh
for f in out/M1_v13_*_Instagram.mp4 out/M1_v13_*_MASTER_ProRes422HQ.mov; do [ -f "$f" ] && mv -f "$f" "$D/"; done

# review copies: full 1080×1920, 60 fps, H.264 High, ~20 Mbps, BT.709 — encoded from the ProRes master
# (never downscaled); plus the same file cut at keyframes into ≤ 10 s parts small enough to send in chat
for v in MaleVO NoVO; do
  M="$D/M1_v13_${v}_MASTER_ProRes422HQ.mov"; R="$D/M1_v13_${v}_REVIEW_1080x1920.mp4"
  X=(-c:v libx264 -preset slower -profile:v high -level:v 5.1 -b:v 20M -maxrate 25M -bufsize 40M -pix_fmt yuv420p -g 60 -bf 2
     -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709:aq-mode=3:psy-rd=1.0,0.15"
     -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
  ffmpeg -y -hide_banner -loglevel error -i "$M" -vf "scale=in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuv420p" "${X[@]}" -pass 1 -passlogfile out/rvpass -an -f null /dev/null
  ffmpeg -y -hide_banner -loglevel error -i "$M" -vf "scale=in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuv420p" "${X[@]}" -pass 2 -passlogfile out/rvpass \
    -c:a aac -b:a 320k -ar 48000 -ac 2 -movflags +faststart "$R"
  rm -f out/rvpass*
  mkdir -p "$D/review_parts_${v}"
  ffmpeg -y -hide_banner -loglevel error -i "$R" -c copy -map 0 -f segment -segment_time 10 -reset_timestamps 1 "$D/review_parts_${v}/M1_v13_${v}_REVIEW_part%02d.mp4"
done

# stems (48 kHz / 24-bit)
cp public/audio/vo8.wav "$D/M1_v13_MaleVO_Voiceover_clean_48k24.wav"
cp public/audio/final8_bed_vo.wav "$D/M1_v13_MusicSFX_stem_48k24.wav"
cp public/audio/final8_novo.wav "$D/M1_v13_NoVO_mix.wav"
cp vo/script_final.md "$D/M1_v13_Voiceover_Script_and_timing.md"

# contact sheet (every 1.5 s) and the two location holds
ffmpeg -y -hide_banner -loglevel error -i "$D/${VNAME}_Instagram.mp4" -vf "select='not(mod(n\,90))',scale=216:384,tile=9x5" -frames:v 1 -q:v 3 "$D/M1_v13_contact_sheet.jpg"
python3 - <<'PY'
import json, shutil
V = json.load(open("timeline.json"))["v8"]
i = V["intro"]; s = V["sig"]
o = round(((i["doha"][1] + i["hold"][1]) / 2) * 60)
f = round((s["settled"] + V["duration"]) / 2 * 60)
shutil.copy(f"out/v13_frames/element-{o:04d}.png", "out/final/M1_v13_opening_logo_DOHA_QATAR.png")
shutil.copy(f"out/v13_frames/element-{f:04d}.png", "out/final/M1_v13_end_logo_DOHA_QATAR_url.png")
print("stills", o, f)
PY
ls -l "$D"
# motion QA (velocity curves sampled from the composition's own motion functions)
mkdir -p "$D/QA"
cp qa/out/*.png qa/out/motion_qa.json "$D/QA/" 2>/dev/null || true
