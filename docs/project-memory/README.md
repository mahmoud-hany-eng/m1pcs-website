# M1 project memory

The shared, versioned memory of the M1 Gaming PCs development system. Humans, a GPT architect, Claude workers and a future orchestrator all work from these files, so nothing depends on remembering earlier conversations (REQ-OPS-004). The repository is public: read the [content policy](#content-policy) before adding anything.

## Layout

| Path | What it holds | Who may change it |
|---|---|---|
| [requirements/MASTER_REQUIREMENTS.md](requirements/MASTER_REQUIREMENTS.md) | **Confirmed** requirements only (`REQ-`) | Humans |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | Technical **recommendations** (`REC-`), trust boundaries, evidence legend | Humans, on a reviewed task |
| [architecture/adr/](architecture/adr/) | Architecture decision records (`ADR-`) | Humans, on a reviewed task |
| [roadmap/ROADMAP.md](roadmap/ROADMAP.md) | Platform phases (`PH-`) and automation stages (`STG-`) | Humans, on a reviewed task |
| [decisions/HUMAN_DECISIONS.md](decisions/HUMAN_DECISIONS.md) | Append-only log of human decisions (`HD-`) | Humans only |
| [decisions/OPEN_QUESTIONS.md](decisions/OPEN_QUESTIONS.md) | **Unresolved** decisions (`OQ-`) | Humans; workers may propose |
| [tasks/](tasks/) | One file per task, plus [TEMPLATE.md](tasks/TEMPLATE.md) | Humans, or the architect through a reviewed proposal |
| [architect/ARCHITECT_PROMPT.md](architect/ARCHITECT_PROMPT.md) | Reviewer instructions for the OpenAI architect | Humans |
| [policy/policy.json](policy/policy.json) | The deterministic policy | Humans only |
| [schemas/](schemas/) | Strict JSON contracts for tasks, run reports, architect decisions and the policy | Humans only |
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

A **report** is a worker's claim. **Evidence** is what the orchestrator recomputes itself from GitHub. They are different documents and are never mixed (ADR-0006). A model's output, including the architect's, is advice that the deterministic policy can overrule (ADR-0005).

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

OPS-0001 delivers memory, contracts, policy and the offline validator only. There are no workflows, no orchestrator, no launch of Claude sessions, no calls to the OpenAI API, no secrets and no environments. See the [roadmap](roadmap/ROADMAP.md).
