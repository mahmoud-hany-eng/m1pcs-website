# M1 — "Build Yours" · 9:16 motion ad · storyboard

1080×1920 · 60 fps · ~18 s · 116 BPM (beat 0.517 s; impact/downbeat at 1.552 s).
Everything on screen is either the REAL website (main branch, captured live at
60 fps with real scroll / hover / press / click / navigation) or a REAL repo
asset (logo, completed-build photos, hero PC). No mockups, no stills panned.

## Motion language taken from the references

| Reference | What it does | How M1 uses the *idea* (not the art) |
|---|---|---|
| A 0–1 s | small square "pixel" particles lead a text reveal | yellow pixel blocks resolve the real M1 wordmark |
| A 1.17 / 9.17 | single-frame flash on the beat to swap states | one soft red flash frame on the impact downbeat only |
| A 2.1 / B 5.3 | radial / whip motion-blur moves between ideas | camera fly-through *into* the logo; whip-scroll in the form |
| A 3.5 / B 6.0 | UI materialises from defocus | website emerges through the logo's notch, out of blur |
| A 5–8 / B 7.8 | camera locks to the cursor/input and tracks it, big | camera follows the real cursor onto the real CTA |
| A 7.9 | the *click* launches the transition | press → the real red button grows into the next scene |
| B 1.4 | logo match-cut into the same logo inside the UI | fly-through lands on the site whose hero opens on the logo |
| B 2–4 | glowing selection highlight travels between items | real pill selections snap gold, each with its own motion |
| B 10 / 15 | UI element morphs into the next state (input → bubble) | chosen spec pills consolidate and become the next transition |
| A + B audio | every visual event has a sound; music sits under SFX | click, tick, pop, whoosh, riser, impact on the 116 BPM grid |

Rules: something moves every frame; no idea repeats; each transition is caused
by an interaction or an object (logo, button, pills, PC, route pin).

## Shots

| # | Time | Picture (REAL source) | Transition out | Sound |
|---|---|---|---|---|
| 1 | 0.00–1.55 | **Logo.** Real `logo.png`. Red emblem assembles from 16 horizontal slices sliding in from alternating sides with directional blur; yellow wordmark resolves through a grid of pixel blocks; a red light streak and a specular sweep cross it. | Camera accelerates *into the emblem's V-notch*; the strokes fly past the lens and the live homepage emerges through the gap. Impact on the downbeat. | electric ticks, slice snaps, shimmer, rising whoosh → sub impact |
| 2 | 1.55–4.14 | **Homepage, live (mobile).** Hero entrance still settling; eased real scroll brings "Build Your PC" up; real cursor glides in, camera follows and pushes; real hover darkens the button; real press. | The pressed button's own red shape grows over the frame (camera rushes with it), then opens from the centre onto the real Build My PC page. | soft air as cursor enters, hover tick, two-part click, rising swoosh, reveal "shoop" |
| 3 | 4.14–7.2 | **Build My PC, live.** Real "Build a Complete PC" pill click → real category questions appear. Real selections, each a different move: Primary use *Gaming* (snap-zoom pop), Target resolution *1440p* (camera slides along the row), Target FPS *144+ FPS* (whip-scroll with directional blur, magnetic settle), Build colour (quick tactile tap). Copy: YOUR PC. YOUR WAY. | The four selected pills lift off the page (crops of the real frame at their DOM rects) and converge into a single bright point. | pop / tick / slide / snap, each different; convergence riser |
| 4 | 7.2–10.1 | **Real builds.** The point blooms into a depth field of real completed-build cutouts (repo `public/builds/*`); camera dollies through; one PC passes the lens as a wipe; the 9800X3D / RTX 5080 build becomes hero; lands on the real homepage "Built by M1." runway where the real cursor clicks next (real runway animation). Copy: REAL BUILDS. | Runway's active PC slides out of frame as the sourcing route draws on. | stereo pass-bys, low thud as hero lands, click |
| 5 | 10.1–12.5 | **U.S. sourcing.** Real homepage "Parts & Sourcing" section with its real animated route (parcel U.S. → QATAR); camera tracks the parcel. Copy: SOURCED FROM THE U.S. | The QATAR pin's red dot expands into the next scene. | fast whoosh along the route, ping at Qatar |
| 6 | 12.5–15.0 | **Built / set up / ready.** Real category words (GPUs, CPUs, RAM, SSD / Storage from the real Parts section) fly in and snap toward the real featured PC (`hero/featured-build.webp`), its lighting brightening with each snap. Copy: BUILT. SET UP. READY. (one word per beat) | PC pulls back; real Final CTA section rises behind it. | mechanical snaps, power-up hum |
| 7 | 15.0–18.0 | **CTA.** Real "Ready to build yours?" section; cursor hovers the real Build Your PC button; page dissolves to black leaving the real logo, BUILD YOURS., monepcs.qa, and the real gold Get a Quote pill; one light sweep. | — | final sonic sting + controlled bass hit |

## Technical approach

- **Capture** (`capture/rig.js`): Playwright Chromium against the main branch, page clock frozen
  and stepped 1/60 s per frame; every Web Animation (CSS transitions, Framer Motion's native
  tracks) frozen at birth and stepped by the same dt. Viewport 432×768 (exactly 9:16) at DPR
  3.75 → 1620×2880 PNG per frame (1.5× the delivery size). Mouse events are real; element
  rects are recorded per frame so composited effects lock onto real UI.
- **Composite** (`src/`): Remotion 4, 1080×1920 @ 60 fps. Camera = transforms on the live
  footage; camera motion blur via `@remotion/motion-blur`; cursor drawn as vector at the
  recorded mouse positions.
- **Audio** (`audio/`): procedural score + SFX rendered sample-accurately from the same
  timeline (commercially unambiguous; licensed tracks can replace it).
- **Delivery:** H.264 High, yuv420p, BT.709 tagged, CRF ≤ 14, 60 fps, AAC 320 kbps.
