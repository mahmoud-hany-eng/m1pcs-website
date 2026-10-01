# M1 motion ad (isolated)

A 9:16, 60 fps motion-design ad for monepcs.qa built from the REAL website
(main branch) and REAL repo assets. Nothing here is part of the website
build (`creative/` is excluded from the site's tsconfig and ESLint).

See `STORYBOARD.md` for the reference analysis and the shot plan.

## How it works

1. **Capture** — `capture/rig.js` drives Playwright Chromium against the site
   with a frozen, stepped clock (Playwright `page.clock`) and every Web
   Animation frozen at birth and stepped by the same 1/60 s, so real scroll,
   hover, press, click and navigation are recorded deterministically at
   60 fps, 432×768 viewport @ DPR 3.75 (1620×2880 PNG per frame).
2. **Composite** — Remotion (`src/`), 1080×1920 @ 60 fps. Camera moves on the
   live footage, vector cursor at the recorded mouse positions, centred-shutter
   motion blur only where things move fast (`src/lib/MotionBlur.tsx`).
3. **Audio** — `audio/engine.py` synthesises the score and every SFX from
   scratch (no samples, commercially unambiguous), placed from the same
   timeline + capture log.

## Rebuild the style proof

```bash
# site: main branch build served on :5400
cd ../../../m1pcs-website-main && npx next start -p 5400 &
cd -
npm install
bash scripts/sync-assets.sh ../../../m1pcs-website-main/public
NODE_PATH=$(npm root -g) node capture/shot-home.js     # ~3 min, 198 frames
python3 audio/score_proof.py                           # needs numpy + scipy
npx remotion render src/index.ts Proof out/proof.mp4 --codec=h264 --crf=10 \
  --pixel-format=yuv420p --color-space=bt709 --audio-codec=aac --audio-bitrate=320k --x264-preset=slower
# tag the transfer function correctly (Remotion writes sRGB):
ffmpeg -i out/proof.mp4 -c copy -bsf:v h264_metadata=transfer_characteristics=1 out/proof-tagged.mp4
```
