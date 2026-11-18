# ADR-0002: GitHub Actions is the only orchestrator, with one task in flight

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-002, REC-OPS-007, REQ-OPS-002, REQ-OPS-005

## Context

The target workflow is: a task is proposed and approved, a Claude worker session implements it, the evidence is collected, a separate Claude reviewer session reviews it, and the next task is proposed. It needs a place to run deterministic logic, hold secrets and keep state. Introducing a server, a database or a queue service would add cost and operating burden (REQ-OPS-005).

## Decision

GitHub Actions is the only orchestration runtime. The orchestrator is a small, dependency-free script in `ops/` driven by workflows. Only one task is in flight at a time (policy `max_concurrent_tasks`). Duplicate execution is prevented by a workflow concurrency group, compare-and-swap writes to the state branch, a launch record written before launching, and no automatic retry of an ambiguous launch.

This ADR records the decision only. OPS-0001 builds no workflows.

## Consequences

- No new paid infrastructure. For a public repository, Actions minutes are free.
- State and audit trail live in git, so they are inspectable.
- Scheduled workflows are best-effort and can be delayed or disabled by inactivity, so they serve only as a watchdog; the main loop is event-driven.
- Throughput is deliberately low. Raising concurrency needs a new review.
