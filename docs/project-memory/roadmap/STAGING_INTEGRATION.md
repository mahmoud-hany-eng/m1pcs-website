# Staging integration candidate: the OPS-0001 to OPS-0006 control plane on the claude-dev base

**Status: a candidate prepared locally on 2026-11-18. It is not pushed, not merged, not deployed, not independently reviewed, and it has no GitHub Actions run of its own.** Nothing in this document authorises any of those. The owner authorised exactly this: preparing a local staging integration candidate.

Branch roles are permanent (HD-0018, REQ-OPS-011): `claude/**` is development, `claude-dev` is staging and integration testing, `main` is production. This candidate lives on the development branch `claude/ops-staging-integration` and changes neither `claude-dev` nor `main`.

## 1. What was built

| Item | Value |
|---|---|
| Integration branch | `claude/ops-staging-integration`, created in its own worktree, with no upstream |
| Base | `b7348bb1c347790a4917d822960134363669efd6`, the published `claude-dev` (the remote branch was re-read immediately before the work and had not moved) |
| Reviewed candidate | `46459bf5d5b236add897993bd130bd0e09fd019b`, the tip of `claude/ops-0006-review-fixes`: GitHub Actions run 44337895858 succeeded on it (561 of 561 operations tests, read-only token, no deployment step) and its independent advisory review returned "approve with corrections" (as reported to the developer session; that review ran in a session that had already been used for an earlier review) |
| Integration commit | `f43a0990988e13f26e07f21a5855548a71f82ee8`: one explicit, non-fast-forward merge of the candidate into the base. Its parents are the base and the candidate, and its tree is byte-identical to the candidate's tree |
| This record | one further commit that adds this file and the Instagram inventory next to it; it changes nothing else |

## 2. Source-to-staging analysis

- **Ancestry.** The candidate descends directly from the published `claude-dev`: `claude-dev` has 0 commits that the candidate lacks and the candidate has 42 commits that `claude-dev` lacks. The 42 commits are linear (no merges) and are the work of OPS-0001 (4 commits), OPS-0001B (5), OPS-0002 (4), OPS-0003 (5), OPS-0004 (5), OPS-0005B (6), OPS-0006 attempt 1 (8) and OPS-0006 attempt 2 (5).
- **Footprint of every commit.** Each of the 42 commits was checked on its own, not only the end result: every one touches only `.github/`, `CLAUDE.md`, `docs/project-memory/`, `ops/` and `package.json`. No commit touched `src/`, `public/`, `creative/`, a lock file or a website configuration file, and no file was ever added and later removed. The 42 commits add 300 text blobs (3.9 MB in total, the largest 60 KB, none binary).
- **Resulting change against `claude-dev`:** 147 paths, 146 added and 1 modified, 29,118 lines added and 1 removed.
- **The one modified file** is `package.json`, and only its `scripts` block: `ops:validate` and `ops:test` are added. No dependency was added, removed or changed, and `package-lock.json` is identical.
- **Relation to `main`.** `main` has four commits that `claude-dev` lacks (the production integration of the same website content without `creative/`), and its tree outside `creative/` is identical to the tree of `claude-dev`. This integration does not touch `main`; the consequence for a later release is in section 10.

## 3. Method and conflict resolution

1. The remote `claude-dev` was confirmed at the expected revision; the work started in a new worktree, never in the working tree that holds the eight unpublished Reel commits.
2. All 42 commits and the resulting file changes were inspected (section 2) before anything was applied.
3. A dry run (`git merge-tree`) showed the merge conflict-free and the merged tree identical to the candidate's tree.
4. The merge was applied once, with an explicit message that states what is added, what is not touched, what evidence exists for the candidate, and that this commit has none of its own.
5. The merged tree was compared with the candidate's tree again: identical.

**Conflicts:** none. Nothing was resolved by hand, and no file of the website or of the security controls was edited. **Why a merge and not a re-created set of commits:** the run records, the review baselines and the CI evidence refer to commit ids (for example `6f15662`, `a388a1b`, `46459bf`); a copy made by cherry-picking or by copying files would give those references nothing to point at, and the review tools require the baseline and base to be ancestors of the head.

