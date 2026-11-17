# OPS-0004 proposal: from a finished task to a validated review decision (offline, no model, no token)

**Status: proposal only.** This is not a task file, it is not approved, and nothing described here has been created or started. It is the design of the next implementation task, prepared by OPS-0003 as asked (HD-0015). It is the first part of stage STG-4 on the [roadmap](ROADMAP.md); the reviewer itself is not built here.

- **Class:** B (new files under `ops/**` and the policy/schema directories, all control-plane), so a human approves before the run and before any merge.
- **Cannot start until:** OPS-0003 has been reviewed and merged; the owner has decided OQ-0035 (where the trusted-base check is anchored) at least for the reviewer's workspace.
- **Constraints carried over:** the existing Claude subscription only (HD-0010, REQ-OPS-008); no API key, no token created, no secret, no privileged workflow, no new action, no paid service, nothing pushed without approval.

## 1. The target process and where each step is built

| Step the owner described | Built in | Needs a human decision first |
|---|---|---|
| 1. Detect a completed developer task | **OPS-0004** (a pure function over repository files and GitHub data) | What triggers it: OQ-0033 |
| 2. Obtain verified CI results | **Done in OPS-0003** (`ops/ci-evidence.mjs`, see [CI_EVIDENCE.md](../architecture/CI_EVIDENCE.md)); OPS-0004 only consumes it | None |
| 3. Start a separate Claude reviewer session | **OPS-0005** (by hand, no credential) and **OPS-0006** (automatic) | OQ-0031 (runtime), OQ-0032 (a long-lived subscription token, only for OPS-0006) |
| 4. Validate the reviewer's structured decision | **OPS-0004** | None |
| 5. Apply deterministic security policies | **OPS-0004** | None |
| 6. Generate the next approved development task | **OPS-0004** produces a validated *proposal*; **a human approves** it (class B and C always; class A later, STG-7) | OQ-0025 and OQ-0026 for any automatic approval |

OPS-0004 contains **no model call and no credential**. Everything in it can be tested offline with fixtures, in the style of OPS-0003.

## 2. Scope of OPS-0004

### A. Completion detector (`ops/lib/completion.mjs`)

A pure function: given the task file as it is in the base, the run report on the worker branch (a claim), and the evidence document for the branch head, it answers "is this attempt ready for review?" without trusting the worker. An attempt is ready only when all of these hold: the report names the task and attempt and a head commit that is the branch head; the report's `head_sha` equals the evidence's `subject.head_sha`; the evidence is `evidence_complete` (a trusted-base section and a GitHub CI section, from the same commit); and the attempt number is within the task's attempt limit. It reports **why** when not ready. It never reads anything from the head as code.

### B. Review packet builder (`ops/review-packet.mjs`)

Builds the input the reviewer reads, as one directory of files with recorded digests: the task file **from the base**; the run report (labelled a claim); the evidence document; the diff (bounded); the policy and prompt version. Each file's SHA-256 goes into the packet manifest, and the reviewer's decision must echo them (`reviewed.report_sha256`, `diff_sha256`, `ci_result_sha256`, `policy_version`, `prompt_version` already exist in the review-decision contract). The packet contains no credential and nothing from the head that is not data. The worker's own instruction files are never part of it (REC-OPS-016).

### C. Decision gate (`ops/decision-gate.mjs`)

Takes the reviewer's structured decision, the packet manifest and the evidence, and returns exactly one of `proceed_to_human`, `needs_human`, `reject_decision`. Deterministic, no model. It rejects a decision when:

