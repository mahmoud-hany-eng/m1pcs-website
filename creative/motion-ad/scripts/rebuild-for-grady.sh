#!/usr/bin/env bash
# Re-time the PICTURE to Grady's real read (after `python3 vo/grady.py <folder>` has collected his lines
# into vo/lines/grady and measured their sync words): timeline from his read → recapture the real site at
# the new cues → render both versions → mix → deliver.
# Needs the main-branch site checkout (SITE_DIR, default ../m1pcs-website-main) for the captures.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE_DIR=${SITE_DIR:-/home/user/m1pcs-website-main}
VO_DIR=lines/grady python3 vo/build8.py
( cd "$SITE_DIR" && NEXT_PUBLIC_WHATSAPP_NUMBER=97400000000 NEXT_PUBLIC_CONTACT_EMAIL=info@monepcs.qa NEXT_PUBLIC_CONTACT_PHONE=97400000000 npx next start -p 5400 ) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
until curl -s -o /dev/null http://localhost:5400/; do sleep 1; done
rm -rf public/cap/journey8 public/cap/cta8
NODE_PATH=/opt/node22/lib/node_modules node capture/shot-journey8.js
NODE_PATH=/opt/node22/lib/node_modules node capture/shot-cta8.js
python3 audio/score_v8.py
rm -rf out/bundle out/v11_frames out/v11_novo_frames
bash scripts/render-v11.sh vo 4
bash scripts/render-v11.sh novo 3
bash scripts/deliver-v11.sh