## 4. File-level scope

| Area | Files | Added | Modified | Lines |
|---|---:|---:|---:|---|
| `.github/workflows (CI)` | 1 | 1 | 0 | +49 −0 |
| `CLAUDE.md (worker protocol)` | 1 | 1 | 0 | +168 −0 |
| `docs/project-memory/README.md` | 1 | 1 | 0 | +82 −0 |
| `docs/project-memory/architecture` | 21 | 21 | 0 | +1,228 −0 |
| `docs/project-memory/decisions` | 2 | 2 | 0 | +402 −0 |
| `docs/project-memory/policy` | 1 | 1 | 0 | +338 −0 |
| `docs/project-memory/requirements` | 1 | 1 | 0 | +80 −0 |
| `docs/project-memory/reviewer` | 2 | 2 | 0 | +435 −0 |
| `docs/project-memory/roadmap` | 8 | 8 | 0 | +939 −0 |
| `docs/project-memory/runs` | 10 | 10 | 0 | +4,262 −0 |
| `docs/project-memory/schemas` | 6 | 6 | 0 | +5,245 −0 |
| `docs/project-memory/tasks` | 6 | 6 | 0 | +932 −0 |
| `ops (CLIs)` | 4 | 4 | 0 | +1,387 −0 |
| `ops/lib` | 10 | 10 | 0 | +3,265 −0 |
| `ops/tests` | 17 | 17 | 0 | +5,161 −0 |
| `ops/tests/fixtures` | 55 | 55 | 0 | +5,142 −0 |
| `package.json (2 scripts)` | 1 | 0 | 1 | +3 −1 |

The complete list of the 147 paths is in appendix A. The same list can be reproduced with `git diff --name-status b7348bb1c347790a4917d822960134363669efd6 f43a0990988e13f26e07f21a5855548a71f82ee8`.

## 5. Instagram separation

The owner requires Instagram production to stay outside this repository (HD-0019, REQ-OPS-012). Checked on the 147 changed paths: **0** under `creative/`; **0** media, render or image files (the extensions are `.json` 67, `.md` 46, `.mjs` 31, `.txt` 2, `.yml` 1); no path named after a Remotion project, reel, voice-over, score or storyboard other than the two documents about the separation itself; no Remotion, ffmpeg, speech or browser-automation dependency in `package.json`. The documents that mention Instagram only describe the rule. The eight unpublished Reel commits are not in the history of the branch.

Instagram content that is **already tracked** on `claude-dev` (140 files, 1,173,908 bytes, source only, no rendered file) is inventoried in [INSTAGRAM_TRACKED_CONTENT_INVENTORY.md](INSTAGRAM_TRACKED_CONTENT_INVENTORY.md). It was neither deleted nor rewritten.

## 6. Verification, all local

All checks ran on an export of the integration commit, in a clean environment (only `PATH`, a private `HOME`, `CI=true`, the locale and the proxy and certificate settings; no token or credential). **This is a local simulation of the CI workflow, not a GitHub Actions run, and no live CI result is claimed for this branch.**

| Check | Result |
|---|---|
| `npm ci --ignore-scripts` | 385 packages |
| `npm run lint` | pass |
| `npx tsc --noEmit` | pass |
| `npm run ops:validate` | OK, 146 files, 1 warning (`TASK-UNAPPROVED` for OPS-0006, an existing and expected warning) |
| `npm run ops:test` | **561 tests, 561 pass, 0 fail** |
| `npm run build` | compiled; 56 of 56 static pages |