| Check | Why |
|---|---|
| It does not validate against `review-decision.schema.json` | The contract |
| `reviewed.head_sha`, the three digests, the policy version or the prompt version differ from the packet | A decision about something else |
| The reviewer's session id equals the worker's session id, or either is missing | Role separation (REC-OPS-013); a mechanical check, not a boundary |
| It claims verification the evidence does not show: `ci_status: passed` while the evidence says CI did not pass, or `report_consistency: consistent` while the report's `head_sha` differs | A reviewer's claim is a claim (ADR-0006) |
| `risk_assessment.advised_class` is lower than the class the base policy computes for the changed paths | A model can raise a class, never lower one (ADR-0005) |
| The verdict is `approve` while the evidence says a control-plane, protected or immutable path changed | Those need a human whatever the reviewer says |
| The evidence says CI is not passed, not complete, or modified-from-base (`ci_trust_basis`) | The result is not evidence |
| A proposed next task fails the task schema, widens a scope the policy forbids, lists a forbidden path, exceeds the attempt budget, or declares a class lower than the policy computes for its own `files_allowed` | A task proposal is code-like input to the next worker |
| The decision text contains an instruction directed at the orchestrator (for example a request to skip checks), or a literal copy of a credential-looking string | Prompt-injection residue; the gate does not read prose for meaning, it only rejects what the policy already forbids and flags free-text fields for the human |

The gate can only add reasons for a human. A passing gate never merges, starts or approves anything.

### D. Next-task generator (`ops/next-task.mjs`)

Turns a gate-approved proposal into a **task file draft** (not committed, not activated), re-validated by the same task validator that checks every task, with `approval_reference` empty. The draft shows the human the class the policy computes, the scope, the acceptance commands and the questions the reviewer raised. A human approval (a new HD entry) is what makes it a task.

### E. Tests

At least the following, each as a fixture pair (decision plus evidence), most of them attacks: decision for another commit; digests that do not match; same session as the worker; reviewer claims CI passed while it failed; reviewer lowers the class; reviewer approves a control-plane change; proposal widens `files_allowed` to `src/**` or `.github/**`; proposal with a branch outside the worker prefix; proposal with a class lower than the policy computes; oversize or malformed decision; a decision that is valid JSON but has an extra field; an evidence document that was edited after hashing; and a mutation check over the gate rules as in OPS-0003.

### Not in OPS-0004

Starting any Claude session; creating a token; any workflow; reading GitHub live; merging; approving; editing settings. The detector and the gate take files, not network calls.

## 3. The two stages after it (not part of OPS-0004)

| Task | What | Prerequisite |
|---|---|---|
| **OPS-0005: manual shadow reviews** | The owner starts a **separate Claude session by hand** (subscription only, no token) in a workspace that holds the base revision, gives it the packet and the reviewer prompt, and saves the JSON it returns to `reviews/<task>/<attempt>/review.json`. The gate judges it. Three such reviews, compared with the owner's own judgement, are the STG-4 gate | OPS-0004 merged; the owner's time |
| **OPS-0006: automatic reviewer runtime** | The reviewer runs as a restricted session through the official GitHub Action in a CI-hosted job (the only runtime whose read-only isolation can be enforced from documented features, REVIEWER_FEASIBILITY.md), started when the detector says an attempt is ready. Output goes through the gate; the result is a comment or a file on a separate state branch, never a merge | OQ-0031 and OQ-0032 answered; the settings guide's Profile 2 (a separate automation identity) strongly advised, because a CI-hosted reviewer holds a subscription token |

## 4. Why this order

- The two risky parts (a model's judgement, and a credential) are last. The deterministic gate comes first so that a bad reviewer output has nowhere to go.
- A manual shadow stage costs no credential and shows whether the reviewer prompt gives useful advice before any automation is built around it.
- Each stage can stop without leaving a half-built system: OPS-0004 is useful to a human reviewing by hand, because the detector, packet and gate work on any decision file.

## 5. Approvals needed

1. Approve OPS-0004 to start (a new human decision, after OPS-0003 is reviewed and merged).
2. Answer OQ-0035 (anchor) for at least the reviewer's trusted workspace.
3. Before OPS-0006 only: OQ-0031, OQ-0032, OQ-0036. Nothing in OPS-0004 or OPS-0005 creates a token, a secret or a paid resource.

## 6. Risks to watch

- **Prose is not policed by meaning.** The gate rejects what the policy already forbids and passes free text to a human; a persuasive summary is still only a summary.
- **Role separation is a mechanical check on recorded identifiers** and is only as reliable as they are (REC-OPS-013).
- **The base must stay established.** The gate trusts the policy and prompt version of the base, so the settings guide's rules matter more once a gate exists.
