# Review packet and decision gate (OPS-0004)

**Status: implemented on a local branch (`claude/ops-0004-review-foundation`); not pushed; no reviewer has been run.** Authorised for local implementation only, as a reduced task (HD-0017). The decision record is [ADR-0013](adr/0013-the-review-packet-and-decision-gate-are-offline-deterministic-and-never-approve.md) (proposed). The design before implementation was [OPS-0004-PROPOSAL.md](../roadmap/OPS-0004-PROPOSAL.md); how a person runs the first review is [FIRST_REVIEW_RUNBOOK.md](../reviewer/FIRST_REVIEW_RUNBOOK.md).

**Evidence tags:** **[T]** a test run in this environment. **[O]** observed on a real object (a real GitHub run, the real repository). **[U]** not verified. Nothing marked [U] is claimed to work.

## 1. What it is, in one paragraph

The long-term loop is: Claude developer, verified GitHub CI, an independent Claude reviewer, a deterministic gate, a next task. OPS-0004 builds the two pieces that need no model and no credential: a **review packet** (everything a reviewer may read about one attempt of one task, bound to one commit) and a **decision gate** (a deterministic check of what the reviewer returned). Starting the reviewer is a separate step that a person does by hand for the first test. Nothing here starts a session, calls a model, reads GitHub, merges, deploys or launches another task.

## 2. The review packet

Built by `node ops/review-packet.mjs build ...` from a git repository and one CI evidence file; checked by `node ops/review-packet.mjs verify ...`. Both are offline.

```
MANIFEST.json                              binds the packet to a commit, a task and an attempt; SHA-256 of every file
trusted/    reviewer-instructions.md       the reviewer prompt, from the TRUSTED BASELINE commit
            review-decision.schema.json    the output contract, from the baseline
            task.md                        the approved task definition (with its acceptance criteria), from the baseline
            policy.json                    the deterministic policy, from the baseline
            requirements.md                the requirement lines the task cites, verbatim, from the baseline
            ci-evidence.json               GitHub's results about the run (ops/ci-evidence.mjs output)
            changed-files.json             the changed paths with risk classes, computed from git and the policy
untrusted/  run-report.json                the worker's own report: a claim
            diff.patch                     the diff: which lines changed is computed by git, the text is the worker's
            commits.json                   commit ids and subjects: the worker's text
```

- **"Trusted" says where a file came from, not that it may instruct.** No file in either folder can instruct the reviewer. Only the reviewer's launch message and its instructions from the baseline can. Instruction-like text found in worker-written files is **counted in the manifest** (`indicators`) as data and is never obeyed.
- **The reviewer's instructions cannot be redefined by the worker's branch.** The tool must run from a checkout of the baseline and refuses otherwise: its policy, all schemas and the reviewer prompt must be byte-identical to the baseline commit's (`PK-TOOL-NOT-BASELINE`). The task definition must exist **in the baseline** (`PK-TASK-NOT-IN-BASELINE`); a task that exists only on the worker's branch is refused. If the worker also edited its own task file, the packet uses the baseline's and records `task_file_matches_head: false`.
- **The report describes the work commit; the head is the later report commit.** The convention is that the report is a separate final commit, so the builder checks that the report's commit is an ancestor of the head and that **nothing but the report changed after it** (`PK-REPORT-HEAD`).
- **Bounded and refusing.** Per-file and total size limits; a diff above 1.5 MB is refused, not truncated (a reviewer cannot judge what it only partly sees). A credential-shaped string or an email address outside the policy's allowed list in any packet file stops the build (`PK-SENSITIVE`); the matched text is never echoed. A packet directory is never overwritten.
- **Deterministic.** There is no timestamp: the same repository, revisions and evidence file give byte-identical packets, so a packet can be rebuilt and compared by hash.
- **Evidence is recomputed, never trusted.** The CI result is derived from GitHub's own fields in the evidence (the run's status and conclusion and every blocking consistency check), and the evidence's own `verdict` must agree.

