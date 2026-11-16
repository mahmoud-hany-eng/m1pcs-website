# Roadmap

**Status: proposed.** The sequence comes from the Phase 0 audits, which were approved with modifications that are not yet itemised (HD-0002, OQ-0020). A phase may start only when its dependencies are done and its blocking questions are resolved. The end of every phase is a human milestone gate.

Statuses: `not_started`, `in_progress`, `in_review`, `done`, `blocked`.

## 1. Platform phases

| Id | Phase | Status | Depends on | Blocked by | Production deploy |
|---|---|---|---|---|---|
| PH-1 | Foundations: CI, tests, visual baselines, security headers, dependency patches, `.env.example` | not_started | STG-2 | none | Yes, limited, after a preview check |
| PH-2 | Backend development project, schema, row-level security and SQL tests | not_started | PH-1 | OQ-0030 | No |
| PH-3 | Authentication and customer accounts, behind a flag | not_started | PH-2 | OQ-0002, OQ-0003, OQ-0004 | No |
| PH-4 | Private admin foundation with multi-factor authentication | not_started | PH-3 | OQ-0011, OQ-0018 | Dark only |
| PH-5 | Orders, payments, customer timeline and real time | not_started | PH-4 | OQ-0005, OQ-0013, OQ-0016 | Dark or pilot |
| PH-6 | Quote persistence and account linking | not_started | PH-5 | OQ-0003, OQ-0017 | Yes, flagged |
| PH-7 | Loyalty ledger and awarding | not_started | PH-5 | OQ-0006, OQ-0007, OQ-0008, OQ-0009, OQ-0010 | With the flag |
| PH-8 | Private finance | not_started | PH-5 | OQ-0012 | Dark, owners only |
| PH-9 | Hardening and launch | not_started | PH-3, PH-4, PH-5, PH-6, PH-7, PH-8 | OQ-0001, OQ-0014, OQ-0015 | Yes, with explicit approval |

Per-phase objective, scope, acceptance criteria, tests and risks are in the Phase 0 report and become task files when each phase is scheduled.

## 2. Automation stages

| Id | Stage | Status | Depends on | Blocked by | Human gate |
|---|---|---|---|---|---|
| STG-1 | Read-only audit | done | none | none | Done |
| STG-2 | Shared project memory, contracts, policy and offline validator (OPS-0001) | in_review | STG-1 | none | Review and merge |
| STG-3 | Automatic Claude reporting: unprivileged CI and a collector, tasks still started by hand | not_started | STG-2 | OQ-0020, OQ-0023 | Review and merge |
| STG-4 | Architect review in shadow mode (comments only, no state change) | not_started | STG-3 | OQ-0021, OQ-0024 | Judge three shadow reviews |
| STG-5 | Next-task generation, with human approval of proposals | not_started | STG-4 | OQ-0026 | Approve the first tasks |
| STG-6 | Cloud routine integration: launch, watchdog, compare-and-swap state | not_started | STG-5 | OQ-0019, OQ-0022, OQ-0028, OQ-0029 | Supervised run |
| STG-7 | Controlled autonomous development for class A, inside the limits | not_started | STG-6 | OQ-0025, OQ-0027 | Standing approval, revocable |

## 3. Notes

- PH-1 and STG-3 overlap (both need CI). They should be planned together so that CI is built once.
- STG-2 adds the policy and the validator; it does not add workflows, secrets, environments or external connections.
- Production changes happen only through a human-approved merge into the production branch (REQ-OPS-001).
