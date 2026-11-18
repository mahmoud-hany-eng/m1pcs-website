# OPS-0005B — run record, attempt 1

**Local only. Nothing was pushed, merged or deployed.** This record carries the structure of a worker run report (docs/project-memory/schemas/run-report.schema.json) in the JSON block at the end. It is a Markdown file, not a `report.json`, for the reason given in the first two deviations below. It is a worker's own claim (`unverified_worker_claim`).

## Baseline and commits

| Role | Commit |
|---|---|
| Published OPS-0004 tip (parent of the task) | `0a5707ade464a2ef4c0ab086e5973525e63f9ec2` |
| **Review baseline: the task definition, committed alone, before any implementation change** | `00b987cbc1d7edf4fbe4cd1e36ce44d47ad136d2` |
| Implementation | `49357841f85801bf2c4f7610953d4feb2416e76b` |
| Tests | `8d35ab7561f90c781e5d816ee7bc0b542d41ecab` |
| Documentation (last work commit, `head_sha`) | `d4247addd6fa676af4422f302d6a54a79c5508e8` |

The baseline commit changes one file, `docs/project-memory/roadmap/OPS-0005B-TASK.md`, and every implementation commit descends from it. A reviewer should read the task definition at the baseline, and the implementation as the difference between the baseline and `head_sha`, with the review tools taken from the baseline and not from `head_sha`.

## What changed

- `ops/lib/ci-evidence.mjs`: first-occurrence-wins `parseJobLog`; trusted step headers from the base's workflow; `compareRunHeaders`; mandatory checks recorded as failed when their input is missing; `verdict.missing_evidence`; completeness and `ci_passed` that cannot ignore a missing mandatory check.
- `ops/ci-evidence.mjs`: states the missing evidence.
- `docs/project-memory/schemas/ci-evidence.schema.json`: the verdict is an `anyOf` of the current shape (with `missing_evidence`) and the earlier shape; `schema_version` stays 1.
- `ops/tests/ci-evidence.test.mjs`, `ops/tests/real-evidence.test.mjs`: 25 tests added, one existing test adapted.
- `docs/project-memory/architecture/CI_EVIDENCE.md`: the limits of job-log parsing, the rules and why, the inputs a complete assessment needs, why `ci_passed` is false and not null, compatibility, and CI success versus authorization.

## The `ci_passed` decision

False, not null, when mandatory evidence is missing. Null already means that no GitHub run data was supplied; the packet builder and the gate recompute `ci_passed` from the blocking checks and refuse a document whose verdict disagrees, so null would need changes to them; and false and null both fail closed for a consumer that tests for true, while false needs no change in the gate, which already answers `DG-CI-FAILED` and `DG-EVIDENCE-INCOMPLETE`. The cost, that false does not distinguish failed from not established, is met by `missing_evidence` and the reasons.

## Structured record

