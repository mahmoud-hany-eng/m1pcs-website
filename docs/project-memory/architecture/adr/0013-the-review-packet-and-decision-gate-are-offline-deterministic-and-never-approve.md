# ADR-0013: The review packet and the decision gate are offline, deterministic, and never approve

- **Status:** proposed
- **Date:** 2026-11-17
- **Related:** HD-0016, HD-0017, REQ-OPS-008, REQ-OPS-009, REC-OPS-013, REC-OPS-016, REC-OPS-025, REC-OPS-026, ADR-0005, ADR-0006, ADR-0010, ADR-0012

## Context

The loop the owner wants is: a Claude developer, verified GitHub CI, an independent Claude reviewer, a deterministic gate, a next task. The reviewer is a model session, so its output is a claim (ADR-0006) and what it reads is partly written by the worker it is judging. Two things were missing: a defined, tamper-evident bundle of what the reviewer reads, and a deterministic check of what it returns. Both need no model and no credential, so they can be built and tested offline before any reviewer is started. The first reviewer test is manual (a person starts a separate session by hand, subscription only), so no token exists and no automatic dispatch is active.

## Decision

- **A review packet** is a fixed-layout directory bound by a manifest of SHA-256 hashes to one commit, one task and one attempt. The reviewer's instructions, the task definition, the policy, the decision schema and the cited requirements are taken from a **trusted baseline commit**, never from the worker's branch; the tool refuses to run from any checkout that is not that baseline. CI evidence, the changed-file list and the diff are computed by tools, not written by the worker. The worker's report and the text of the diff are labelled claims. No packet file can instruct the reviewer; instruction-like text in worker-written files is counted as data and never obeyed.
- **A decision gate** judges a reviewer's structured decision against the packet and the trusted policy and returns one of four results: `REVIEW_VALID_HUMAN_APPROVAL_REQUIRED`, `REQUIRES_CORRECTIONS`, `REVIEW_REJECTED`, `REVIEW_INVALID`. It re-derives facts instead of trusting the decision (the CI result from GitHub's fields, the risk class from the changed paths, the binding from the manifest) and reuses the project's existing decision validator and policy functions rather than duplicating them.
- **The gate never approves.** Its result always says a human is required, a reviewer's approval is recorded as advice and not binding, and the fields for merging, deploying, authorising a sensitive change and launching a task are fixed false. A reviewer may raise a risk class and never lower it. A reviewer may not propose tasks on the machinery that judges reviewers or controls CI, nor tasks containing production or destructive commands, nor tasks whose text carries instructions aimed at a model.
- **A new reviewer runtime, `manual_session`,** is added to the decision schema and the policy's allowed list, for a separate session that a person starts by hand. The policy's selected runtime stays `null`, so every review carries the "trial, cannot be relied on" warning (OQ-0031).
- **The first review is manual.** The owner follows a runbook, starts a restricted separate Claude Code session on the existing subscription, and runs the gate. Nothing in the repository starts a session.
- **The baseline for the first test is the reviewed OPS-0004 commit,** because the OPS-0003 task file does not exist at the OPS-0003 base. This is a deliberate, recorded exception (HD-0017): the owner's review of OPS-0004 is the trust anchor for the experiment.

## Alternatives considered

| Option | Why not |
|---|---|
| Let the reviewer read the repository at the worker's branch | The branch can redefine the reviewer's instructions and plant instructions in files (REC-OPS-016) |
| Trust the evidence's own verdict and the decision's stated CI status | Both are claims; recomputing from GitHub's fields costs a few lines |
| Let a passing gate trigger the next step | It would turn a model's advice into an action; every consequence stays with a human until the owner decides otherwise (OQ-0025) |
| Build the completion detector, automatic start and next-task generator now | They need OQ-0031, OQ-0032 and OQ-0036 and have nothing to act on until one review has been judged by a person |
| Sign the packet | Needs a secret or an unapproved action; the packet is instead rebuilt and compared by hash |

## Consequences

- The reviewer stage has a concrete, testable input and output contract. A reviewer that returns a decision bound to the wrong commit, the same session, a lowered class or a hostile proposal gets `REVIEW_INVALID`, and that is itself a measurable result of the experiment.
- The gate's trust is the trust of the baseline checkout it runs from. A packet or a gate run from an unreviewed checkout proves nothing; the settings guide's branch rules matter more once a gate exists, and the repository still lacks enforced human/worker identity separation (OQ-0036).
- The gate does not understand prose. It cannot catch a persuasive wrong summary; the human decides, and three judged reviews are the gate to the next stage.
- Changes to the packet builder, the gate and the judge-owned path list are control-plane changes. A reviewer judging them must use the baseline's copy of the tools.
- Nothing has run on GitHub for this branch. The decision stays proposed until the owner ratifies it with the other ADRs (OQ-0020).
