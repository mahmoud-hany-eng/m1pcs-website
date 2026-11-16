# ADR-0005: Deterministic policy decides risk classes; models are advisory

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-009, REQ-OPS-001, PATH-001, PATH-031

## Context

Autonomy needs a rule for what may run without a human. A model's or worker's own judgement of risk cannot be the authority: it can be wrong, manipulated by injected text, or tempted to minimise.

## Decision

`docs/project-memory/policy/policy.json` is human-owned and machine-readable. It defines:

- Risk classes. **A** is automatic and limited to documentation, tests and run reports. **B** needs a human approval before the run and before merge. **C** is never autonomous (production deploys, destructive operations, billing, credentials, infrastructure).
- Risk categories, each with a minimum class.
- Path rules that map real file paths to categories and to a restriction level: none, protected, control plane or immutable.
- Prohibited operations, limits, budget placeholders and a fail-closed kill switch.

The authoritative class is the maximum of all signals, computed by trusted code from the **actual changed paths** and the policy on the default branch. A class declared by a task author, reported by a worker or advised by the architect is advisory and can only raise the computed class. Unmatched paths default to class B. Control-plane files (workflows, `ops/`, `CLAUDE.md`, policy, schemas, the architect prompt) always need a human, and a task may change them only if its file list names them explicitly.

The offline validator enforces floors on the policy itself and checks golden classifications, so weakening the policy requires a visible change to a control-plane file.

## Consequences

- Risk handling is reproducible and testable, and cannot be argued away by text.
- The public site is held at class B until visual-regression baselines exist (OQ-0027).
- Pre-flight classification from file lists is conservative; the final class comes from the real diff.
