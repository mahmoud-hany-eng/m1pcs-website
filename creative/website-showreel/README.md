# M1 Website Showreel

A ~30-second, 9:16, cinematic product film built entirely from real captures
of the **monepcs.qa** website (the `main` branch of this repo, run locally —
this environment can't reach the live domain over the network). No AI-generated
UI, no mockups, no screenshots-on-cards: every interface you see is the real
rendered site, composited as textured planes in a Three.js scene and moved
through with a single continuous camera.

This is an isolated video-production project. **It does not touch, import,
or depend on anything in the production website** (`src/app`, `src/components`,
etc.) — it only *reads* real assets and screen captures of it. Nothing here
should ever be wired into the Next.js app.

## What's in here

```
capture/            Playwright scripts that captured the real website
  capture.js           full-page stills + 3 short interaction recordings
  capture-elements.js  close-up captures of individual UI controls
  raw/                 the original captures (git-ignored, regenerate anytime)
  frames/               extracted JPEG frame sequences from the recordings

public/              What the Remotion project actually reads (git-ignored —
                     regenerate with the two capture scripts + the copy/blur
                     steps in "Rerendering" below)
  stills/              full-page captures + the M1 logo
  stills-blur/         pre-baked gaussian-blur variants (cheap depth-of-field:
                       an out-of-focus plane swaps to this texture — see
                       src/three/Plane.tsx)
  elements/            close-up captures of individual controls/cards
  elements-blur/       blurred variants of the above
  frames/               24fps JPEG sequences of the 3 interaction recordings

audio/
  build-audio.sh       generates the whole score + SFX from scratch with
                       ffmpeg's audio filters (see "Sound design" below)
  score-30.wav          30s bed (for Master)
  score-15.wav          15s bed (for the Cutdown, re-timed to the same beats)

src/
  constants.ts         canvas size, fps, brand colours, the 7 scene windows
                       (as fractions of the 30s reference timeline)
  three/
    camera.ts            the whole camera move: ~24 hand-placed keyframes
                         (position + look-at + fov), eased with smoothstep
    easing.ts             smoothstep / windowT / lerp helpers
    Plane.tsx             a real capture shown as a textured 3D plane, with
                         the sharp/blurred texture swap for depth-of-field
    FramePlane.tsx        same, but for an image-sequence (a recorded
                         interaction) — deterministic frame indexing so
                         every rendered output frame is reproducible
  scenes/
    Showreel.tsx          the whole 30-second choreography: every plane's
                         position/opacity/focus as a pure function of the
                         current frame
  overlay/
    Vignette.tsx           static CSS vignette (cheap, deterministic depth cue)
    EndCard.tsx            the closing black → logo → "BUILD YOURS." →
                         monepcs.qa → "GET A QUOTE" card (pure DOM, so the
                         type stays pixel-crisp)
  Root.tsx / index.ts    registers 4 compositions: Previs (7s), Master (30s),
                         MasterClean (30s, no text overlays), Cutdown (15s)

out/                  Rendered deliverables (git-ignored — see below)
```

## Technical approach

- **Capture**: Playwright (headless Chromium) against the real Next.js
  production build, running locally. No browser chrome, no cursor, no dev
  overlays, no WhatsApp widget (hidden via an injected stylesheet before
  every capture except the two shots that deliberately show it as the CTA).
  Desktop stills are captured at `deviceScaleFactor: 2` (mobile at 3), so
  every plane's source texture is far higher-resolution than it's ever
  displayed at — text stays crisp even under a close camera push.
- **Compositing**: `@remotion/three` (a thin `<ThreeCanvas>` wrapper around
  `@react-three/fiber`) renders one continuous 3D scene. Every capture is a
  flat plane at a fixed world position ("station"); the *camera* moves
  through them, dollying (not zooming — FOV stays in a narrow band) from
  scene to scene. `THREE.DoubleSide` on every plane means the camera can
  pass a plane's depth without a black flash from back-face culling.
- **Depth of field, cheaply**: rather than a real post-processing DOF pass
  (expensive and fragile in headless Chromium), every plane that isn't the
  current focal subject swaps to a **pre-baked, gaussian-blurred texture**
  of the exact same capture (`stills-blur/`, `elements-blur/`) — a plain
  `ffmpeg gblur` pass done once at capture time, applied via a boolean
  `focused` prop. Sharp when it's the story's current focus, softly out of
  focus otherwise. No runtime blur shader.
- **Real interactions**: 3 short Playwright screen recordings (filling the
  Build My PC form, scrolling Completed Builds, scrolling the mobile site)
  were extracted to 24fps JPEG sequences and are played back as a texture
  on a plane (`FramePlane.tsx`), indexed by `floor(elapsedSeconds * 24)` —
  a pure function of the current frame, so the render is fully
  deterministic and reproducible frame-for-frame.
- **Text**: the M1 logo and the four lines of external copy (`BUILT BY M1.`,
  `BUILD YOURS.`, `monepcs.qa`, `GET A QUOTE`) are the *only* things not
  captured from the site — they're plain DOM/CSS on top of the 3D canvas,
  so they're pixel-crisp at any distance. Everything else the viewer reads
  is the real, rendered website.
- **Sound**: the environment's network policy blocks outbound requests to
  royalty-free music libraries, so the whole score is **synthesised from
  scratch** with `audio/build-audio.sh` — a sub-bass pad with a slow
  pumping tremolo, soft filtered pink-noise whooshes timed to each scene
  transition, two UI click blips during the Build My PC interaction, and a
  two-note brand sting at the very end. 100% procedural, so it's
  unambiguously commercially safe. Muxed onto the picture in a separate
  `ffmpeg` pass after Remotion renders the video (see below) — guarantees
  perfect a/v sync since the SFX hit-points are computed from the exact
  same scene-boundary fractions the visuals use.

## Rerendering

### 1. Recapture the website (only if the site or the capture list changed)

```bash
# from the repo root, in a *separate* checkout of main (never the working
# tree you're editing) — this project reads captures, it never writes to
# the site's own source.
git worktree add ../m1pcs-website-main origin/main --detach
cd ../m1pcs-website-main && npm install
NEXT_PUBLIC_WHATSAPP_NUMBER=97400000000 NEXT_PUBLIC_CONTACT_EMAIL=info@monepcs.qa \
  NEXT_PUBLIC_CONTACT_PHONE=97400000000 npx next build
NEXT_PUBLIC_WHATSAPP_NUMBER=97400000000 NEXT_PUBLIC_CONTACT_EMAIL=info@monepcs.qa \
  NEXT_PUBLIC_CONTACT_PHONE=97400000000 npx next start -p 5400 &

cd creative/website-showreel
node capture/capture.js
node capture/capture-elements.js

# copy fresh captures + regenerate the blurred depth-of-field variants
cp capture/raw/{home-hero-clean,build-my-pc-top,products-top,completed-builds-top,contact-top,how-it-works-static,mobile-home-top,mobile-nav-open}.png public/stills/
cp capture/raw/elements/*.png public/elements/
for f in public/stills/*.png; do ffmpeg -y -i "$f" -vf gblur=sigma=14 "public/stills-blur/$(basename "$f")"; done
for f in public/elements/*.png; do ffmpeg -y -i "$f" -vf gblur=sigma=10 "public/elements-blur/$(basename "$f")"; done

# re-extract the 3 interaction clips to 24fps JPEG sequences
ffmpeg -y -i capture/raw/clip-buildmypc-form.webm -vf fps=24 -q:v 3 capture/frames/buildmypc-form/f-%04d.jpg
ffmpeg -y -i capture/raw/clip-completed-builds-scroll.webm -vf fps=24 -q:v 3 capture/frames/completed-builds-scroll/f-%04d.jpg
ffmpeg -y -i capture/raw/clip-mobile-buildmypc-scroll.webm -vf fps=24 -q:v 3 capture/frames/mobile-buildmypc-scroll/f-%04d.jpg
cp -f capture/frames/buildmypc-form/*.jpg public/frames/buildmypc-form/
cp -f capture/frames/completed-builds-scroll/*.jpg public/frames/completed-builds-scroll/
cp -f capture/frames/mobile-buildmypc-scroll/*.jpg public/frames/mobile-buildmypc-scroll/
```

### 2. Preview / edit the choreography

```bash
npm install        # first time only
npm start           # opens Remotion Studio — scrub any composition live
```

Edit `src/three/camera.ts` for the camera move, `src/scenes/Showreel.tsx`
for what's on screen and when (every plane's timing is one `fadeWindow(t, …)`
call — `t` is 0..1 progress through the 30s reference timeline, shared by
all 4 compositions).

