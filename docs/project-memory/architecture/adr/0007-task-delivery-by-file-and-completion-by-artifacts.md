# ADR-0007: Tasks are delivered as files; completion is detected from artifacts

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-004, REC-OPS-005, OQ-0022

## Context

The documented ways to start a Claude cloud session accept only free text, wrapped as untrusted data, and return a session id and URL immediately. There is no documented way to read a session's status, receive a completion callback, or retry safely (each launch creates a new session). Following up an existing session is documented only through an interactive command line. The interface is also in research preview and may change.

## Decision

- **Task delivery.** The full task is a file in git (`docs/project-memory/tasks/<task id>-<slug>.md`, JSON front matter plus a markdown prompt). A launch request carries only the task id and attempt id. The worker verifies them against trusted state before acting and does nothing if they do not match. A leaked launch credential therefore cannot direct arbitrary work.
- **Start.** The worker's first push is a claim on its branch, which distinguishes "never started" from "still running".
- **Completion.** A valid report commit on the task branch, followed by CI on that commit, is the completion signal. Session status is never used. A watchdog marks a task stalled if no valid report appears within the policy limit.
- **Revision.** A revision is a new launch for the next attempt on the same branch, which reads the earlier review from git. Messaging an old session is not relied upon.
- **Retry.** An ambiguous launch is never retried automatically, because launches are not idempotent.

## Consequences

- The design tolerates the experimental interface changing, and a pluggable worker backend remains possible.
- Everything needed to resume work is in git.
- Tasks are public files; they must contain nothing sensitive.
