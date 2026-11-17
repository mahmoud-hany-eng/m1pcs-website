# ADR-0011: CI is unprivileged, allow-listed and independent of any model

- **Status:** proposed
- **Date:** 2026-11-17
- **Related:** HD-0013, REQ-OPS-010, REC-OPS-003, REC-OPS-015, REC-OPS-017, REC-OPS-018, REC-OPS-019, REC-OPS-020, REC-OPS-021, ADR-0002, ADR-0003, ADR-0009

## Context

Before an automated reviewer or worker is connected, something independent of both must show that a branch builds and that the project memory is valid. That check runs the code of the branch under test (lint, type check, tests and build all execute project code), and the repository is public, so in the future the branch may come from someone other than the owner. GitHub documents that a workflow started by `pull_request` from a fork gets a read-only token and no secrets, but it also documents that other triggers (such as `pull_request_target` and `workflow_run`) run with the base repository's secrets and a write token. Installing dependencies without install scripts reduces one risk but does not make the later commands safe.

## Decision

- **Unprivileged by construction.** The CI workflow requests only `contents: read`, references no secret and no token, uses no environment, deploys nothing, runs on a GitHub-hosted runner, keeps no credential after checkout and keeps no dependency cache. Its only triggers are `push` and `pull_request` with fixed branch filters. `pull_request_target`, `workflow_run`, scheduled and manual triggers are forbidden.
- **An allow-list, not a deny-list.** The approved shape of a workflow lives in `policy.workflow_policy`: the files, events, permission, runner, timeout, actions with their commit SHAs and inputs, and the exact commands in order. A deterministic checker (`ops/lib/workflow-safety.mjs`) rejects every deviation, including keys and constructs it does not know, and reads the file with a deliberately small YAML reader that rejects anything another reader could interpret differently. The check runs inside `npm run ops:validate`, so it runs on every branch in CI.
- **Pinned actions.** Each action is pinned to one full commit SHA that was read from the action's own repository and checked there (release tag, branch containment, runtime). Changing a pin is a policy change that a human approves.
- **Install flag is not a security boundary.** `npm ci --ignore-scripts` is used because it removes install-time execution by dependencies, but the pipeline is not treated as safe because of it: `npm run lint`, `npx tsc`, the tests and `next build` still execute code from the branch. The safety comes from the environment having nothing to steal and nothing to write.
- **Independent of any model.** No model session, no provider key and no subscription token exists in this workflow. A guard step fails the job if a provider credential is defined (REC-OPS-015).
- **Human control of the control plane.** `.github/**`, `ops/**`, the policy and the schemas stay control-plane paths (class B, human approval before merge). A pull request can edit the checker that judges it, so a green CI result is not evidence about changes to those paths; a later task adds a check that runs the base branch's checker (OPS-0003 proposal).

## Consequences

- A branch that changes the workflow outside the approved shape fails `npm run ops:validate` and the CI job; a human must change the policy first.
- Adding a second workflow, a new action, an artifact upload or a cache needs a policy change, a verified SHA and a human decision. That is deliberate friction.
- The workflow is only as trustworthy as the settings around it. The owner's GitHub settings (approval for outside collaborators' workflow runs, read-only default token) cannot be set or observed from the repository and are tracked in OQ-0034.
- Local checks cannot show how GitHub treats the file. The first real run, after an approved push (OQ-0028), is the first evidence that the workflow runs at all.
- The checker is a strict subset reader. A workflow written in flow style, with anchors or with multi-line scripts is rejected even when it is valid YAML. That costs convenience and buys the absence of parser disagreement.