### What `verify` checks

Presence of exactly the fixed files and nothing else; no symbolic links; size limits; every SHA-256 against the manifest; the manifest against its schema; **the trusted files against this checkout's files** (policy, reviewer instructions, decision schema, task file, requirements lines), so a forger who recomputes the hashes is still caught; the change summary, the classification (recomputed from the policy) and that the files in the patch are exactly the files listed; that the CI evidence is about the head, carries GitHub data and agrees with itself; that the report and the commit list are for this task, attempt and head; and the same credential scan as at build time.

## 3. The decision gate

`node ops/decision-gate.mjs --packet <dir> --decision <review.json> [--expect-baseline <commit>]`. It runs from the baseline checkout, reads only the packet, the decision and that checkout's trusted files, and returns one deterministic result.

| Result | Exit | Meaning |
|---|---|---|
| `REVIEW_VALID_HUMAN_APPROVAL_REQUIRED` | 0 | The review is valid. A human still decides everything that follows. **Exit 0 is never an approval.** |
| `REQUIRES_CORRECTIONS` | 3 | A valid review of work that must be corrected: the reviewer asked for changes, CI failed, or files lie outside the task's scope |
| `REVIEW_REJECTED` | 4 | A valid review of work that must not go on: the reviewer rejected it, an immutable path or class C work is involved, or no attempts are left |
| `REVIEW_INVALID` | 5 | The packet or the decision cannot be relied on |

The worst outcome wins (invalid, then rejected, then corrections, then valid). The result always carries `human_approval_required: true`, `reviewer_approval_is_binding: false` and `automation: { merge, deploy, authorize_sensitive_change, launch_task }` all `false`: **a passing result never merges, deploys, authorises a sensitive change or starts a task**, and nothing in the gate can set those fields otherwise.

### What makes a decision invalid

- The decision does not match the strict decision schema, or fails the project's own decision validator (ids, runtime, verdict and next-step consistency, class floor, proposal checks).
- It is about another task, attempt, commit, report, diff, CI evidence, policy version or reviewer prompt version than the packet (`DG-BIND-*`): this catches forged commit hashes and stale decisions.
- The reviewer and worker session identifiers are missing, or are the same session or address (`DG-SESSION-*`). This is a mechanical check on recorded identifiers, not a security boundary.
- It contradicts GitHub's data as recomputed from the evidence: `ci_status` says passed while the run failed, or "not available" while evidence exists (`DG-CI-CONTRADICTION`).
- The reviewer advised a class below what the policy computes from the **actual changed paths**, the task's declared class and the report's declared class (`DG-CLASS-DOWNGRADE`). A reviewer may raise a class, never lower it.
- A reviewer's text contains a credential-shaped string (`DG-SECRET-IN-DECISION`).
- A **proposed next task** is treated as hostile input:
  - it reaches the machinery that judges reviewers or controls CI: `.github`, `CLAUDE.md`, the policy, the schemas, the reviewer prompt, the validator, the gate, the packet builder and `ops/lib` (`DG-PROPOSAL-TOUCHES-JUDGE`). A human writes tasks for those paths;
  - its commands push, merge, rewrite history, deploy, publish, pipe a download into a shell, delete recursively, use privilege or a remote shell (`DG-PROPOSAL-PROHIBITED-OPERATION`);
  - its text contains instruction-like phrases aimed at a model (`DG-PROPOSAL-INSTRUCTION-LIKE-TEXT`), so an injected instruction cannot be carried into the next worker's prompt;
  - plus the existing checks: a scope that starts with a wildcard, a class below the policy's, class C, an immutable path, too many attempts, an unknown dependency.

### What the gate decides from the work itself, whatever the reviewer said

An immutable path or class C work: rejected. Files outside the task's scope, or CI that did not succeed: corrections. An attempt beyond the limit, or needing rework on the last allowed attempt: rejected. A reviewer's `approve` never overrides these; it is advice, listed as `DG-HUMAN-REVIEWER-APPROVE-IS-ADVICE`.

