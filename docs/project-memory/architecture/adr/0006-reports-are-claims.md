# ADR-0006: A worker's run report is a claim, not evidence

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-006, REQ-OPS-001

## Context

A worker writes a summary of what it did, which commands it ran and what they returned. A model may be mistaken, may be confused by context, or may be steered by injected text. If the system treated the report as truth, a false statement would flow straight into review and merge decisions.

## Decision

- The report is a file, `docs/project-memory/runs/<task id>/<attempt id>/report.json`, committed in a separate final commit that changes only that file. `head_sha` in the report is the last **work** commit, so the report never has to contain its own commit's hash.
- Every report must carry `trust.level = unverified_worker_claim` and `verified_by_orchestrator = false`. A report that says otherwise is invalid.
- The orchestrator computes the list of changed files, the diff and CI results itself, from GitHub, and compares them with the report. Differences are findings. The policy class comes from the computed paths.
- Verified evidence is a different document type that only the orchestrator writes, in trusted state. It is not part of OPS-0001.
- The offline validator already contradicts self-attestations that the paths disprove (for example "stayed within files_allowed").

## Consequences

- A worker cannot obtain approval by describing itself favourably.
- Reports remain useful as an index and a narrative of the work, and as a permanent record in the repository.
- The orchestrator must do its own recomputation, which is extra work but is what makes the system safe.