```json
{
  "schema_version": "1",
  "report_kind": "worker_run_report",
  "task_id": "OPS-0005B",
  "attempt_id": "OPS-0005B-a1",
  "attempt_number": 1,
  "trust": {
    "level": "unverified_worker_claim",
    "verified_by_orchestrator": false
  },
  "session": {
    "id": "session_01JfqSpyHPxpWCRiwr546Nt4",
    "url": "https://claude.ai/code/session_01JfqSpyHPxpWCRiwr546Nt4"
  },
  "branch": "claude/ops-0005b-evidence-hardening",
  "base_branch": "claude/ops-0004-review-foundation",
  "base_sha": "0a5707ade464a2ef4c0ab086e5973525e63f9ec2",
  "head_sha": "d4247addd6fa676af4422f302d6a54a79c5508e8",
  "started_at": "2026-11-18T00:50:00Z",
  "finished_at": "2026-11-18T01:12:40Z",
  "outcome": "completed",
  "summary": "Corrected the two weaknesses of the CI evidence collector found by the first independent review (F-1, F-2), locally only. Baseline: the task definition was committed alone on top of the published OPS-0004 branch (0a5707a) as 00b987c, before any implementation change; every implementation commit descends from it. F-1: parseJobLog is first-occurrence-wins: only the first GITHUB_TOKEN Permissions block is read and only if it precedes the first step header; a repeated step header opens nothing and is recorded; three new blocking checks fail the evidence for a block that is not single and initial, a repeated header, and a header of no trusted step or out of the trusted workflow's order. GitHub's step data stays the primary evidence. F-2: a mandatory check whose input is missing is recorded as a failed blocking check (not run), verdict.missing_evidence lists the gap, evidence_complete is false, and ci_passed is false, not null: null already means no GitHub data at all, the packet builder and gate recompute ci_passed from the blocking checks and would reject a disagreeing null, and false fails closed for every consumer without changing them. The schema's verdict is an anyOf of the current shape and the earlier one so stored evidence stays valid. 25 tests added; 490 of 490 pass; lint, type check, validation and build pass in a clean-environment local simulation (not a GitHub Actions run). The gate, packet builder, trusted-base checker, validator, policy, CLAUDE.md and every decision record are byte-identical to the base.",
  "commits": [
    {
      "sha": "00b987cbc1d7edf4fbe4cd1e36ce44d47ad136d2",
      "subject": "OPS-0005B: record the task definition and acceptance criteria (review baseline)"
    },
    {
      "sha": "49357841f85801bf2c4f7610953d4feb2416e76b",
      "subject": "OPS-0005B: fail-closed job-log parsing and complete-evidence semantics (F-1, F-2)"
    },
    {
      "sha": "8d35ab7561f90c781e5d816ee7bc0b542d41ecab",
      "subject": "OPS-0005B: negative, compatibility and gate tests for F-1 and F-2"
    },
    {
      "sha": "d4247addd6fa676af4422f302d6a54a79c5508e8",
      "subject": "OPS-0005B: document the job-log limits, the fail-closed rules and complete evidence"
    }
  ],
  "changed_files": [
    {
      "path": "docs/project-memory/architecture/CI_EVIDENCE.md",
      "change_type": "modified",
      "additions": 50,
      "deletions": 9
    },
    {
      "path": "docs/project-memory/roadmap/OPS-0005B-TASK.md",
      "change_type": "added",
      "additions": 197,
      "deletions": 0
    },
    {
      "path": "docs/project-memory/schemas/ci-evidence.schema.json",
      "change_type": "modified",
      "additions": 122,
      "deletions": 26
    },
    {
      "path": "ops/ci-evidence.mjs",
      "change_type": "modified",
      "additions": 4,
      "deletions": 0
    },
    {
      "path": "ops/lib/ci-evidence.mjs",
      "change_type": "modified",
      "additions": 135,
      "deletions": 15
    },
    {
      "path": "ops/tests/ci-evidence.test.mjs",
      "change_type": "modified",
      "additions": 342,
      "deletions": 1
    },
    {
      "path": "ops/tests/real-evidence.test.mjs",
      "change_type": "modified",
      "additions": 150,
      "deletions": 5
    }
  ],
  "verification": [
    {
      "check_id": "lint",
      "command": "npm run lint",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 4.4,
      "output_excerpt": "> eslint .\n(no output: 0 errors, 0 warnings)",
      "output_sha256": "e9215c66afe27346477fece39068f6dc7a1fa4a63b4f7d7efd545ddcffd6e85d",
      "notes": "Run by a simulation of .github/workflows/ci.yml's commands in a clean export (git archive) of the committed tree at the last work commit, environment holding only PATH, a private HOME, CI=true and the network settings npm needs; no token, key or other credential. A local simulation, not a GitHub Actions run. Also run directly in the worktree: exit 0."
    },
    {
      "check_id": "typecheck",
      "command": "npx tsc --noEmit",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 4.8,
      "output_excerpt": "",
      "output_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "notes": "Run by a simulation of .github/workflows/ci.yml's commands in a clean export (git archive) of the committed tree at the last work commit, environment holding only PATH, a private HOME, CI=true and the network settings npm needs; no token, key or other credential. A local simulation, not a GitHub Actions run. Also run directly in the worktree: exit 0."
    },
    {
      "check_id": "build",
      "command": "npm run build",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 31.1,
      "output_excerpt": " ✓ Compiled successfully in 12.2s\n ✓ Generating static pages (56/56)",
      "output_sha256": "09351b60769faa0ab56ab02f85206d14498c0fa483d48ea701ccbabdda40a815",
      "notes": "Run by a simulation of .github/workflows/ci.yml's commands in a clean export (git archive) of the committed tree at the last work commit, environment holding only PATH, a private HOME, CI=true and the network settings npm needs; no token, key or other credential. A local simulation, not a GitHub Actions run. 56 of 56 static pages. Also run directly in the worktree: exit 0, 56 of 56."
    },
    {
      "check_id": "ops-validate",
      "command": "npm run ops:validate",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 0.2,
      "output_excerpt": "OK: checked 137 file(s); 0 warning(s).",
      "output_sha256": "492d832aee49e61f01ff4180045af622d99c38dd2fa8af5822a0d6ad27900a2b",
      "notes": "Run by a simulation of .github/workflows/ci.yml's commands in a clean export (git archive) of the committed tree at the last work commit, environment holding only PATH, a private HOME, CI=true and the network settings npm needs; no token, key or other credential. A local simulation, not a GitHub Actions run. Same result directly in the worktree."
    },
    {
      "check_id": "ops-test",
      "command": "npm run ops:test",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 24.6,
      "output_excerpt": "# tests 490\n# suites 0\n# pass 490\n# fail 0\n# cancelled 0\n# skipped 0",
      "output_sha256": "7f7cc31dcc79e301325bef6ef27b1149c609949e06682a6c001d5df5de525042",
      "notes": "Run by a simulation of .github/workflows/ci.yml's commands in a clean export (git archive) of the committed tree at the last work commit, environment holding only PATH, a private HOME, CI=true and the network settings npm needs; no token, key or other credential. A local simulation, not a GitHub Actions run. 490 tests, 490 pass, 0 fail (465 before this task, 25 added). Same counts directly in the worktree."
    },
    {
      "check_id": "install",
      "command": "npm ci --ignore-scripts --no-audit --no-fund",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 10.5,
      "output_excerpt": "",
      "output_sha256": "41d496643ba6931db9cb7000c6240dc751894d5320715a61eefbf0283a19ca04",
      "notes": "First step of the same local simulation (385 packages)."
    },
    {
      "check_id": "new-tests-against-baseline-implementation",
      "command": "node --test ops/tests/ci-evidence.test.mjs ops/tests/real-evidence.test.mjs (new tests, baseline implementation, scratch copy)",
      "exit_code": 1,
      "status": "failed",
      "duration_seconds": null,
      "output_excerpt": "# tests 66\n# pass 44\n# fail 22",
      "output_sha256": null,
      "notes": "Expected failure, which is the proof: run in a scratch copy of the baseline tree (00b987c) with only the two test files replaced. 22 tests fail on the unfixed implementation: 21 of the 25 new tests (including every OPS-0005A attack) and the one adapted existing test. The 4 new tests that pass are the works-as-before tests (legitimate log variants; GitHub's step data stays primary, on the stored and on the real data) and the schema test."
    },
    {
      "check_id": "mutation-check",
      "command": "python3 mutate.py (16 one-line weakenings of the corrected collector, scratch copy)",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": null,
      "output_excerpt": "killed 16 of 16",
      "output_sha256": null,
      "notes": "Each weakening of a new rule (read every block, accept a late block, allow two blocks, re-enter a segment, drop the repeat record, tolerate unknown or out-of-order headers, skip a missing input silently, ignore missing evidence in complete, ci_passed or the list, trust a log without a verified block, drop the reason) is caught by at least one test."
    },
    {
      "check_id": "real-full-logs",
      "command": "corrected collector on the real full job logs of runs 43995081483, 44082419253, 44200515736 and 5 alterations each (scratch)",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": null,
      "output_excerpt": "run 43995081483: 0 failing checks, tests 353/353/0\nrun 44082419253: 0 failing checks, tests 417/417/0\nrun 44200515736: 0 failing checks, tests 465/465/0\nALL REAL LOGS PASS AND ALL ALTERATIONS ARE CAUGHT",
      "output_sha256": null,
      "notes": "Logs fetched from GitHub without authentication on 2026-11-18, checked against each run's own trusted workflow and policy from git. Alterations: forged read-only block over a real write block, forged test header with TAP 9999, repeated header, swapped headers, unknown header; each fails exactly the expected blocking check and the forged 9999 never reached the test evidence."
    },
    {
      "check_id": "packet-and-gate-compat",
      "command": "ops/review-packet.mjs build and verify, then ops/decision-gate.mjs on the reviewer's real OPS-0005 decision (scratch)",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": null,
      "output_excerpt": "verify: valid true, ci_passed true, evidence_complete true\ngate exit 0: REVIEW_VALID_HUMAN_APPROVAL_REQUIRED",
      "output_sha256": null,
      "notes": "The real OPS-0003 packet rebuilt with the corrected toolchain from the stored earlier-shape evidence: valid; the reviewer's real decision file gives the same result, reasons, warnings, human reasons and computed values as in OPS-0005A; the evidence file is byte-identical to the one in the earlier packet."
    },
    {
      "check_id": "cli-fail-closed",
      "command": "ops/ci-evidence.mjs on real run 44082419253 data: all inputs; run and jobs only; no log; malformed file; forged log (scratch)",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": null,
      "output_excerpt": "all inputs: ci passed true, evidence complete true, exit 3 (human required: CI definition changed)\nrun+jobs only: ci passed false, missing check_runs, job_log, exit 3\nno log: ci passed false, missing job_log, exit 3\nmalformed: exit 2\nforged block: ci passed false, exit 3",
      "output_sha256": null,
      "notes": "Exit 3 means a human must review, which is correct for this change because it modifies what CI runs."
    }
  ],
  "risk": {
    "declared_class": "B",
    "categories": [
      "ops_control_plane",
      "policy_or_schema",
      "tests_only",
      "docs_only"
    ],
    "rationale": "ops/ files are control-plane paths and the schema and project-memory documents are protected, which the policy classes as B; the change adds tests and a document. Nothing under src, public, creative, .github, CLAUDE.md, the policy, the gate, the packet builder or the decision records changed, so no class C or immutable path is involved."
  },
  "protected_paths_touched": [
    "docs/project-memory/architecture/CI_EVIDENCE.md",
    "docs/project-memory/roadmap/OPS-0005B-TASK.md",
    "docs/project-memory/schemas/ci-evidence.schema.json",
    "ops/ci-evidence.mjs",
    "ops/lib/ci-evidence.mjs",
    "ops/tests/ci-evidence.test.mjs",
    "ops/tests/real-evidence.test.mjs"
  ],
  "deviations": [
    {
      "description": "The task definition was recorded as docs/project-memory/roadmap/OPS-0005B-TASK.md, not as a task file under tasks/.",
      "reason": "The task schema allows only ids like OPS-0001 and branches like claude/ops-0001-...; the owner's id OPS-0005B and branch claude/ops-0005b-evidence-hardening cannot be expressed, so a task file fails validation. Every other field was checked against the schema."
    },
    {
      "description": "This run record is a Markdown file with the report's structure in a JSON block, not runs/OPS-0005B/OPS-0005B-a1/report.json. Acceptance criterion AC-14 cannot be met as written.",
      "reason": "The run-report schema has the same id and branch patterns, the validator rejects any other JSON under runs/, and a report needs a schema-valid task file. The block was checked against the schema with only those expected conflicts."
    },
    {
      "description": "Acceptance criterion AC-9 said any schema change is additive and optional. The new verdict field is required in the current shape; the earlier shape stays valid through anyOf.",
      "reason": "The schema linter requires every property of a strict object to be required, so an optional field is impossible. The anyOf keeps stored evidence valid and schema_version stays 1."
    },
    {
      "description": "The existing test that required the stored real evidence's GitHub section to equal the rebuilt one exactly now ignores the three new checks, and a second test covers the differences.",
      "reason": "The corrected collector adds three passing checks to the same real data; AC-9 allows equality except for the listed additions. No gate or packet test was changed."
    },
    {
      "description": "No entry was added to HUMAN_DECISIONS.md, and the definition carries approval_reference null.",
      "reason": "The owner's instruction forbids new human-approval entries in this run; the definition is not a task file, so the validator's unapproved-task warning does not appear."
    }
  ],
  "unresolved_issues": [
    {
      "severity": "major",
      "category": "ops_control_plane",
      "description": "The review packet builder and the decision gate recompute ci_passed from the consistency checks but read evidence_complete and missing_evidence from the document. A hand-written document that omits the mandatory checks would still pass their derivation. This tool never produces one. Closing it means making the packet builder's deriveCi and the verifier require the mandatory check ids; that is outside this task and is proposed, not made."
    },
    {
      "severity": "major",
      "category": "ops_control_plane",
      "description": "The task and run-report schemas and the validator cannot represent a letter-suffixed task id or branch, so OPS-0005B has no schema-valid task file and the standard packet builder cannot take it as a task. An independent review of this work needs either a conforming id for it or an owner-approved relaxation of the patterns (a class B schema and validator change)."
    },
    {
      "severity": "minor",
      "category": "ops_control_plane",
      "description": "The fail-closed rules assume the log structure the runner printed in three real logs (one permission block before the first step header, one header per step, first lines of the commands). A future runner change would make the checks fail closed, so a person would look; it cannot make them pass."
    },
    {
      "severity": "minor",
      "category": "ops_control_plane",
      "description": "Forged log lines do not need a flagged path to be printed: any code a step runs, such as the build, can print them. What limits them is their effect: a forged permission block matters only with a workflow change, which is flagged; forged test counts reach only a non-blocking claim."
    },
    {
      "severity": "info",
      "category": "ops_control_plane",
      "description": "Nothing was run on GitHub Actions. All results are from the local runs described; the corrected collector has not processed a run of its own branch."
    }
  ],
  "assumptions": [
    "started_at is approximate: the work began after the owner's message and the worktree was created minutes later.",
    "The three real logs fetched on 2026-11-18 are the logs of those runs as GitHub serves them; they match the stored fixtures where both exist.",
    "The owner's instruction is the authority for this task; this file only transcribes it."
  ],
  "questions_for_human": [
    "How should task ids and branches with a letter suffix, such as OPS-0005B, be represented: relax the schema and validator patterns (a class B change), or use only conforming ids from now on?",
    "Do you want a small follow-up task so that the packet builder and the verifier require the mandatory check ids (consumers recompute completeness)?",
    "Should an independent reviewer review this work against baseline 00b987c, and if so under which task id?",
    "Do you approve the human-decision governance protocol proposed in the final report, and who records HD entries meanwhile?",
    "Do you authorise one push of exactly claude/ops-0005b-evidence-hardening so that a browser reviewer can fetch it? None was made."
  ],
  "attestations": {
    "no_secrets_committed": true,
    "no_production_changes": true,
    "no_unauthorized_pushes": true,
    "stayed_within_files_allowed": true
  },
  "next_step_recommendation": {
    "action": "review",
    "rationale": "The correction is complete on the local branch. A person should read F-1 and F-2 as implemented, decide the id and branch question, and decide whether an independent reviewer reviews it against baseline 00b987c and whether the consumers' recompute gap is closed next.",
    "suggested_next_task_title": "Packet builder and verifier require the mandatory evidence checks"
  }
}
```
