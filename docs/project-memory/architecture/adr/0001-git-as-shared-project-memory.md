# ADR-0001: Git is the shared project memory

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-001, REQ-OPS-004, REQ-OPS-007, HD-0007

## Context

The development system must not depend on remembering the text of earlier Claude conversations (REQ-OPS-004). Different actors (the human, a GPT architect, Claude workers, a future orchestrator) all need the same facts: requirements, decisions, the roadmap and the current task. The repository is public (HD-0007), so everything committed is world-readable.

## Decision

Project memory is plain files in this repository under `docs/project-memory/`, plus `CLAUDE.md` for worker instructions. Humans govern requirements, decisions, architecture, the roadmap, task files and policy. Machine-written run state belongs in a separate branch written only by privileged workflows (not built). Every entity has a stable id (`REQ-`, `REC-`, `ADR-`, `OQ-`, `HD-`, `PH-`, `STG-`, task and attempt ids), and an offline validator checks that all references resolve and the required files exist.

Because the repository is public, a content policy applies: no secrets, customer data, supplier costs, margins or other business-sensitive information. The validator scans for such patterns.

## Consequences

- Any actor can rebuild context from files alone; no conversation history is needed.
- Memory is versioned, reviewable and diffable, and its history is the audit trail.
- Everything is public. Sensitive material must stay out of git entirely, which limits what memory can record. A private operations repository is an open option (OQ-0023) but would lose free rulesets and approval environments.
