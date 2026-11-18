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
| STG-3 | Baseline CI (OPS-0002) and trusted-base verification and CI evidence (OPS-0003), both pushed once and green on GitHub (runs 43995081483 and 44082419253), then automatic worker reporting: an unprivileged collector, tasks still started by hand | in_progress | STG-2 | OQ-0028 (further pushes), OQ-0034, OQ-0035, OQ-0036 | Review OPS-0002 and OPS-0003 (accepted as completed phases, HD-0016); approve merges; set GitHub settings |
| STG-4 | Reviewer session in shadow mode: a separate read-only Claude session, comments only, no state change. Built in three tasks: OPS-0004 (reduced: review packet builder, deterministic decision gate and the manual-review runbook, no model; implemented on a local branch, HD-0017), OPS-0005 (the first manual review, no token), OPS-0006 (automatic runtime) | in_progress | STG-3 | OQ-0020, OQ-0022, OQ-0023, OQ-0031, OQ-0032, OQ-0035, OQ-0036, OQ-0037 | Judge three shadow reviews |
| STG-5 | Next-task generation, with human approval of proposals | not_started | STG-4 | OQ-0026 | Approve the first tasks |
| STG-6 | Automatic worker start, watchdog and compare-and-swap state | not_started | STG-5 | OQ-0019, OQ-0022, OQ-0028, OQ-0029, OQ-0033 | Supervised run |
| STG-7 | Controlled autonomous development for class A, inside the limits | not_started | STG-6 | OQ-0025, OQ-0027 | Standing approval, revocable |

## 3. Notes

- PH-1 and STG-3 overlap (both need CI). They should be planned together so that CI is built once.
- STG-2 adds the policy and the validator; it does not add workflows, secrets, environments or external connections.
- The owner decided that automation uses only the existing Claude subscription (HD-0010): there is no external AI service in any stage, and the reviewer is a separate Claude session (ADR-0009, ADR-0010).
- OPS-0002 (the first part of STG-3) was implemented locally (HD-0013), then pushed once as the single branch claude/ops-0002-ci-baseline on the owner's explicit approval (HD-0014). **Verified on GitHub:** run 43995081483, commit 0aba5e8, job `verify`, success; 353 tests, lint, type check, project-memory validation and the production build passed; read-only token; no production change. See [OPS-0002-PROPOSAL.md](OPS-0002-PROPOSAL.md) for the design, [CI_ARCHITECTURE.md](../architecture/CI_ARCHITECTURE.md) for what was built and [OPS-0002-ACTIVATION.md](OPS-0002-ACTIVATION.md) for the activation steps. That branch is not merged; `main` and `claude-dev` are unchanged on GitHub.
- OPS-0003 (the second part of STG-3: trusted-base verification and CI evidence) was authorised locally (HD-0015), then pushed once as the single branch claude/ops-0003-trusted-ci on the owner's explicit approval (HD-0016). **Verified on GitHub:** run 44082419253, commit 50a46ca, job `verify`, success; 417 of 417 tests (a count printed by the code under test), lint, type check, project-memory validation (111 files) and the build (56 of 56 pages) passed; read-only token; one Vercel Preview deployment and no Production deployment. The CI-evidence tool processed the real GitHub responses. The branch is not merged. Its check remains **advisory**: nothing independent enforces it until an anchor is chosen (OQ-0035), so control-plane changes still need a human, and the repository still lacks enforced separation between the human owner and the identity Claude acts under (OQ-0036). See [TRUSTED_CI.md](../architecture/TRUSTED_CI.md), [CI_EVIDENCE.md](../architecture/CI_EVIDENCE.md), [ADR-0012](../architecture/adr/0012-trusted-base-verification-is-advisory-until-anchored.md) and [GITHUB_SETTINGS_GUIDE.md](GITHUB_SETTINGS_GUIDE.md). The original scope is in [OPS-0003-PROPOSAL.md](OPS-0003-PROPOSAL.md).
- OPS-0004 was authorised as a reduced task for local implementation only (HD-0017) on claude/ops-0004-review-foundation, stacked on the OPS-0003 branch as a recorded dependency exception (OPS-0003 is not merged into claude-dev). It adds the review packet and the deterministic decision gate ([REVIEW_PACKET.md](../architecture/REVIEW_PACKET.md), [ADR-0013](../architecture/adr/0013-the-review-packet-and-decision-gate-are-offline-deterministic-and-never-approve.md)) and the runbook for the first manual review ([FIRST_REVIEW_RUNBOOK.md](../reviewer/FIRST_REVIEW_RUNBOOK.md)). It has not been pushed. **No automatic reviewer or dispatch system is active.** The first reviewer test (OPS-0005) is manual and subscription-only and has not been started; after the owner's correction (HD-0020) it is a **browser** procedure ([BROWSER_REVIEW.md](../architecture/BROWSER_REVIEW.md), [FIRST_REVIEW_RUNBOOK.md](../reviewer/FIRST_REVIEW_RUNBOOK.md)) that needs one push of the OPS-0004 branch (OQ-0037) and stays advisory. The permanent branch structure (REQ-OPS-011, HD-0018: `claude/**` features, `claude-dev` staging, `main` production) and the permanent separation of Instagram production from this repository (REQ-OPS-012, HD-0019, [INSTAGRAM_SEPARATION_PLAN.md](INSTAGRAM_SEPARATION_PLAN.md)) are recorded; the `creative/` cleanup is planned and waits for the owner (OQ-0038, OQ-0039). The original, larger proposal is [OPS-0004-PROPOSAL.md](OPS-0004-PROPOSAL.md).
- OPS-0005B (collector corrections, task id with a letter) and OPS-0006 (evidence consumers derive completeness themselves, task ids with one optional capital letter, review baseline checks with identifiable exceptions) were authorised for local implementation only. Both are committed on local branches (`claude/ops-0005b-evidence-hardening`, then `claude/ops-0006-consumer-integrity` stacked on it), are not pushed, have not run on GitHub, and have not been reviewed by an independent session. They record neither approval to integrate nor approval to deploy.
- Production changes happen only through a human-approved merge into the production branch (REQ-OPS-001).

