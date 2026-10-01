#!/usr/bin/env bash
# Encodes the rendered PNG sequence (sRGB, lossless) + the score into:
#  1. a high-quality master: ProRes 422 HQ, 10-bit 4:2:2, PCM 24-bit
#  2. the Instagram delivery: H.264 High, 4:2:0, ~20 Mbps, AAC 320k
# Both tagged BT.709 (primaries / transfer / matrix, limited range).
set -euo pipefail
cd "$(dirname "$0")/.."
FR=out/final_frames
WAV=public/audio/final.wav
NAME=M1_BuildYours_1080x1920_60fps
CS="scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int"
TAGS=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)

ffmpeg -y -hide_banner -loglevel error -framerate 60 -i "$FR/element-%04d.png" -i "$WAV" \
  -vf "$CS,format=yuv422p10le" -c:v prores_ks -profile:v 3 -vendor apl0 -bits_per_mb 8000 "${TAGS[@]}" \
  -c:a pcm_s24le -ar 48000 -shortest -movflags +write_colr "out/${NAME}_MASTER_ProRes422HQ.mov"

ffmpeg -y -hide_banner -loglevel error -framerate 60 -i "$FR/element-%04d.png" -i "$WAV" \
  -vf "$CS,format=yuv420p" -c:v libx264 -preset slower -profile:v high -level:v 5.1 \
  -b:v 20M -maxrate 25M -bufsize 40M -pix_fmt yuv420p -g 60 -bf 2 \
  -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709:aq-mode=3:psy-rd=1.0,0.15" "${TAGS[@]}" \
  -c:a aac -b:a 320k -ar 48000 -ac 2 -shortest -movflags +faststart "out/${NAME}_Instagram.mp4"
echo "encoded out/${NAME}_MASTER_ProRes422HQ.mov and out/${NAME}_Instagram.mp4"
