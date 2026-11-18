# ADR-0012: Trusted-base verification is advisory until it is anchored; control-plane changes stay human-approved

- **Status:** proposed
- **Date:** 2026-11-17
- **Related:** HD-0015, REQ-OPS-010, REC-OPS-016, REC-OPS-021, REC-OPS-022, REC-OPS-023, REC-OPS-024, ADR-0005, ADR-0006, ADR-0010, ADR-0011

## Context

CI judges a branch with the branch's own workflow, validator, checker, policy and schemas (ADR-0011, REC-OPS-021). An autonomous worker that can edit those files can make its own work pass. The obvious remedy, a second job in the same workflow that checks the branch against the base revision, is not a boundary: a `pull_request` run uses the workflow file of the pull request's merge commit, and a required status check is matched by name, so the same commit that weakens the first job can remove or replace the second. The first real run (run 43995081483, commit 0aba5e8) confirmed that the baseline workflow runs and passes; it says nothing about this gap.

## Decision

- **Build the check as a tool, not as a workflow job.** `trustedBaseCheck` (`ops/lib/trusted-base.mjs`) judges a change `base..head` with the validator, policy and schemas of the base revision, reading the head only as data and never executing it. It runs anywhere that holds an established copy of the repository and needs no network and no credential.
- **Report, never enforce.** Every result carries `enforcement: "advisory_only"`. The `anchor` that a caller states is recorded as a claim (`anchor_is_claim: true`) and changes nothing. No document produced by the tool is described as independent enforcement unless it was produced by something the change under review could not alter, and that has not been established.
- **Control-plane changes stay human-approved.** `.github/**`, `ops/**`, the policy, the schemas, `CLAUDE.md` and the reviewer prompt remain class B with human approval before a run and before a merge. The tool can only add reasons for a human; it cannot remove one.
- **A green CI result is evidence only about an unchanged CI definition.** If the change touches the workflow, `ops/`, the policy, the schemas, the package scripts or a build input, a green run is reported as not evidence about those changes and a human is required.
- **Do not add a second job to `ci.yml`.** The workflow-safety checker keeps requiring exactly one job.
- **Do not use privileged default-branch triggers to anchor the check** (`workflow_run`, `pull_request_target`). They are independent of the pull request but run with a privileged token against code the pull request supplies, they put the anchor on the production branch, and one of them faces a planned default block on public repositories. A separate ADR and an owner decision would be needed.
- **The anchor is chosen by the owner (OQ-0035)** from: the reviewer session's trusted workspace (REC-OPS-016, recommended as the next step), a required reviewer who is not the author (OQ-0036), or an organisation-level required workflow (needs an organisation account). Until one is chosen the tool is a measurement, not a gate.

## Alternatives considered

| Option | Why not |
|---|---|
| A second job in `ci.yml` that checks out the base | Same file, same author: not a boundary |
| `pull_request_target` or `workflow_run` workflow | Privileged; forbidden by the policy floors; anchors on `main`; GitHub is moving to block `pull_request_target` by default on public repositories |
| Copy the checker into the workflow as an action in another repository | A new trust relationship with a pin that a human must keep current; no more independent than a pinned action, and it would still be selected by the pull request's workflow file |
| Sign the evidence | Needs a secret or an attestation action; neither is approved (no new action, no credential) |
| Do nothing and rely on review | Correct today and unchanged by this ADR, but it leaves the reviewer stage without a way to measure a change against the base |

## Consequences

- A reviewer session can compute, from its own trusted workspace, whether a branch changed the rules that judge it and whether the head passes the base's rules, without running the branch's code.
- The tool is only as trustworthy as the base revision it is given and as whoever runs it. The branch rules in [GITHUB_SETTINGS_GUIDE.md](../../roadmap/GITHUB_SETTINGS_GUIDE.md) are what make a base "established", and they bind the automation only if it does not act as the repository's owner (OQ-0036).
- The evidence format is unauthenticated by design (ADR-0006): a file cannot prove where it came from, so a consumer obtains the GitHub data itself and runs the tool itself.
- Changes to the tool are themselves control-plane changes; a reviewer judging a change to `ops/lib/trusted-base.mjs` must run the base's copy of the tool.
- Nothing has run on GitHub for this branch. The decision stays proposed until the owner ratifies it with the other ADRs (OQ-0020).
