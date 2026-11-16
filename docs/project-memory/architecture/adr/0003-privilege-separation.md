# ADR-0003: Separate privileged workflows from untrusted worker code

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-003, REQ-OPS-001, REQ-OPS-003

## Context

A worker is an AI session that can change any file on its branch, including workflows. Its output, and any pull request or issue text that reaches the system, is untrusted. The repository is public, so anyone can open a fork pull request. Privileged credentials (a launch token, an API key) must never be reachable by code that a worker or an outsider controls.

## Decision

- Untrusted code runs in an unprivileged workflow: read-only token, no secrets, no environments.
- A separate privileged workflow runs from the default branch, is triggered when the unprivileged one completes, and treats everything it receives (artifacts, branch contents, pull-request text) as data. It never checks out or executes branch code and never installs branch dependencies.
- Before using any secret it verifies the run came from this repository, from a worker branch, from an allow-listed actor, for a task that the trusted state says is running.
- `pull_request_target` is not used.
- Secrets live in protected environments restricted to the default branch.
- A required status check is posted only by the privileged workflow, so a worker cannot fake it by editing its own workflow file.

This ADR records the decision only; no workflows exist yet.

## Consequences

- A compromised or misbehaving worker cannot reach credentials or approve its own work.
- Prompt injection from a fork pull request cannot spend model credits.
- Workflows are more numerous and need careful tests (forged artifacts, fork pull requests, spoofed identifiers).
