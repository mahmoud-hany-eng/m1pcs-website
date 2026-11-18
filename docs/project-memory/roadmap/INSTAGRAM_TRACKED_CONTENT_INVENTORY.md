# Inventory: Instagram and marketing-video content tracked on the staging branch

**Status: an inventory only. Nothing listed here was moved, deleted, rewritten or published by the staging integration.** It exists so that the later, separate cleanup (phase 4 of [INSTAGRAM_SEPARATION_PLAN.md](INSTAGRAM_SEPARATION_PLAN.md)) starts from an exact list.

**Source of the list.** `git ls-tree -r -l origin/claude-dev -- creative` at revision `b7348bb1c347790a4917d822960134363669efd6`, the published staging branch, observed on 2026-11-18. The staging integration branch carries exactly the same files, because its diff against that revision touches no path under `creative/` (checked: 0 of 147 changed paths).

**Owner rule (HD-0019, REQ-OPS-012).** Instagram production stays outside the website repository. These files are the part of that production which was committed before the rule existed. They are not part of the website, are not imported by it, and are excluded from linting and type checking by the website's own configuration.

## 1. Summary

| Item | Value |
|---|---|
| Tracked files under `creative/` on `claude-dev` | **140**, 1173908 bytes |
| Projects | `creative/motion-ad/` (Remotion project for 9:16 Instagram Reels: capture rig, compositor, Python score and sound synthesis, voice-over line manifests, QA and delivery scripts), 120 files; `creative/website-showreel/` (Remotion and Three.js showreel), 20 files |
| Rendered videos, audio or images tracked | **None.** The tracked content is source: 47 `.tsx`, 22 `.py`, 19 `.json`, 18 `.ts`, 13 `.js`, 11 `.sh`, 6 `.md`, 3 `.gitignore`, 1 `.mjs` |
| Largest files | `creative/motion-ad/src/data/world-dots.json` (54,465 bytes) is the largest source file; the two `package-lock.json` files are 94,814 and 124,629 bytes |
| Referenced by the website | No. `src/`, `public/`, `package.json`, `package-lock.json` and `next.config.ts` do not refer to it; `eslint.config.mjs` ignores `creative/**` and `tsconfig.json` excludes `creative` |
| Content scan of the tracked files | No credential-shaped string was found when the plan was written; this inventory lists names, sizes and blob ids only and was not re-scanned for content |
| On `main` (production) | **0** files. No commit on `main` has ever touched `creative/` |
| Eight unpublished Reel commits | **Not in this list and not in the integration.** They exist only on the local `claude-dev` branch of the main working tree (56 files added, 4 modified, all under `creative/motion-ad/`) and were not touched |
| Untracked renders (about 5.4 GB on the development machine) | Not in git, not listed, never to be committed |

## 2. By directory

| Directory | Files | Bytes |
|---|---:|---:|
| `creative/motion-ad` | 8 | 125,521 |
| `creative/motion-ad/audio` | 9 | 125,812 |
| `creative/motion-ad/capture` | 11 | 66,239 |
| `creative/motion-ad/qa` | 3 | 9,309 |
| `creative/motion-ad/scripts` | 13 | 22,052 |
| `creative/motion-ad/src` | 55 | 557,240 |
| `creative/motion-ad/vo` | 21 | 87,614 |
| `creative/website-showreel` | 6 | 137,275 |
| `creative/website-showreel/audio` | 1 | 3,945 |
| `creative/website-showreel/capture` | 2 | 12,612 |
| `creative/website-showreel/public` | 1 | 251 |
| `creative/website-showreel/src` | 10 | 26,038 |
| **Total** | **140** | **1,173,908** |

## 3. What must not happen to these files in the integration

