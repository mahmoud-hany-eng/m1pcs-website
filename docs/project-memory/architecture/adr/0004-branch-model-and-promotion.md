# ADR-0004: Branch model and promotion to production

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-OPS-008, REQ-OPS-001, REQ-OPS-006, HD-0005, OQ-0025, OQ-0028

## Context

Merging into `main` deploys the production site. The human requires that production deployments stay approval-gated (REQ-OPS-001) and that work use a dedicated development branch and previews (REQ-OPS-006). No standing push authorisation exists today (HD-0005).

## Decision

- Workers work only on `claude/` branches, one branch per task, named `claude/<task id in lower case>-<slug>`. A revision is another attempt on the same branch.
- The integration branch is `claude-dev` and builds previews. A worker never pushes to it directly. Once the orchestrator exists, it may merge an approved task branch into it, only after every deterministic gate has passed and only for a class that permits it.
- The production branch `main` is human-only. A human opens and merges the promotion, and that merge is the production deploy.
- Force pushes are never allowed.
- Until a human records a standing push authorisation, pushes need explicit approval each time and commits stay local. The policy field `pushes_currently_authorized` is false.

## Consequences

- Autonomy is bounded at previews.
- Every production change has an explicit human act.
- Some friction remains for class B work, by design.