## 4. Recommended next workstream: the M1 Business Platform

**Recommendation only. Nothing in this section is started or authorised, and no business feature is implemented by OPS-0006.**

The review pipeline now has what it needs to be trusted for routine, supervised work: a collector that fails closed (OPS-0005B), consumers that derive evidence completeness themselves, task identifiers that match the workflow, and a baseline that cannot pass as independent when it is not (OPS-0006). The next major workstream should therefore be the **M1 Business Platform** (phases PH-2 to PH-8 above), not more orchestration, in this priority order:

| Priority | Workstream | Phases | Blocked by |
|---|---|---|---|
| 1 | Supabase and backend architecture: the development backend project, schema, row-level security and SQL tests | PH-2 | OQ-0030 |
| 2 | Customer authentication and accounts, behind a flag | PH-3 | OQ-0002, OQ-0003, OQ-0004 |
| 3 | Admin customer and order management: the private admin with multi-factor authentication | PH-4, PH-5 (admin side) | OQ-0011, OQ-0018, OQ-0005, OQ-0013, OQ-0016 |
| 4 | Customer-visible order tracking: the customer timeline and real-time updates, with quote persistence and account linking | PH-5 (customer side), PH-6 | OQ-0003, OQ-0017 |
| 5 | Loyalty rewards and financial reporting | PH-7, PH-8 | OQ-0006 to OQ-0010, OQ-0012 |

Conditions that hold for every one of them:

- **The public website and its quotation process are preserved.** They keep working unchanged at every step; platform features sit behind flags or in private areas until the owner approves them.
- **Branches.** Each task is developed on its own isolated `claude/**` branch, integrated and tested on `claude-dev` (staging, with a preview), and released to `main` (production) only after the owner's explicit approval (REQ-OPS-001, REQ-OPS-011). Stacked branches never replace staging.
- **Sensitive work stays human-approved.** Authentication, row-level security, customer data, loyalty and finance logic, database schema, secrets and production deployment are class B or C under the policy and always need the owner's approval before the run and before any merge.
- **Instagram production stays outside this repository** (REQ-OPS-012), and no additional paid AI service is used (REQ-OPS-008).
- **The orchestration framework is not expanded** for this: stages STG-5 to STG-7 stay not started. Platform tasks are written by hand and run one at a time under the existing gate.

**What has to happen before the first platform task** (each step needs its own owner approval; the safe order is in the report that accompanied OPS-0006): the review of the two local OPS branches; their push and live CI verification; integration of the review tooling into `claude-dev` from a branch that starts at the published `origin/claude-dev` and does not contain the eight unpublished Reel commits; the owner's answer to OQ-0030 for the backend project; and the first platform task definition, approved by the owner.