- They are not added to, removed from or changed on the integration branch. Removal is a separate class B change that needs the owner's approval (policy rule PATH-040) and the preparation steps of the separation plan: the owner chooses where the Instagram work lives (OQ-0038), the originals are preserved and confirmed, and only then does a reviewed change remove them from a new worktree that starts at the published staging branch.
- The cleanup must not start from the main working tree, which holds the eight unpublished Reel commits, a mode-only change and gigabytes of untracked renders.
- The cleanup must leave the website's build output unchanged (same routes, same pages, same markup apart from the build identifier); the method used for the integration is in [STAGING_INTEGRATION.md](STAGING_INTEGRATION.md), section 6.

## 4. Complete list (path, bytes, first ten characters of the git blob id)

A later cleanup can use the blob ids to confirm that it removes exactly what was inventoried.

```text
creative/motion-ad/.gitignore	230	46559ab26a
creative/motion-ad/README.md	3261	4168f15de5
creative/motion-ad/STORYBOARD.md	5842	77ee08ad07
creative/motion-ad/audio/engine.py	10552	616fc03651
creative/motion-ad/audio/physical.py	6394	5d834e8b97
creative/motion-ad/audio/score_final.py	16523	9671951794
creative/motion-ad/audio/score_proof.py	5318	a8e063e0e1
creative/motion-ad/audio/score_v5.py	6635	dd6b1151db
creative/motion-ad/audio/score_v6.py	20416	33f8dd4049
creative/motion-ad/audio/score_v7.py	24303	41cee43fc4
creative/motion-ad/audio/score_v8.py	31675	c1e089b51e
creative/motion-ad/audio/sfx_lib.py	3996	b09591752e
creative/motion-ad/capture/rig.js	4855	2fa9a6b0ac
creative/motion-ad/capture/shot-cta.js	3069	0d78672a47
creative/motion-ad/capture/shot-cta2.js	3000	499d1cfb90
creative/motion-ad/capture/shot-cta7.js	3065	3c88c07671
creative/motion-ad/capture/shot-cta8.js	4437	2f21fb7cb8
creative/motion-ad/capture/shot-home-v5.js	3287	5ad1a12d19
creative/motion-ad/capture/shot-home.js	5212	d1783eddca
creative/motion-ad/capture/shot-journey.js	9896	c3f4c26657
creative/motion-ad/capture/shot-journey2.js	11166	9a50186a29
creative/motion-ad/capture/shot-journey7.js	8593	4fd54a4654
creative/motion-ad/capture/shot-journey8.js	9659	1f5cd8eed3
creative/motion-ad/package-lock.json	94814	6e0b298a41
creative/motion-ad/package.json	510	ed8b25f91b
creative/motion-ad/qa/.gitignore	5	89f9ac04aa
creative/motion-ad/qa/motion-curves.ts	2176	fd847bdea1
creative/motion-ad/qa/plots.py	7128	4c6662783e
creative/motion-ad/remotion.config.ts	260	f571f96157
creative/motion-ad/scripts/deliver-v11.sh	2858	c0440fb1fb
creative/motion-ad/scripts/deliver-v12.sh	2558	dc655f3943
creative/motion-ad/scripts/deliver-v13.sh	3873	d0e772589a
creative/motion-ad/scripts/deliver-v8.sh	2367	05d20e74d8
creative/motion-ad/scripts/encode-final.sh	1755	8573658e10
creative/motion-ad/scripts/novo_ranges.py	1038	1a8984e59d
creative/motion-ad/scripts/render-ranges.sh	648	26af802e7d
creative/motion-ad/scripts/render-resume.py	1342	8b4c352fed
creative/motion-ad/scripts/render-v11.sh	1304	77cd774a5f
creative/motion-ad/scripts/render-v12.sh	1304	c15b127c74
creative/motion-ad/scripts/render-v13.sh	1304	c7cc195368
creative/motion-ad/scripts/stills.mjs	731	6ccee48c0a
creative/motion-ad/scripts/sync-assets.sh	970	4759ce631b
creative/motion-ad/src/Root.tsx	1876	0fad849e4c
creative/motion-ad/src/data/emblem-outline.json	572	9b36e85ad0
creative/motion-ad/src/data/wordmark-blocks.json	5509	a6e820c2d9
creative/motion-ad/src/data/world-dots.json	54465	9319ec726b
creative/motion-ad/src/final/Builds.tsx	14751	16519ed424
creative/motion-ad/src/final/Chat.tsx	22212	0f68e99b28
creative/motion-ad/src/final/Cta.tsx	4881	e16e63d83c
creative/motion-ad/src/final/Final.tsx	1640	76727c26b9
creative/motion-ad/src/final/Journey.tsx	18946	7e80472e34
creative/motion-ad/src/final/Route.tsx	7285	610c4376f7
creative/motion-ad/src/final/Touch.tsx	2116	efd5ea1fd9
creative/motion-ad/src/final/fonts.tsx	1253	4ed5e3a642
creative/motion-ad/src/final/morph.ts	2163	2b90ef9c66
creative/motion-ad/src/final/shared.ts	3568	66a12195e6
creative/motion-ad/src/index.ts	93	e78af8ba34
creative/motion-ad/src/lib/Cursor.tsx	1272	5cbfb406c3
creative/motion-ad/src/lib/MotionBlur.tsx	1275	9aa4d6e435
creative/motion-ad/src/lib/SiteFrame.tsx	2151	c14ab825da
creative/motion-ad/src/lib/ease.ts	2174	745c080011
creative/motion-ad/src/proof/LogoReveal.tsx	8041	7d0cc3e281
creative/motion-ad/src/proof/Proof.tsx	14619	bdb3061f79
creative/motion-ad/src/v5/EmblemPlane.tsx	8015	07568829cc
creative/motion-ad/src/v5/ProofV5.tsx	12956	58e9ff89ba
creative/motion-ad/src/v6/Chat6.tsx	26621	d9e8b75c45
creative/motion-ad/src/v6/Final6.tsx	1432	f58bba6e11
creative/motion-ad/src/v6/Journey6.tsx	23445	ba9cbcc1f2
creative/motion-ad/src/v6/PC6.tsx	13548	c3440486dc
creative/motion-ad/src/v6/Route6.tsx	14355	d369970017
creative/motion-ad/src/v6/Sig6.tsx	16427	788b11c5ba
creative/motion-ad/src/v6/time.ts	3044	a6c944efa1
creative/motion-ad/src/v7/Devices.tsx	12020	db1a4dce98
creative/motion-ad/src/v7/End7.tsx	12995	35d2521e04
creative/motion-ad/src/v7/Final7.tsx	13625	01ee443d93
creative/motion-ad/src/v7/Intro7.tsx	10359	b801164838
creative/motion-ad/src/v7/MonitorScreen.tsx	14949	fe0b5c8c7f
creative/motion-ad/src/v7/PC7.tsx	13190	7ad9917f2d
creative/motion-ad/src/v7/PhoneChat.tsx	16590	f48a98308d
creative/motion-ad/src/v7/Route7.tsx	14664	acde28df86
creative/motion-ad/src/v7/Test7.tsx	1035	9ae1d3b1d9
creative/motion-ad/src/v7/cams.ts	2391	d89d18b408
creative/motion-ad/src/v7/geom.ts	2276	63f6535203
creative/motion-ad/src/v7/time.ts	2254	03c2ca0e8c
creative/motion-ad/src/v7/world.ts	4806	1d216c0e50
creative/motion-ad/src/v8/End8.tsx	14556	8d02e52b14
creative/motion-ad/src/v8/Final8.tsx	25778	26057c42c3
creative/motion-ad/src/v8/Gallery8.tsx	8979	14d18eecea
creative/motion-ad/src/v8/Intro8.tsx	17686	8cf5042f18
creative/motion-ad/src/v8/Kinetic.tsx	5358	c73873402d
creative/motion-ad/src/v8/Merge.tsx	9188	f5cdf12e6f
creative/motion-ad/src/v8/MonitorScreen8.tsx	16819	2be42324cb
creative/motion-ad/src/v8/PC8.tsx	7816	f8466fa780
creative/motion-ad/src/v8/PhoneChat8.tsx	16855	f8da4de3da
creative/motion-ad/src/v8/Route8.tsx	16029	4a0c126b47
creative/motion-ad/src/v8/spline.ts	3553	effccd7d73
creative/motion-ad/src/v8/time.ts	2764	e96f15a6e3
creative/motion-ad/timeline.json	20289	746e60ec56
creative/motion-ad/tsconfig.json	315	e2ab0684db
creative/motion-ad/vo/README.md	2231	76de043c9d
creative/motion-ad/vo/align.py	4167	166f54505b
creative/motion-ad/vo/asr.py	1843	fccadd9ab1
creative/motion-ad/vo/build8.py	17516	d4c68c63ae
creative/motion-ad/vo/female_ref.py	1723	f9ba515287
creative/motion-ad/vo/lines.json	4237	c4053a4e71
creative/motion-ad/vo/lines/male_mature/align.json	1100	e159bcb31e
creative/motion-ad/vo/lines/male_mature/onsets.json	1185	725b8f4741
creative/motion-ad/vo/lines/male_mature/report.json	3430	7435ed52c9
creative/motion-ad/vo/lines/male_take/align.json	1190	873a513143
creative/motion-ad/vo/lines/male_take/onsets.json	1184	6595d97217
creative/motion-ad/vo/lines/male_take/onsets_report.json	6060	d96897b931
creative/motion-ad/vo/lines/male_take/onsets_scan_cache.json	3895	a48b6e7c22
creative/motion-ad/vo/lines/male_take/report.json	4129	0afdfe9cb5
creative/motion-ad/vo/male_take.py	9043	cdf70751c4
creative/motion-ad/vo/match_female.py	7539	75938f1c52
creative/motion-ad/vo/onsets.py	3139	1ba9b76e94
creative/motion-ad/vo/qa_voice.py	5077	2a1347e765
creative/motion-ad/vo/script_final.md	2574	2ef0a4e4ec
creative/motion-ad/vo/tts.py	2451	de520fb84d
creative/motion-ad/vo/verify_onsets.py	3901	4ccac73e2c
creative/website-showreel/.gitignore	182	727c3e1e31
creative/website-showreel/README.md	11372	8ddfefb47e
creative/website-showreel/audio/build-audio.sh	3945	5d4777488a
creative/website-showreel/capture/capture-elements.js	4661	8debe4c7a4
creative/website-showreel/capture/capture.js	7951	3c2ed8f70c
creative/website-showreel/package-lock.json	124629	1675556d93
creative/website-showreel/package.json	571	660c80990a
creative/website-showreel/public/README.md	251	7e8989ac57
creative/website-showreel/remotion.config.ts	160	0186f4aeea
creative/website-showreel/src/Root.tsx	1786	69162323f5
creative/website-showreel/src/constants.ts	1039	c4c4394dd3
creative/website-showreel/src/index.ts	93	e78af8ba34
creative/website-showreel/src/overlay/EndCard.tsx	2534	45aed45d88
creative/website-showreel/src/overlay/Vignette.tsx	611	3a5a4dee90
creative/website-showreel/src/scenes/Showreel.tsx	10454	7afa278496
creative/website-showreel/src/three/FramePlane.tsx	1839	58eb1cbc67
creative/website-showreel/src/three/Plane.tsx	2597	fd2df90f6a
creative/website-showreel/src/three/camera.ts	4162	7e4bf2ac4c
creative/website-showreel/src/three/easing.ts	923	02377219f2
creative/website-showreel/tsconfig.json	361	0221b83307
```
