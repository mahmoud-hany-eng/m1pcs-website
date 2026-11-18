# ADR-0014: The repository structure and the separation of Instagram production are permanent rules

- **Status:** accepted
- **Date:** 2026-11-17
- **Related:** HD-0018, HD-0019, HD-0020, REQ-OPS-006, REQ-OPS-007, REQ-OPS-011, REQ-OPS-012, REQ-OPS-013, REC-OPS-027, REC-OPS-028, REC-OPS-029, ADR-0004, ADR-0008, ADR-0013

## Context

The owner confirmed three rules that were only implied before. First, the structure of the repository: `claude/**` branches for isolated feature development, `claude-dev` as the staging and integration-testing environment, `main` as the production website, with every website feature tested on `claude-dev` first and only the owner authorizing a production merge or deployment. Stacked branches had been used for implementation (OPS-0004 sits on the unmerged OPS-0003 branch), so the owner also stated that they are allowed but never replace staging. Second, Instagram advertising and video production must stay completely separate from the website repository. An inspection found that this is not true today: 140 Instagram and marketing video files are tracked on the published `claude-dev` (and on the two published OPS branches built on it), 56 more are in eight unpublished local commits, and 5.4 GB of renders exist only on one container's disk. `main` has never contained any of it. Third, the owner works in a browser at claude.ai/code, so every procedure the owner carries out must work there.

## Decision

- **The three-tier structure is permanent** (REQ-OPS-011). Features are built on `claude/**` branches, tested on `claude-dev`, and released to `main` only on the owner's explicit approval. A stacked branch is a recorded dependency exception for implementation and validation. A release from `claude-dev` to `main` is built by squash merge or a cherry-picked release branch, so that history which must not reach production does not.
- **Instagram and marketing video production do not belong in the website repository** (REQ-OPS-012). Website assets the website genuinely needs are separate and permitted. The existing violation is remedied by a plan, not by a hurried deletion: preserve the originals outside the repository first, then remove the files from the development state after the owner's approval, never rewrite published history without separate approval, and never push the unpublished Reel commits ([INSTAGRAM_SEPARATION_PLAN.md](../../roadmap/INSTAGRAM_SEPARATION_PLAN.md)).
- **Until a technical guard exists, the rule is enforced by instruction:** CLAUDE.md section 13 and policy PROHIB-017 (class C). The guard (a validator check run by CI, `.gitignore` entries, an owner-maintained allowlist) must land in the same change as the removal, because it would fail CI while the files are still tracked.
- **Procedures for the owner are browser procedures** (REQ-OPS-013). A terminal procedure may exist only as an optional alternative that is marked as such. The first reviewer test is therefore a browser session that rebuilds its review packet from GitHub-held inputs ([BROWSER_REVIEW.md](../BROWSER_REVIEW.md)); its read-only behaviour is instructed, not enforced, so its review is advisory.

## Alternatives considered

| Option | Why not |
|---|---|
| Delete `creative/` now | The only copy of the renders and of eight commits is on an ephemeral disk; deleting or resetting before a verified archive could lose the Instagram work |
| Rewrite published history to erase the files | Changes every later commit id, breaks recorded CI and review hashes, does not remove forks or caches, needs a force-push the policy forbids without separate approval |
| Keep `creative/` in the repository and only ignore it | Contradicts the owner's requirement; the files are already published |
| Push the Reel commits to a branch for safekeeping | Publishes 56 more files in a public repository; the owner said no |
| Assume a terminal for the reviewer test | The owner does not use one |

## Consequences

- A change that adds a path matching the Instagram rule is a prohibited operation for a worker; removing the existing files is a class B, human-approved change.
- Until the cleanup lands, the published history of `claude-dev` contains the files, and so does every clone. The rule is stated honestly as "violated today, remedy planned".
- The owner has to choose a home for the Instagram work (OQ-0038) and decide about history (OQ-0039). Until a copy exists outside the container, the container is the single copy.
- Reviews from a browser session stay advisory until read-only isolation and evidence provenance are actually established.
