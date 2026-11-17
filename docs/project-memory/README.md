# M1 project memory

The shared, versioned memory of the M1 Gaming PCs development system. Humans, the planning lead, Claude worker and reviewer sessions, and a future orchestrator all work from these files, so nothing depends on remembering earlier conversations (REQ-OPS-004). The repository is public: read the [content policy](#content-policy) before adding anything.

## Layout

| Path | What it holds | Who may change it |
|---|---|---|
| [requirements/MASTER_REQUIREMENTS.md](requirements/MASTER_REQUIREMENTS.md) | **Confirmed** requirements only (`REQ-`) | Humans |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | Technical **recommendations** (`REC-`), trust boundaries, evidence legend | Humans, on a reviewed task |
| [architecture/adr/](architecture/adr/) | Architecture decision records (`ADR-`) | Humans, on a reviewed task |
| [roadmap/ROADMAP.md](roadmap/ROADMAP.md) | Platform phases (`PH-`) and automation stages (`STG-`) | Humans, on a reviewed task |
| [decisions/HUMAN_DECISIONS.md](decisions/HUMAN_DECISIONS.md) | Append-only log of human decisions (`HD-`) | Humans only |
| [decisions/OPEN_QUESTIONS.md](decisions/OPEN_QUESTIONS.md) | **Unresolved** decisions (`OQ-`) | Humans; workers may propose |
| [tasks/](tasks/) | One file per task, plus [TEMPLATE.md](tasks/TEMPLATE.md) | Humans, or the reviewer through a reviewed proposal |
| [reviewer/REVIEWER_PROMPT.md](reviewer/REVIEWER_PROMPT.md) | Instructions for the separate, read-only reviewer session | Humans |
| [architecture/REVIEWER_FEASIBILITY.md](architecture/REVIEWER_FEASIBILITY.md) | Whether a Claude-only review loop is supported, with the evidence | Humans, on a reviewed task |
| [architecture/CI_ARCHITECTURE.md](architecture/CI_ARCHITECTURE.md) | The baseline CI design, its security decisions, test coverage and limits (OPS-0002) | Humans, on a reviewed task |
| [roadmap/OPS-0002-ACTIVATION.md](roadmap/OPS-0002-ACTIVATION.md) | What activating the CI workflow needs: branches, settings, protection rules, plan, preview builds | Humans |
| [roadmap/OPS-0003-PROPOSAL.md](roadmap/OPS-0003-PROPOSAL.md) | The scope proposed for OPS-0003 (implemented; pushed once and green on GitHub, HD-0016; the implementation notes win where they differ) | Humans |
| [architecture/TRUSTED_CI.md](architecture/TRUSTED_CI.md) | Trusted-base verification: how it works, why a second job in the same workflow is not a boundary, what anchors would be, limits (OPS-0003) | Humans, on a reviewed task |
| [architecture/CI_EVIDENCE.md](architecture/CI_EVIDENCE.md) | CI results as data from GitHub's own APIs: sources, the document, consistency checks, the first live run as fixture (OPS-0003) | Humans, on a reviewed task |
| [roadmap/GITHUB_SETTINGS_GUIDE.md](roadmap/GITHUB_SETTINGS_GUIDE.md) | Exact branch rules for `main` and `claude-dev`, what is observable, how rules interact with Claude's workflow, the Reel commits | Humans |
| [roadmap/OPS-0004-PROPOSAL.md](roadmap/OPS-0004-PROPOSAL.md) | The larger OPS-0004 proposal (completion detector, review packet and decision gate). Only the reduced scope was authorised (HD-0017) | Humans |
| [architecture/REVIEW_PACKET.md](architecture/REVIEW_PACKET.md) | The review packet and the deterministic decision gate: layout, what each checks, what a passing result means (nothing is approved), limits (OPS-0004) | Humans, on a reviewed task |
| [architecture/BROWSER_REVIEW.md](architecture/BROWSER_REVIEW.md) | Claude Code on the web as the reviewer's runtime: what is documented, observed and unverified; how the packet reaches a separate browser session; what is enforced versus only instructed (OPS-0004 correction) | Humans, on a reviewed task |
| [roadmap/INSTAGRAM_SEPARATION_PLAN.md](roadmap/INSTAGRAM_SEPARATION_PLAN.md) | The plan to keep Instagram and video production out of this repository: what exists, classification, phases, what stays in history (plan only; HD-0019) | Humans |
| [reviewer/FIRST_REVIEW_RUNBOOK.md](reviewer/FIRST_REVIEW_RUNBOOK.md) | The browser procedure for the first reviewer test of OPS-0003 with the exact launch message, plus an optional terminal procedure (OPS-0005 runs it; nothing has been run) | Humans |
| `reviews/<task id>/<attempt id>/review.json` | Reviewer decisions (unverified reviewer claims) | The orchestrator, in a later stage |
| [policy/policy.json](policy/policy.json) | The deterministic policy | Humans only |
| [schemas/](schemas/) | Strict, provider-neutral JSON contracts for tasks, run reports, reviewer decisions and the policy | Humans only |
| `runs/<task id>/<attempt id>/report.json` | Worker run reports (unverified claims) | The worker that did the run |
| `../../CLAUDE.md` | The worker protocol | Humans only |
| `../../ops/` | The offline validator and its tests | Humans, on a reviewed task |

Machine-written run state (the queue, budget and audit trail) will live in a separate branch written only by privileged workflows. It does not exist yet (STG-3 onwards).

## Three kinds of statement, kept apart

1. **Confirmed requirement** — something a human said. `REQ-<AREA>-<NNN>`, in MASTER_REQUIREMENTS.md.
2. **Recommendation** — a technical design choice proposed by an engineer or model. `REC-<AREA>-<NNN>`, in ARCHITECTURE.md. Not a decision.
3. **Open question** — a decision that belongs to a human. `OQ-<NNNN>`, in OPEN_QUESTIONS.md. No task may assume an answer.

A worker that needs a rule that is in none of the three must raise a question. It must never invent the rule.

## Identifiers

| Id | Meaning |
|---|---|
| `REQ-<AREA>-<NNN>` | Confirmed requirement |
| `REC-<AREA>-<NNN>` | Recommendation |
| `ADR-<NNNN>` | Architecture decision record (file `<NNNN>-<slug>.md`) |
| `OQ-<NNNN>` | Open question |
| `HD-<NNNN>` | Human decision |
| `PH-<n>`, `STG-<n>` | Platform phase, automation stage |
| `PATH-<NNN>`, `PROHIB-<NNN>` | Policy path rule, prohibited operation |
| `<PREFIX>-<NNNN>` | Task. Prefixes are listed in the policy |
| `<task id>-a<N>` | Attempt number N of a task |

The validator rejects a reference to an id that does not exist.

## Evidence

A **report** is a worker's claim. **Evidence** is what the orchestrator recomputes itself from GitHub. They are different documents and are never mixed (ADR-0006). A model's output, including the reviewer's, is advice that the deterministic policy can overrule (ADR-0005).

## Contracts and validation

```
npm run ops:validate                      # validate the whole project memory
node ops/validate-memory.mjs --file <path> [--kind task|report|decision]
npm run ops:test                          # the validator's own tests and fixtures
```

The validator uses only Node built-ins, needs no network and no credentials, and exits 0 when valid, 1 on validation errors and 2 on a usage error. It checks that required files exist, that the schemas are strict and consistent with each other and with the policy, that ids are unique and every reference resolves, that tasks and run reports conform and agree with the policy, and that nothing looks like a secret or personal data.

## Content policy

This repository is public. Never add secrets, customer data, supplier names or costs, margins, or other business-sensitive information (HD-0007). Use placeholders in examples. [CLAUDE.md](../../CLAUDE.md) section 12 has the full rule, and the validator scans for common patterns.

## Not built yet

OPS-0001 delivers memory, contracts, policy and the offline validator only. There are no workflows, no orchestrator, no launch of Claude sessions, no call to any external AI service, no secrets and no environments. See the [roadmap](roadmap/ROADMAP.md).
