# OPS-0003 proposal: a trusted-base check and a machine-readable CI result

**Status: implemented locally as task OPS-0003 (HD-0015); not pushed. Where the implementation differs from this proposal, the implementation notes below win.** The proposal's part A (a second job in `ci.yml`) was **not built**: a second job in the same modifiable workflow is not an independent boundary, so the trusted-base check was built as a tool instead ([TRUSTED_CI.md](../architecture/TRUSTED_CI.md), ADR-0012). Part B was built on GitHub's own Actions and Checks APIs with no artifact and no new action ([CI_EVIDENCE.md](../architecture/CI_EVIDENCE.md)). Part C (the pin-refresh procedure) and part D (a check-name stability test) were **not** built and remain open. The original text follows, unchanged. It was written when nothing was pushed and no run existed.

**Original status: proposal only.** This is not a task file, it is not approved, and nothing described here has been created or started. It follows from the limits found while building OPS-0002 ([CI_ARCHITECTURE.md](../architecture/CI_ARCHITECTURE.md) section 9) and it is the second part of stage STG-3 on the [roadmap](ROADMAP.md).

- **Class:** B (it changes `.github/**`, `ops/**` and the policy, all control-plane paths), so a human approves before the run and before any merge.
- **Cannot start until:** OPS-0002 has been reviewed and merged; its first real run on GitHub has been observed green (that needs the push decision, OQ-0028); and the owner has answered OQ-0034, because the new checks are only worth having if a red result can block a merge.
- **Constraints carried over:** the existing subscription only (REQ-OPS-008), no secret, no privileged workflow, no deployment, nothing pushed without approval.

## 1. Problem to solve

OPS-0002 gives every branch an independent, unprivileged verification. It cannot yet answer two questions that the later reviewer and orchestrator stages depend on:

1. **Who checks the checker?** A pull request runs its own copy of `ops/` and `.github/`, so a pull request that weakens the workflow-safety checker (or the policy it reads) can still turn CI green. Today the protection is human review of control-plane paths. That is correct but manual.
2. **How does a later stage read the result without trusting the worker?** A worker's report is a claim (ADR-0006). The orchestrator needs the CI outcome as data that GitHub, not the worker, produced.

## 2. Proposed scope

| Part | What | Notes |
|---|---|---|
| A. Trusted-base check | A second job, for `pull_request` only, that checks out the **base** commit into one folder and the pull request into another, runs the **base** validator over the **pull request's files as data**, and fails if the pull request's workflow, policy or checker would not pass the base version's rules | Needs two small, exact exceptions in the checker: a `with: ref:` input and its expression (the base commit SHA), and a `path:` input. Needs the base branch to already contain the OPS-0002 checker, hence the prerequisites above |
| B. CI result as data | Record, per run, the head commit, event, and each command's exit code and duration in a `ci-result.json` that a later stage reads | Recommended first step: use the check-run and job conclusions that GitHub already records (read with a read-only token by the later stage) and add no artifact. An artifact needs `actions/upload-artifact`, which is not an approved action: it would be a policy change with a verified SHA and an owner decision |
| C. Verified-pin refresh procedure | A written, repeatable procedure (the commands used in OPS-0002: list tags from the action's own repository, confirm the commit and its containment in the default branch, read `action.yml` at the commit) so that moving to a newer pinned release is a reviewed policy change | Documentation only; no network in CI |
| D. Check-name stability | A test that the job name `verify` and workflow name `CI` stay as they are, because a branch rule will require them by name | Small |

## 3. Explicitly out of scope for OPS-0003

- The privileged collector that reacts to a finished run (it needs `workflow_run`, which is forbidden today; it deserves its own ADR, a policy change and an owner decision, and would be OPS-0004 or later).
- Any reviewer or worker session, any token, any model (STG-4 onwards).
- Any merge, push or setting change by the system.

## 4. Approvals that would be needed

1. Approve OPS-0003 to start (a new human decision), after the prerequisites.
2. If part B uses an artifact: approve `actions/upload-artifact`, with a SHA verified by the procedure in part C.
3. If part A is built: approve the two narrow expression exceptions as a policy and checker change.

## 5. Recommendation

Do A, C and D, and do B using GitHub's own check results (no new action). Leave the privileged collector for a later task with its own ADR. That closes the one known gap in OPS-0002 without introducing a new trust boundary.
