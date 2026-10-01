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

## Rebuild the final ad (`Final`, ~20.9 s)

```bash
# site: main branch build served on :5400 (placeholder contact env vars — no
# real numbers ever reach a frame)
cd ../../../m1pcs-website-main && NEXT_PUBLIC_WHATSAPP_NUMBER=97400000000 \
  NEXT_PUBLIC_CONTACT_EMAIL=info@monepcs.qa NEXT_PUBLIC_CONTACT_PHONE=97400000000 \
  npx next start -p 5400 &
cd -
bash scripts/sync-assets.sh                                # logo, builds, site fonts
NODE_PATH=$(npm root -g) node capture/shot-journey.js     # homepage -> Build My PC -> submit (388 frames)
NODE_PATH=$(npm root -g) node capture/shot-cta.js         # the real closing CTA section (132 frames)
python3 audio/score_final.py                              # score + SFX, -14 LUFS, <= -1 dBTP
npx remotion render src/index.ts Final out/final_frames --sequence --image-format=png
bash scripts/encode-final.sh                              # ProRes 422 HQ master + Instagram H.264
```

Structure (`src/final/`): `Journey` (logo, homepage, CTA→emblem morph, the
real quote flow), `Chat` (request card, WhatsApp hand-off, fictional demo
conversation), `Route` (U.S. → Qatar), `Builds` (real-build depth field,
parts, BUILT/SET UP/READY, READY FOR YOU, glide into the site's CTA photo),
`Cta` (real closing section + end card). Every cue time lives in
`timeline.json` (`final.cues`) or comes from the capture log, and both the
picture and `audio/score_final.py` read the same values.
