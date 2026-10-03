#!/usr/bin/env bash
# v11 renders (one bundle, reused):
#   Version A (voiceover)    FinalV8      → out/v11_frames       (every frame)
#   Version B (no voiceover) FinalV8NoVO  → out/v11_novo_frames  (only the frames whose kinetic copy differs —
#     the ranges come from the same timeline cues the composition uses; scripts/deliver-v11.sh splices them)
# Usage: scripts/render-v10.sh [vo|novo|range <comp> <dir> <from-to> [concurrency]]
set -euo pipefail
cd "$(dirname "$0")/.."
B=out/bundle
[ -d "$B" ] || npx remotion bundle src/index.ts --out-dir "$B" >/dev/null
r() { npx remotion render "$B" "$1" "$2" --sequence --image-format=png --gl=angle --concurrency="${4:-4}" --frames="$3" --log=error --timeout=120000; }
norm() { for f in "$1"/element-*.png; do b=$(basename "$f" .png); n=${b#element-}; [ ${#n} -lt 4 ] && mv -f "$f" "$1/$(printf 'element-%04d.png' $((10#$n)))"; done; return 0; }
case "${1:-vo}" in
  vo)
    N=$(python3 -c "import json;print(round(json.load(open('timeline.json'))['v8']['duration']*60)-1)")
    r FinalV8 out/v11_frames "0-$N" "${2:-4}"; norm out/v11_frames ;;
  novo)
    for R in $(python3 scripts/novo_ranges.py); do r FinalV8NoVO out/v11_novo_frames "$R" "${2:-3}"; done; norm out/v11_novo_frames ;;
  range)
    r "$2" "$3" "$4" "${5:-2}"; norm "$3" ;;
esac
