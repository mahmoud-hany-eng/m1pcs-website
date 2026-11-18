# ADR-0010: The reviewer is a separate, read-only Claude session

- **Status:** proposed
- **Date:** 2026-11-17
- **Related:** HD-0010, REC-OPS-010, REC-OPS-013, REC-OPS-016, ADR-0003, ADR-0005, ADR-0006, ADR-0009, OQ-0031, OQ-0032, OQ-0033

## Context

A worker's output must be reviewed by something that did not produce it, without any paid AI service (ADR-0009). Official documentation describes two ways to run a separate Claude session for this, and they differ a lot in how well they can be isolated. The assessment, with its evidence and its gaps, is in [REVIEWER_FEASIBILITY.md](../REVIEWER_FEASIBILITY.md). The short version: the exact process the owner described is not fully supported as stated, a close variant is, and one step (starting the next worker session automatically from GitHub Actions) is only possible through an experimental interface.

## Decision

- **Role.** The reviewer is a different session from the worker of the attempt it reviews and never continues the worker's work. It is advisory: it cannot approve, merge, launch a task, change code or change policy. The deterministic policy engine decides, and uses no model (policy `roles`).
- **Tools.** The reviewer has read-only tools only. It receives its inputs as files in a trusted workspace, split into `trusted/` and `untrusted/` (REC-OPS-016). The worker's branch reaches it only as data (diff, report, check results), never as the working directory, so the worker's own instruction files and settings cannot shape the reviewer.
- **Output.** The reviewer produces one structured document that conforms to `review-decision.schema.json` and is stored at `docs/project-memory/reviews/<task id>/<attempt id>/review.json`. The offline validator checks it, including that the reviewer's session identifier differs from the worker's and that it reviewed the work head that was reported. The review is an unverified reviewer claim, never evidence.
- **Runtime.** Two runtimes are allowed by policy: `actions_hosted_session` (a restricted session run by the official GitHub Action in a CI job) and `cloud_routine_session` (a cloud session started by an experimental API or by a pull-request trigger). **No runtime is selected.** Selecting one is a human decision (OQ-0031) and the policy refuses a selection without a recorded decision. The recommendation is `actions_hosted_session`, because it is the only option whose read-only restriction, separate identity and structured output are all documented.
- **Completion and retry.** A review is complete when a schema-valid `review.json` exists for the attempt (and, for the CI-hosted runtime, the job has concluded). A review is read-only and therefore safe to repeat: one retry is allowed (policy `max_review_sessions_per_attempt`), then the attempt goes to a human. This differs from starting a worker, which is never retried automatically.
- **Not decided here.** How the next worker session is started (OQ-0033), the subscription token (OQ-0032) and the approval channel (OQ-0026).

## Consequences

- The design survives a change of runtime: the contract (inputs, output, role rules) is the same for both.
- The recommended runtime needs the owner to create a long-lived subscription token and to accept that the reviewer is a CI-hosted Claude session rather than a cloud session.
- Neither runtime gives an independent reviewer model, so review quality is bounded by the same model family as the worker.
- Several isolation properties are documented but have not been exercised live (REVIEWER_FEASIBILITY.md section 6). Until they are tested, the reviewer's output must be treated as an unverified claim, which the contract already requires.
