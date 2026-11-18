# Plan: keeping Instagram advertising and video production out of the website repository

**Status: a plan only. Nothing described here has been done.** The owner's decision is HD-0019 (requirement REQ-OPS-012, ADR-0014). In the run that wrote this plan, no creative file and no Reel commit was moved, deleted, reset, rebased, rewritten or modified, and nothing was pushed. Every step marked **needs approval** waits for the owner's explicit message; approving this document is not approving a step.

**Evidence tags.** **[O]** observed by read-only commands in the development container on 2026-11-17. **[U]** not verified.

## 1. The requirement

The website repository must not contain: rendered Instagram videos; Instagram advertising projects; Remotion projects used solely for Instagram production; video-generation scripts used solely for marketing; temporary video exports or generated Reel assets. Website assets that the website genuinely needs are separate and permitted. The Instagram **links** on the website (for example the contact and quote pages, which read the profile address from the site configuration) are website features and stay.

## 2. What exists today (observed)

| Place | Tracked files under `creative/` | Notes |
|---|---|---|
| `origin/main` (production) | **0** [O] | No commit on `main` has ever touched `creative/` [O]. The production repository history is clean |
| `origin/claude-dev` (staging, published) | **140** files, 1,173,908 bytes [O] | 30 commits, 2026-09-28 to 2026-10-05: the showreel project and motion ad versions up to v13 |
| `origin/claude/ops-0002-ci-baseline`, `origin/claude/ops-0003-trusted-ci` (published) | 140 each [O] | They inherit the files from `claude-dev`; they changed nothing under `creative/` |
| Local `claude-dev` in the main working tree (`187e045`) | **196** files, 1,648,538 bytes [O] | Eight **unpublished** Reel commits (`6fdb97d` to `187e045`, 2026-11-16) add 56 files and modify 4 (60 paths, +10,064 −2), all under `creative/motion-ad/` [O] |
| Local OPS branches | 140 each [O] | Built from the published `claude-dev` |

**Two projects.** `creative/motion-ad/` is a Remotion project for the 9:16 Instagram Reels (capture rig, compositor, Python score and sound synthesis, voice-over line manifests, QA, delivery scripts). `creative/website-showreel/` is a Remotion and Three.js 9:16 product film built from captures of the website. Both state in their own READMEs that they are isolated video-production projects that nothing in the website imports. The website-showreel's name says "website", so it is listed for the owner's confirmation (OQ-0038); it is classified here as marketing video production.

**What is not tracked, and exists only on this container's disk [O]:** 5.4 GB under `creative/motion-ad/`, ignored by that project's own `.gitignore` files: `out/` 4.1 GB (render frames), `exports/` 711 MB (14 rendered MP4 files totalling about 197 MB, plus the music, voice and phone-speaker stems of each revision), `public/` 334 MB (brand assets, fonts, audio and screenshots the project reads), `node_modules/` 276 MB, `vo/` 18 MB. **None of this is in any Git history and none is on GitHub.** The container is ephemeral: it is reclaimed after inactivity. Until a copy exists elsewhere, **this disk holds the only copy of the rendered Instagram work and of the eight unpublished commits.**

**Coupling with the website [O]:** `eslint.config.mjs` ignores `creative/**` and `tsconfig.json` excludes `creative`; nothing in `src/`, `public/`, `package.json`, `package-lock.json` or `next.config.ts` references `creative/`; `next build` does not read it; `creative/` has its own `package.json` files and lockfiles; no video or audio file is tracked anywhere in the repository; the website's `public/` has none. The two configuration lines are harmless if `creative/` disappears and are **left unchanged** by this plan (the owner said to keep website files unchanged).

**Content scan [O]:** no credential-shaped string in any tracked `creative/` file. The two READMEs show example command lines containing the business's public contact address and a placeholder number as environment-variable values; the address is public on the website. It is not a secret, but CLAUDE.md section 12 asks that real contact details configured through environment variables not be committed, so the owner may want it noted.

## 3. Classification

| Path | Class | Reason |
|---|---|---|
| `creative/motion-ad/**` | Instagram production: **remove from the website repository** | Remotion project and scripts used solely to produce Instagram Reels |
| `creative/website-showreel/**` | Marketing video production: **remove from the website repository** (owner to confirm, OQ-0038) | Remotion/Three.js video project; not imported by the website |
| Untracked renders, exports, frames, audio, voice, `node_modules` under `creative/motion-ad/` | Instagram production: **preserve outside, never commit** | Generated Reel assets |
| `eslint.config.mjs` ignore entry, `tsconfig.json` exclude entry | Website configuration: **unchanged** | Harmless; removing them is a separate, optional decision |
| Instagram links and text in `src/` | Website feature: **unchanged** | Not video production |
| Website assets under `public/` | Website: **unchanged** | None found that belong to the Instagram work |