### What a human must approve, from the policy (`human_approval_reasons`)

Class B or C work; protected, control-plane or immutable paths; money, identity, data, security, production, spending or settings categories; CI whose own definition is not shown to be unchanged from the base; instruction-like text found in worker-written files; a proposed task that reaches protected or control-plane paths. A reviewer's approval cannot remove any of these.

## 4. Tests

48 new tests (21 for the packet, 21 for the gate, 6 on real evidence; the whole suite is 465, all passing). Forty-two of them run on throwaway git repositories built from the real governed files, with CI evidence built from the data of an earlier real run (run 43995081483, re-addressed to the test commit). Six run on the **real, unmodified GitHub responses of run 44082419253** (the OPS-0003 run under review): the tests rebuild the stored evidence from the raw responses and require an exact match, check that the tools agree on it, and check that the gate's CI facts come from GitHub's fields and not from the evidence's own verdict. The directory `ops/tests/fixtures/ci/` has a README that separates real files from synthetic ones. They include: tampering with each packet file without and with recomputed hashes; a forger downgrading a protected, control-plane or immutable path; a worker rewriting its own task file and the reviewer prompt; a task only on the worker's branch; a tool run from a non-baseline checkout; forged and stale commit hashes; same session; contradictory and missing CI results; reviewer approval of protected, control-plane, sensitive, class C and immutable changes; downgraded risk classes; 26 proposals including scope expansion and production operations; prompt-injection text in reports, diffs and proposals; malformed, oversized and unusual decision files; damaged, extra, missing and oversized packet artifacts; command line exit codes. 

**Mutation check [T].** In a scratch copy, 63 deliberate weakenings of the security rules in the packet builder, the gate and the text checks were applied one at a time (for example: accept a non-baseline checkout, read the reviewer prompt or the task file from the worker's branch, skip a hash comparison, skip the check that trusted files match this checkout, accept a contradicting CI verdict, ignore a reviewer's approval of protected paths, skip the session comparison, make `reviewer_approval_is_binding` false-to-true, drop the credential or instruction scan). **62 were caught by at least one test.** One survived, and it is an **equivalent mutant**: the guard that checks the diff's size at build time is repeated by a later guard that checks every file against its limit, so removing one changes only the message. A second weakening (reading the reviewer prompt from the worker's branch) survived the first run because the test planted its text outside the prompt markers; the test was corrected and the weakening is now caught. The run is a scratch tool and is not committed; the list is in the run report.

## 5. Limits that remain

| Limit | Why it matters | What covers it |
|---|---|---|
| The gate cannot understand prose. A persuasive but wrong summary passes | It rejects what the policy already forbids and flags text for a human; it does not judge meaning | The human decides everything; the reviewer's approval is advice |
| Session separation is a comparison of recorded identifiers | A reviewer could report any identifier | A mechanical check only (REC-OPS-013); the packet records the worker's identifier from its report, itself a claim |
| The packet and the gate trust the baseline checkout they run from | If the baseline is not reviewed, so is the trust | Run them from a reviewed commit; the branch rules in the settings guide; the repository still lacks enforced human/worker identity separation (OQ-0036) |
| The trusted-base check remains advisory | CI evidence says whether the CI definition changed; it enforces nothing | OQ-0035; ADR-0012 |
| Instruction-like text detection is a short list of patterns | New phrasing is missed | Counted only as data; the reviewer prompt and the human are the defence |
| The judge-owned path list is a fixed list | A new control file would be missed until added | A change to it is a control-plane change (class B) |
| `manual_session` is a self-declared runtime | The decision cannot prove how it was produced | The policy still shows `selected: null`, so every review carries the "trial, cannot be relied on" warning (OQ-0031) |
| Nothing has run on GitHub for this branch | Tested locally and on stored real evidence only | The first push needs its own approval |