### 3. Regenerate the audio (only if the SFX/score needs changing)

```bash
bash audio/build-audio.sh 30 audio/score-30.wav
bash audio/build-audio.sh 15 audio/score-15.wav
```

### 4. Render

```bash
npx remotion render Master out/master-video.mp4 --codec=h264 --crf=15 --pixel-format=yuv420p
npx remotion render MasterClean out/master-clean-video.mp4 --codec=h264 --crf=15 --pixel-format=yuv420p
npx remotion render Cutdown out/cutdown-video.mp4 --codec=h264 --crf=15 --pixel-format=yuv420p

# mux the procedural score onto each picture-locked render
ffmpeg -y -i out/master-video.mp4 -i audio/score-30.wav -c:v copy -c:a aac -b:a 192k -shortest \
  output/M1_Website_Showreel_Master_30s.mp4
ffmpeg -y -i out/master-clean-video.mp4 -i audio/score-30.wav -c:v copy -c:a aac -b:a 192k -shortest \
  output/M1_Website_Showreel_Master_30s_no-text.mp4
ffmpeg -y -i out/cutdown-video.mp4 -i audio/score-15.wav -c:v copy -c:a aac -b:a 192k -shortest \
  output/M1_Website_Showreel_15s.mp4
```

### 5. Cover image

```bash
ffmpeg -y -i output/M1_Website_Showreel_Master_30s.mp4 -ss 20.5 -vframes 1 output/cover.jpg
```

## Known caveats

- **No reference video was actually available in this session** — nothing
  came through as an attachment. The very detailed written brief (3D UI
  planes, camera push-throughs, foreground/midground/background layering,
  screen-to-screen continuity) was used as the creative specification
  directly; the camera language above was built to match it. If you can
  share the reference clip, the camera moves in `src/three/camera.ts` are
  the place to tune against it.
- **Music is procedural**, not a licensed track, because this environment's
  network policy blocks the royalty-free libraries a real edit would pull
  from. It's deliberately restrained and commercially unambiguous, but a
  proper licensed bed (Epidemic Sound, Artlist, etc.) would read as more
  "finished." Swap it by replacing `audio/score-30.wav` / `score-15.wav`
  and re-muxing — the SFX hit-point generator in `build-audio.sh` is
  reusable on its own if you just want the whooshes/clicks/sting under a
  licensed bed.
- **Scene 6 (How It Works)** intentionally does **not** show the site's
  existing cartoon-character 3D animation on that page — the brief was
  explicit that this film is about the real website, not that experience.
  It instead shows the page's own written process copy ("Pick Your Parts",
  "Review Your Quotation", …) as clean floating cards, captured with
  `prefers-reduced-motion` so the real DOM/CSS text renders without the
  animated scene.