## 4. The plan, in phases

Each phase ends with a stop for the owner. Nothing in a later phase starts before the earlier one is confirmed.

### Phase 0: done in this run (documentation and read-only copies)

- The permanent rules are recorded (HD-0018, HD-0019, REQ-OPS-011, REQ-OPS-012, REQ-OPS-013, CLAUDE.md sections 3, 13 and 14, ADR-0014, policy PROHIB-017). These are **instructions to Claude sessions**, not technical enforcement.
- Read-only copies of the **tracked** Instagram work were made **outside the repository** (in the development session's scratch space, which is also ephemeral) so that they can be handed to the owner: a git bundle of the eight unpublished commits (it requires `b7348bb`, the published `claude-dev`, to be restored), the same eight commits as a patch file, and a tar archive of the tracked `creative/` files at `187e045`.

  | Copy | SHA-256 |
  |---|---|
  | `m1-reel-8-local-commits_6fdb97d-187e045.bundle` (157,195 bytes) | `f342799a07c2ece56f5666acce514e73731b0d44c796d6c22cf43c3f33de17ca` |
  | `m1-reel-8-local-commits.mbox` (705,831 bytes) | `581fe1acbb3ecc14331a34b2bbe79396cb6776c8ed0cecb16a7cfcfb3a821a8a` |
  | `m1-creative-tracked-files-at-187e045.tar.gz` (423,015 bytes) | `56155c5bb9be2b06cb1c4890dfebdc9734a979284d26393cf16d3bf8f83196fb` |

  The copies do not include the 5.4 GB of untracked renders.

### Phase 1: the owner chooses where the Instagram work lives (needs a decision: OQ-0038)

Options, with what each needs:

1. **A separate private GitHub repository** owned by the owner, for the Instagram work only. Pros: versioned, a browser session can work in it. Needs: the owner creates it; a session can use it only if it is attached to that session (a repository is chosen when a session starts); rendered video above 100 MB per file would need Git LFS or release assets; GitHub's repository size guidance applies. No GitHub setting of the website repository changes. The development session cannot create it without the owner's approval.
2. **The owner's own storage** (a drive or a cloud folder), by downloading the files from a session. Needs: a way to get 197 MB to 711 MB out of the container; the Claude app can deliver files, but a size limit is not verified [U].
3. **Another arrangement** the owner prefers.

Either way, Phase 1 also decides whether the project's `out/` (4.1 GB of render frames) and `node_modules/` (276 MB) are kept: both can be regenerated from the sources, `out/` at the cost of re-rendering for hours.

### Phase 2: preserve the originals (needs approval; reads only)

1. Copy to the chosen home: the three Phase 0 files, the complete `creative/motion-ad/exports/` (the 14 MP4 files and every stem), `creative/motion-ad/vo/`, the `public/` inputs, and `creative/website-showreel/`. `git bundle create <home>/m1-local-claude-dev.bundle claude-dev` is also useful; it may fail in a shallow clone, in which case the existing eight-commit bundle plus the published history is equivalent.
2. Write a checksum list (SHA-256 of every file) beside the copies, and record the list's own hash in project memory.
3. **The owner opens and plays a sample** (at least one MP4 from each export folder) and confirms the archive. **Nothing is removed before this confirmation.**

### Phase 3: prevent new Instagram files (design now; lands with Phase 4)

- **Instruction layer (done in Phase 0):** CLAUDE.md section 13 and policy PROHIB-017 tell every worker and reviewer never to add such files.
- **Technical layer (needs approval, an OPS task):** a check in `ops/validate-memory.mjs`, run by the existing CI step `npm run ops:validate`, that fails when the tree contains `creative/**`, a Remotion configuration, an `exports/` or `out/` directory, or a media file (`.mp4`, `.mov`, `.webm`, `.wav`, `.mp3`) outside an owner-maintained allowlist (empty today); `.gitignore` entries for the same patterns; tests and a mutation check in the style of OPS-0003 and OPS-0004. It must land **in the same change as the removal** (Phase 4), because it would turn CI red while `creative/` is still tracked.
- **Server-side layer (owner setting):** GitHub rulesets can restrict file paths on some plans; whether this repository's plan offers it is **not verified [U]**. It would be a repository-settings change and needs the owner's decision.
- The policy's `PATH-040` rule (class B, protected, for `creative/**`) stays: deleting the files is a class B change that a human approves, which is exactly the intended route.

### Phase 4: remove the files from the development state (needs approval; a normal reviewed change)

1. In a **new worktree** from the published `origin/claude-dev` (not from the main working tree, which holds the unpublished commits, the mode change and 5.4 GB of renders), create `claude/<task>-remove-instagram-files` and `git rm -r creative/`. Leave `eslint.config.mjs` and `tsconfig.json` as they are. Add the Phase 3 guard in the same change.
2. Verify, by the project's own checks, that nothing else moved: lint, type check, `npm run build` with a same-path build comparison against the base, `ops:validate`, `ops:test`. The website output must be byte-identical apart from per-build randomness.
3. Push the branch (explicit approval), let CI run, then merge into **`claude-dev` (staging)**, check the preview, and only then does the owner decide about production. **`main` has no `creative/` today and needs no change.** The release of `claude-dev` to `main` must be built so that Instagram history does not enter `main`: use a squash merge or a cherry-picked release branch, as the earlier release from `origin/main` did (HD-0018).
4. **The eight unpublished Reel commits are never pushed.** Pushing them would publish 56 more files. In the main working tree the local `claude-dev` branch stays as it is until the owner decides separately (OQ-0039, part b) whether to keep it as a local archive branch (the commits are preserved by the Phase 2 bundle) or to reset it to `origin/claude-dev` after the archive is confirmed. That reset is **not** part of this plan's approval. The uncommitted mode change on `creative/motion-ad/scripts/deliver-v8.sh` stays untouched until then.

### Phase 5: keep it that way

CI runs the Phase 3 guard on every branch; workers and reviewers read CLAUDE.md section 13; any task that needs a marketing video stops and reports that it belongs outside this repository.

## 5. What remains accessible in Git history

Removing the files from the branch tip is a new commit; it does not erase anything.

- **On `claude-dev`, `claude/ops-0002-ci-baseline`, `claude/ops-0003-trusted-ci` and everything built on them:** all 140 published files, with every earlier version across the 30 commits, remain reachable by commit id (`git show <commit>:creative/...`) and in every existing clone or fork, forever. The repository is public, so others may already hold copies.
- **On `main`:** nothing, today. A merge commit from `claude-dev` would make the whole of `claude-dev`'s history, including these commits, part of `main`'s history even though the files are gone from the tree. Hence the squash or cherry-pick rule in Phase 4.
- **The eight unpublished commits:** exist only locally (and in the Phase 0 and Phase 2 copies). They stay out of GitHub.
- **Sensitivity:** the scan found no credential and no customer or supplier data. The history is a matter of the owner's preference for separation, not an exposure to rotate.

**Rewriting published history** (for example `git filter-repo` followed by a force-push of `claude-dev`) would remove the files from `claude-dev`'s history but: change the id of every later commit and so of the OPS-0002, OPS-0003 and OPS-0004 branches; break the recorded CI run and review-packet hashes and any clone or pull request; not remove forks, caches or copies; and need a force-push, which the policy forbids without separate approval (PROHIB). **It is not recommended and is not part of this plan.** If the owner wants it, it needs its own explicit approval and a separate plan (OQ-0039, part a).

## 6. Approvals needed, in order

1. OQ-0038: where the Instagram work lives, and confirmation that `website-showreel` is marketing production.
2. Phase 2: copy the originals there, and the owner's confirmation of the archive.
3. Phase 3 and 4: an OPS task for the guard and the removal, its push, its merge into `claude-dev`, and later the production release rule.
4. OQ-0039: history (a) rewrite or not (recommended: not) and (b) what to do with the local `claude-dev` branch after the archive is confirmed.

## 7. Risks and how each is covered

| Risk | Cover |
|---|---|
| The container is reclaimed before the originals are copied | Phase 0 copies of the tracked work; Phase 1 and 2 as soon as the owner chooses a home. Until then the 5.4 GB exists only on this disk |
| A removal commit is wrong or removes a website file | `git rm -r creative/` touches only that directory; checks and a same-path build comparison; a normal revert restores it |
| A future worker re-adds Instagram files | Instructions now; the technical guard and the CI check in Phase 3 and 4 |
| `claude-dev` is later merged to `main` and drags Instagram history in | Squash or cherry-pick rule (HD-0018) |
| The eight local commits are pushed by accident | CLAUDE.md sections 3, 10 and 13; no push is authorised without the owner naming the branch |
