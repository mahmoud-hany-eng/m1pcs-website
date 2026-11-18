# OPS-0006 attempt 2: scope of the corrections (not a task file)

**Status: recorded before any correction was made.** This file is committed alone, as the first commit of the branch
`claude/ops-0006-review-fixes`, on top of the published OPS-0006 tip. It records the additional scope the owner approved for
attempt `OPS-0006-a2`. **The owner's instruction, not this file, is the authority**, and this file cannot widen it. A worker
cannot grant itself a permission by writing it down here.

## Why this is a separate file and not a task file

The approved task definition of OPS-0006 is `docs/project-memory/tasks/OPS-0006-consumer-integrity.md`. It is not changed. The
packet builder finds a task by listing the baseline's `docs/project-memory/tasks/` for names that start with the task id and
requires **exactly one** match (`PK-TASK-NOT-IN-BASELINE`). A second file for OPS-0006 there would break that discovery, so the
attempt's scope lives under `docs/project-memory/runs/OPS-0006/OPS-0006-a2/`, which the original task already allows
(`runs/OPS-0006/**`).

## Pre-implementation review baseline

`9cec0ddeea8c9bb1e67905ea6871c6f2c1517a67`, the published OPS-0006 tip. It precedes every correction of this attempt and holds the
approved task definition (class B, 15 acceptance criteria). This attempt reviews only the corrections below, not the whole of
attempt 1, whose independent review (Review B) produced the findings. The baseline is deliberately **not** this file's commit:
under the rule that F-2 introduces, a baseline that differs from the base by anything but the task definition is not independent.

## What is corrected

Two major findings of the independent Review B (verdict `request_changes`, gate result `REQUIRES_CORRECTIONS`, exit code 3):

- **F-1: evidence base mismatch.** In `deriveCi` (`ops/lib/review-packet.mjs`) the cross-check of the changed paths against the
  evidence's CI trust basis runs only when `evidence.subject.base_sha` equals the packet's base. Evidence collected against a
  different base skips the check silently and can report `ci_definition_unchanged_from_base` for a change that modifies
  control-plane paths. The packet's base, the evidence subject's base, the trusted-base evaluation's base, the applicable
  merge-base and the independently computed changed paths must all agree, or the evidence must not qualify.
- **F-2: false baseline independence.** `baselineAssessment` decides independence from the final contents of the reviewed files.
  It never looks at the commits between the base and the baseline, so implementation or control-plane changes that were later
  rewritten or reverted do not show. A baseline may be independent only if it is the approved base, or differs from it solely by
  commits that touch the task definition, and the history can be verified.

## Allowed paths for this attempt (a subset of the original task's `files_allowed`)

- `ops/lib/review-packet.mjs`, and `ops/lib/decision-gate.mjs` and `ops/review-packet.mjs` only where a message or a field has to follow
- `ops/tests/**`
- `docs/project-memory/schemas/review-packet-manifest.schema.json` (the manifest's `trusted_baseline` section)
- `docs/project-memory/architecture/REVIEW_PACKET.md`
- `docs/project-memory/runs/OPS-0006/OPS-0006-a2/**`

**Stop conditions.** If `ci-evidence.schema.json`, the policy, any other schema, the workflow, `HUMAN_DECISIONS.md` or any other
file outside this list has to change, the work stops and the reason is reported before the file is touched. The evidence already
records `subject.base_sha`, `subject.merge_base_sha`, `trusted_base.evaluated.*` and `trusted_base.changes.paths`, so F-1 needs no
evidence-schema change.

## Acceptance criteria

1. **F-1.** Evidence whose subject base, trusted-base base, subject merge-base, trusted-base merge-base or recorded changed paths
   differ from the packet's own are refused by the builder, reported by the verifier and make the gate answer `REVIEW_INVALID`.
   No other base is substituted.
2. **F-1.** A trust basis of `ci_definition_unchanged_from_base` is never accepted when the independently computed changed paths
   include a workflow, `ops/`, policy, schema or build input, whatever base the evidence names.
3. **F-1.** Valid evidence for the right base, and a genuine change to control-plane paths, still produce a valid, complete packet.
4. **F-2.** A baseline is independent only if it is the approved base, or every commit between the base and the baseline touches
   only the task definition used by the review, it is an ancestor of the head, and its task definition is present and valid.
   Commits are inspected one by one; final file equality is not the test.
5. **F-2.** A baseline containing implementation changes, a change that was later rewritten, a control-plane change that was later
   reverted, or an unrelated or descendant revision is not independent. The documented human exception is kept and is never granted
   automatically.
6. The CI-completeness validation, log-header forgery detection, mandatory checks, evidence hashing, reviewer session separation,
   deterministic risk classification, protected-path rules and human-approval requirements are not weakened.
7. Only the review-packet documentation is updated: strict evidence-base matching, verified baseline provenance, the residual
   limits of offline verification, and why an approved reviewer decision cannot authorise a sensitive operation.
8. `npm run ops:validate`, `npm run ops:test`, `npm run lint`, `npx tsc --noEmit` and `npm run build` pass; the new tests fail
   against the code of the baseline and pass against the corrected code; targeted mutations are caught.
9. Nothing is pushed, merged or deployed. `main`, `claude-dev`, the eight unpublished Reel commits, `src/`, `public/`, `creative/`,
   `.github/`, `HUMAN_DECISIONS.md` and every unrelated file are unchanged.

## Not done by this file

It does not approve anything, authorise a push, record a human decision or define a new task. The run record for this attempt is
`RUN-RECORD.md` in this folder, written last. It is Markdown and not `report.json` because the validator requires a report's
branch to equal the task's single `branch` (`REPORT-BRANCH`), and attempt 2 runs on a different branch than attempt 1.
