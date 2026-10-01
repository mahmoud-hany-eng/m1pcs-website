#!/usr/bin/env bash
# Re-render only the given frame ranges of the Final composition into the
# existing PNG sequence (e.g. after a fix): scripts/render-ranges.sh 126-240 430-760
set -euo pipefail
cd "$(dirname "$0")/.."
for r in "$@"; do
  npx remotion render src/index.ts Final out/final_frames --sequence --image-format=png --concurrency=4 --gl=angle --frames="$r"
done