**Website preservation.** The integration changes no website input: `src/`, `public/`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` and `.gitignore` are identical to `claude-dev`, and the only change in `package.json` is the two scripts. Outputs were also compared, built one after the other in the same directory so that paths do not differ: the base and the integration produce the same 35 prerendered HTML files, identical once the build identifier is normalised, and the same route list. Webpack's numeric module ids and hashed file names vary from build to build (a rebuild of the same integration tree shows it), so raw bytes are not comparable; no difference attributable to the integration was found. Both production servers were started. In one run 11 URLs were fetched and returned the same status codes on both (200 for ten routes, 404 for an unknown path). In a second run 11 URLs (the main pages, one completed-build page, `robots.txt` and `sitemap.xml`) were compared as markup, with scripts removed and the build identifier normalised: identical for all 11, and `robots.txt` and `sitemap.xml` are byte-identical.

**The quotation workflow** is client-side: `QuoteForm` builds a pre-filled message and `src/lib/whatsapp.ts` turns it into a `wa.me` link; there is no server route, action or storage behind it. Those files are unchanged, and the `/build-my-pc` page markup is identical to the base.

**Automation tools from the integrated state.** From the integration commit: the validator passes; the review packet builder produced and the verifier accepted the real OPS-0003 and OPS-0006 attempt 1 packets from the real stored GitHub evidence (the baseline for them descends from the head, so they use the already recorded historical exception HD-0017 in a scratch output only; nothing was granted or recorded); real evidence offered for another comparison is refused; the original OPS-0005 reviewer decision still returns `REQUIRES_CORRECTIONS` with `human_approval_required` true and every automation flag false; the CI-evidence collector runs and reports that human review is required when no GitHub data is given.

**A limit found by this check.** Run for the real staging pull request (base `claude-dev`, head the integration), the trusted-base check refuses: `TB-BASE-NO-LOGIC`, the base holds no `ops/validate-memory.mjs`. The first pull request that introduces the control plane therefore cannot have its CI result anchored to a trusted base: its own workflow and its own tools judge it. The owner has to read the workflow and the `ops/` code of that pull request (section 9). From the next change on, the base has the logic.

## 7. CI and staging configuration

- **Workflow** `.github/workflows/ci.yml`, job `verify` (the name a branch rule must require): triggers are `push` on `claude/**` and `claude-dev`, and `pull_request` into `claude-dev` and `main`; `permissions: contents: read`; no secret, no write permission, no deployment step; two pinned actions by commit id; steps are the credential guard, `npm ci --ignore-scripts`, lint, type check, `ops:validate`, `ops:test` and build. Pushing this branch would trigger it (the `claude/**` filter). `claude-dev` gets the workflow only when the integration is merged there.
- **Staging deployment.** The repository holds no `vercel.json`, no `.vercelignore` and no `.env.example`. Preview builds of branches, the preview for `claude-dev` and the production deployment of `main` are configured in the Vercel project, outside the repository; this integration changes none of it, and its added directories are not read by `next build`. The website reads `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_PHONE`, `NEXT_PUBLIC_ECOMMERCE_LICENCE_NUMBER` and `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, set there, not here. The build warns when they are unset (as in CI) and still succeeds.

## 8. Security limitations carried forward

None of these is resolved by the integration. **F2-a stays unresolved and blocks every unattended approval operation.** The human decision log was not modified and no exception was granted.

| # | Limitation | Why it matters | Status and what resolves it |
|---|---|---|---|
| 1 | **Human approval exceptions are not authenticated (F2-a).** A baseline exception names a record in the decision log (for example `--baseline-exception HD-nnnn`); the tools check that the record exists in the baseline's own log, but that log is a file in the repository that a worker session can edit, so a worker can write the record that lets its own work pass | A decision-log entry is not proof that the owner authorised anything | **Open.** Until an authenticated approval channel exists (OQ-0026, with OQ-0036), no entry in the decision log may be accepted as proof of owner authorisation, and no merge, deployment or sensitive change may be approved automatically or unattended. The owner's explicit instruction in the live session, or the owner's own approval on GitHub, is the only authorisation |
| 2 | **Worker and owner permissions are not separated.** Claude acts through the owner's GitHub identity, which is the repository's only admin | Every rule in GitHub is a rule about identities; with one identity, rules guard against mistakes, not against the automation | **Open** (OQ-0036). A separate automation identity with Write access only is the real hardening ([GITHUB_SETTINGS_GUIDE.md](GITHUB_SETTINGS_GUIDE.md), profile 2) |
| 3 | **`main` and `claude-dev` have no branch protection** (`protected: false` when last observed) | Direct pushes, force pushes and deletions are possible; a release is not forced to show a green `verify` | **Open** (OQ-0034). The owner sets the rulesets in the order of the settings guide, after `verify` has run on the branch to be protected |
| 4 | **Reviewer evidence must be regenerated from GitHub.** The CI evidence file is unauthenticated; a self-consistent forgery with invented GitHub data passes the offline checks | The packet proves consistency, not truth | **Open** (OQ-0035). A reviewer must fetch the run, jobs, check runs and job log from GitHub itself and rebuild the evidence and the packet |
| 5 | **The reviewer workflow is advisory and manually initiated.** A reviewer is a Claude session that the owner starts by hand; read-only behaviour and fresh-session independence are instructed, not enforced (the review of attempt 2 ran in a session that had been used for an earlier review) | An advisory review is not a gate and not an approval | **Open** (OQ-0031, OQ-0033, OQ-0037). Every review must state it is advisory; a fresh session must be checked by its session identifier |
| 6 | **Old review-packet manifests are not necessarily compatible with newer schemas.** The manifest schema gained four required `trusted_baseline` fields in OPS-0006 attempt 2; a manifest written by the earlier tools does not validate against the new schema | A packet must be verified by the tools and schema of its own baseline | Documented. Old packets are verified with their own baseline's tools; a packet is rebuilt, not converted |
| 7 | **The later-attempt branch and report contract is incomplete.** A run report must name the task's single branch, and the packet builder requires `report.json`; a second attempt on another branch cannot have a schema-valid report, so it cannot be reviewed through the packet and gate (`REPORT-BRANCH`, `PK-NO-REPORT`) | Attempt 2 of OPS-0006 could only be reviewed in writing | **Open.** A separate, small, reviewed task would let a task name additional attempt branches; it was not done here |

Also still true: the trusted-base check cannot anchor the first pull request that introduces the control plane (section 6), and OPS-0006 has no human decision record (`TASK-UNAPPROVED`). No limitation above is weakened by this integration.

## 9. Requirements for publishing and reviewing this candidate

**Before any push** (each needs the owner's explicit approval naming the branch):

1. One normal, non-force push of exactly `claude/ops-staging-integration`; no other branch; no pull request, merge or deployment with it.
2. Immediately before the push: the remote `claude-dev` is still `b7348bb1c347790a4917d822960134363669efd6` (if it moved, stop and report); the branch tip is the one the owner approved; its tree equals the candidate's tree except for the two documentation files of this record; the working tree is clean; none of the eight unpublished Reel commits is reachable; the history was scanned for credentials, personal data, local session directories and binaries; the destination is the M1 repository.
3. After the push: find the CI run, read the whole job log, and check the evaluated commit, the read-only token, the absence of any deployment step and the test count; see whether Vercel created a Preview deployment and neither open nor promote it.

**Independent review of the candidate** (advisory, written; a fresh Claude Code session whose identifier differs from the developer's and from every earlier reviewer's, checked rather than assumed): the pinned base, candidate, integration commit and tip; the tree equality; the footprint of every commit; the scope; the hygiene scan; the CI run and its log hash; the Instagram separation; the carried-forward limitations (section 8); and a statement that no gate result exists for this review.

**Before the pull request is merged into `claude-dev`:** the owner has read the workflow and the `ops/` code (the base has no trusted logic to judge them, section 6); the owner records the decision in the decision log (the agent only drafts it); the merge method keeps the 42 reviewed commits (a merge commit; not a squash or a rebase, which would remove the commit ids the evidence names); and `verify` is green on the pull request.

## 10. Plan for the next stage

Each step is a separate request that needs the owner's approval. None is started.

1. **Independent review** of this candidate, as in section 9.
2. **Branch protection.** After the candidate is merged into `claude-dev` and `verify` has run on it there, the owner sets the rulesets of the settings guide: `protect-main` now (pull request, required `verify`, no force push, no deletion), `protect-claude-dev` in its first phase, then a code-owners file for the control plane, then, when the owner decides OQ-0036, a separate automation identity.
3. **A controlled staging pull request** from `claude/ops-staging-integration` into `claude-dev`, opened and merged only on the owner's approval, with the Vercel preview of the result checked.
4. **Testing the integrated website** on the `claude-dev` preview: the pages and routes listed in section 6, the quotation form and its `wa.me` hand-off, `robots.txt` and `sitemap.xml`, the environment variables on that preview, and the same-directory build comparison used here.
5. **Separate cleanup of Instagram-only tracked content**, following the phases of [INSTAGRAM_SEPARATION_PLAN.md](INSTAGRAM_SEPARATION_PLAN.md): the owner decides where the work lives (OQ-0038), the originals are preserved and confirmed, then `creative/` is removed in a reviewed change from a new worktree at the published `claude-dev`, with the build comparison unchanged. **Do this before the first release of `claude-dev` to `main`.** `main` has no `creative/` and the trees of the two branches are identical outside it, so after the cleanup the only difference between them will be this control plane, which is purely additive. Until then a release needs an integration branch built from `main`, as in the last production release.
6. **The M1 Business Platform** starts only after steps 1 to 4. The order in [ROADMAP.md](ROADMAP.md) section 4 stands: (1) Supabase and backend architecture (PH-2, blocked by OQ-0030); (2) customer accounts (PH-3, blocked by OQ-0002, OQ-0003, OQ-0004); (3) the private administrator area with order management (PH-4 and PH-5, blocked by OQ-0011, OQ-0018, OQ-0005, OQ-0013, OQ-0016); (4) order tracking and quote persistence (PH-5 and PH-6, blocked by OQ-0003, OQ-0017); (5) loyalty and finance (PH-7 and PH-8). Authentication, row-level security, customer data, loyalty and finance logic, schema, secrets and deployment are class B or C and need the owner's approval before the run and before any merge; the public website and its quotation process stay unchanged; Instagram production stays outside the repository. **Nothing of this is implemented here.**

## Appendix A: the 147 paths that the integration adds (A) or modifies (M) relative to `claude-dev`

```text
A  .github/workflows/ci.yml
A  CLAUDE.md
A  docs/project-memory/README.md
A  docs/project-memory/architecture/ARCHITECTURE.md
A  docs/project-memory/architecture/BROWSER_REVIEW.md
A  docs/project-memory/architecture/CI_ARCHITECTURE.md
A  docs/project-memory/architecture/CI_EVIDENCE.md
A  docs/project-memory/architecture/REVIEWER_FEASIBILITY.md
A  docs/project-memory/architecture/REVIEW_PACKET.md
A  docs/project-memory/architecture/TRUSTED_CI.md
A  docs/project-memory/architecture/adr/0001-git-as-shared-project-memory.md
A  docs/project-memory/architecture/adr/0002-github-actions-as-sole-orchestrator.md
A  docs/project-memory/architecture/adr/0003-privilege-separation.md
A  docs/project-memory/architecture/adr/0004-branch-model-and-promotion.md
A  docs/project-memory/architecture/adr/0005-deterministic-policy-and-risk-classes.md
A  docs/project-memory/architecture/adr/0006-reports-are-claims.md
A  docs/project-memory/architecture/adr/0007-task-delivery-by-file-and-completion-by-artifacts.md
A  docs/project-memory/architecture/adr/0008-loyalty-as-append-only-ledger.md
A  docs/project-memory/architecture/adr/0009-claude-subscription-only-no-paid-ai-services.md
A  docs/project-memory/architecture/adr/0010-reviewer-is-a-separate-read-only-claude-session.md
A  docs/project-memory/architecture/adr/0011-ci-is-unprivileged-allow-listed-and-independent-of-any-model.md
A  docs/project-memory/architecture/adr/0012-trusted-base-verification-is-advisory-until-anchored.md
A  docs/project-memory/architecture/adr/0013-the-review-packet-and-decision-gate-are-offline-deterministic-and-never-approve.md
A  docs/project-memory/architecture/adr/0014-repository-structure-and-instagram-separation-are-permanent-rules.md
A  docs/project-memory/decisions/HUMAN_DECISIONS.md
A  docs/project-memory/decisions/OPEN_QUESTIONS.md
A  docs/project-memory/policy/policy.json
A  docs/project-memory/requirements/MASTER_REQUIREMENTS.md
A  docs/project-memory/reviewer/FIRST_REVIEW_RUNBOOK.md
A  docs/project-memory/reviewer/REVIEWER_PROMPT.md
A  docs/project-memory/roadmap/GITHUB_SETTINGS_GUIDE.md
A  docs/project-memory/roadmap/INSTAGRAM_SEPARATION_PLAN.md
A  docs/project-memory/roadmap/OPS-0002-ACTIVATION.md
A  docs/project-memory/roadmap/OPS-0002-PROPOSAL.md
A  docs/project-memory/roadmap/OPS-0003-PROPOSAL.md
A  docs/project-memory/roadmap/OPS-0004-PROPOSAL.md
A  docs/project-memory/roadmap/OPS-0005B-TASK.md
A  docs/project-memory/roadmap/ROADMAP.md
A  docs/project-memory/runs/OPS-0001/OPS-0001-a1/report.json
A  docs/project-memory/runs/OPS-0001/OPS-0001-a2/report.json
A  docs/project-memory/runs/OPS-0002/OPS-0002-a1/report.json
A  docs/project-memory/runs/OPS-0003/OPS-0003-a1/report.json
A  docs/project-memory/runs/OPS-0004/OPS-0004-a1/report.json
A  docs/project-memory/runs/OPS-0004/OPS-0004-a2/report.json
A  docs/project-memory/runs/OPS-0005B/OPS-0005B-a1/RUN-RECORD.md
A  docs/project-memory/runs/OPS-0006/OPS-0006-a1/report.json
A  docs/project-memory/runs/OPS-0006/OPS-0006-a2/ATTEMPT-2-SCOPE.md
A  docs/project-memory/runs/OPS-0006/OPS-0006-a2/RUN-RECORD.md
A  docs/project-memory/schemas/ci-evidence.schema.json
A  docs/project-memory/schemas/policy.schema.json
A  docs/project-memory/schemas/review-decision.schema.json
A  docs/project-memory/schemas/review-packet-manifest.schema.json
A  docs/project-memory/schemas/run-report.schema.json
A  docs/project-memory/schemas/task.schema.json
A  docs/project-memory/tasks/OPS-0001-shared-project-memory.md
A  docs/project-memory/tasks/OPS-0002-ci-baseline.md
A  docs/project-memory/tasks/OPS-0003-trusted-ci.md
A  docs/project-memory/tasks/OPS-0004-review-foundation.md
A  docs/project-memory/tasks/OPS-0006-consumer-integrity.md
A  docs/project-memory/tasks/TEMPLATE.md
A  ops/ci-evidence.mjs
A  ops/decision-gate.mjs
A  ops/lib/ci-evidence.mjs
A  ops/lib/decision-gate.mjs
A  ops/lib/ids.mjs
A  ops/lib/json-schema.mjs
A  ops/lib/mini-yaml.mjs
A  ops/lib/policy.mjs
A  ops/lib/review-packet.mjs
A  ops/lib/review-text.mjs
A  ops/lib/trusted-base.mjs
A  ops/lib/workflow-safety.mjs
A  ops/review-packet.mjs
A  ops/tests/baseline-checks.test.mjs
A  ops/tests/ci-evidence.test.mjs
A  ops/tests/decision-gate.test.mjs
A  ops/tests/evidence-consumers.test.mjs
A  ops/tests/fixtures.test.mjs
A  ops/tests/fixtures/ci/README.md
A  ops/tests/fixtures/ci/live-run-43995081483.check-runs.synthetic.json
A  ops/tests/fixtures/ci/live-run-43995081483.job.log.txt
A  ops/tests/fixtures/ci/live-run-43995081483.jobs.json
A  ops/tests/fixtures/ci/live-run-43995081483.run.json
A  ops/tests/fixtures/ci/real-run-44082419253.check-runs.json
A  ops/tests/fixtures/ci/real-run-44082419253.evidence.json
A  ops/tests/fixtures/ci/real-run-44082419253.job.log.excerpt.txt
A  ops/tests/fixtures/ci/real-run-44082419253.jobs.json
A  ops/tests/fixtures/ci/real-run-44082419253.run.json
A  ops/tests/fixtures/invalid/decision-advisory-flag-false.json
A  ops/tests/fixtures/invalid/decision-approve-with-blocker.json
A  ops/tests/fixtures/invalid/decision-claims-verified.json
A  ops/tests/fixtures/invalid/decision-confidence-out-of-range.json
A  ops/tests/fixtures/invalid/decision-lowers-class.json
A  ops/tests/fixtures/invalid/decision-needs-human-without-reason.json
A  ops/tests/fixtures/invalid/decision-next-task-mismatch.json
A  ops/tests/fixtures/invalid/decision-old-kind.json
A  ops/tests/fixtures/invalid/decision-proposal-class-too-low.json
A  ops/tests/fixtures/invalid/decision-reviewed-other-commit.json
A  ops/tests/fixtures/invalid/decision-reviewer-role-is-worker.json
A  ops/tests/fixtures/invalid/decision-same-session-as-worker.json
A  ops/tests/fixtures/invalid/decision-unknown-runtime.json
A  ops/tests/fixtures/invalid/decision-unknown-verdict.json
A  ops/tests/fixtures/invalid/decision-wrong-trust-level.json
A  ops/tests/fixtures/invalid/report-attempt-mismatch.json
A  ops/tests/fixtures/invalid/report-attestation-contradicted.json
A  ops/tests/fixtures/invalid/report-bad-sha.json
A  ops/tests/fixtures/invalid/report-claims-verified.json
A  ops/tests/fixtures/invalid/report-class-lowered.json
A  ops/tests/fixtures/invalid/report-extra-property.json
A  ops/tests/fixtures/invalid/report-failed-required-check.json
A  ops/tests/fixtures/invalid/report-head-mismatch.json
A  ops/tests/fixtures/invalid/report-missing-required-check.json
A  ops/tests/fixtures/invalid/report-old-kind.json
A  ops/tests/fixtures/invalid/report-outside-scope.json
A  ops/tests/fixtures/invalid/report-passed-nonzero-exit.json
A  ops/tests/fixtures/invalid/report-protected-undeclared.json
A  ops/tests/fixtures/invalid/report-time-reversed.json
A  ops/tests/fixtures/invalid/report-wrong-trust-level.json
A  ops/tests/fixtures/invalid/task-author-is-a-provider.json
A  ops/tests/fixtures/invalid/task-bad-id.json
A  ops/tests/fixtures/invalid/task-branch-mismatch.json
A  ops/tests/fixtures/invalid/task-class-c.json
A  ops/tests/fixtures/invalid/task-class-too-low.json
A  ops/tests/fixtures/invalid/task-extra-property.json
A  ops/tests/fixtures/invalid/task-immutable-path.json
A  ops/tests/fixtures/invalid/task-leading-wildcard.json
A  ops/tests/fixtures/invalid/task-missing-objective.json
A  ops/tests/fixtures/invalid/task-too-many-attempts.json
A  ops/tests/fixtures/invalid/task-unknown-prefix.json
A  ops/tests/fixtures/manifest.json
A  ops/tests/fixtures/valid/review-decision.json
A  ops/tests/fixtures/valid/run-report.json
A  ops/tests/fixtures/valid/task.json
A  ops/tests/git-fixture.mjs
A  ops/tests/helpers.mjs
A  ops/tests/identifiers.test.mjs
A  ops/tests/json-schema.test.mjs
A  ops/tests/mini-yaml.test.mjs
A  ops/tests/policy.test.mjs
A  ops/tests/real-evidence.test.mjs
A  ops/tests/review-fixture.mjs
A  ops/tests/review-packet.test.mjs
A  ops/tests/trusted-base.test.mjs
A  ops/tests/validate-memory.test.mjs
A  ops/tests/workflow-safety.test.mjs
A  ops/validate-memory.mjs
M  package.json
```
