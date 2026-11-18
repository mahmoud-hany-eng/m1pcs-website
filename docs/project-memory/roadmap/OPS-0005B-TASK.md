# OPS-0005B — CI evidence security corrections (task definition and acceptance criteria)

**Status: approved by the owner's instruction, implementation not started when this file was committed.** This file is the task definition. It is committed alone, on top of the published OPS-0004 branch, before any implementation change, and that commit is the baseline for reviewing the implementation.

It was transcribed by a worker session from the owner's instruction "M1 Gaming PCs — OPS-0005B: CI Evidence Security Corrections" (received on 2026-11-18). The instruction, not this file, is the authority. The instruction says not to add any human-approval entry in this run, so no entry exists in HUMAN_DECISIONS.md for it, the structured block below carries `approval_reference: null`, and authorship of this file grants no approval.

## Why this is a roadmap document and not a task file

The structured block below has the shape of `docs/project-memory/schemas/task.schema.json`. It is not stored in `docs/project-memory/tasks/` because the schema cannot express two names the owner chose: the task id `OPS-0005B` (the schema requires `^[A-Z]{3,5}-[0-9]{4}$`, which allows no letter after the digits) and the branch `claude/ops-0005b-evidence-hardening` (the schema requires `^claude/[a-z]{3,5}-[0-9]{4}-…`). A task file with either name fails validation, and the review packet builder, which reads a schema-valid task file from the baseline, cannot take it. Every other field of the block was checked against the schema. Changing the schema or the validator is outside this task and is reported as a finding with a proposal.

## Context

OPS-0005 was the first independent browser review of OPS-0003 (reviewer session `session_01Y44K8HjaaWz7EE2dFUz7BQ`). OPS-0005A, run by the developer session, reproduced the review's gate result, confirmed all seven findings, and demonstrated F-1 and F-2 on the real job log of run 44082419253:

- **F-1.** `parseJobLog` in `ops/lib/ci-evidence.mjs` restarts the permission list at every `##[group]GITHUB_TOKEN Permissions` line and re-enters a step's segment at every `##[group]Run <command>` line. A step that runs branch code can therefore print a second permissions block that replaces the real one, or re-open the test step's segment and append a forged TAP summary (the last match wins). A forged summary printed without a forged header is already ignored; a forged header defeats that.
- **F-2.** The check-run check exists only when check runs are supplied, and the token and header checks exist only when a job log is supplied. `evidence_complete` needs only a trusted-base section and a GitHub section, so evidence built from run and jobs data alone reports `ci_passed` true and `evidence_complete` true although blocking checks never ran.

The reviewer also found that OPS-0003 was reviewed from a baseline that already contained the code under review. For this task the baseline is established first: the commit that adds this file is the baseline for reviewing the implementation, and it predates every implementation change. The branch is stacked on `claude/ops-0004-review-foundation` (0a5707ade464a2ef4c0ab086e5973525e63f9ec2) because the owner instructed it. OPS-0004 is not merged into `claude-dev`, so this records neither approval to integrate nor approval to deploy.

The permanent rules apply unchanged: `claude/**` is feature development, `claude-dev` is staging and integration testing, `main` is production; Instagram production assets never go into this repository; no additional paid AI service is used; sensitive changes and production releases need the owner's approval; the eight unpublished Reel commits stay untouched.

## What to do

1. Create the branch and a separate worktree from the published OPS-0004 branch. Commit this file alone. That commit is the baseline.
2. F-1: make the job-log parser fail closed. The first occurrence wins; one permissions block in the initial position; no repeated, unknown or out-of-order step headers; no later content may overwrite an earlier verified result. Each violation is a failing blocking consistency check. GitHub's job and step conclusions stay the primary evidence and the log text stays a claim.
3. F-2: record each mandatory check that could not run as a failed blocking check, list the missing evidence explicitly in the verdict, and make `evidence_complete` false whenever a mandatory input or check is missing. Decide, and justify against the existing packet-builder and gate contracts, whether `ci_passed` becomes false or null. Do not edit the packet builder or the gate.
4. Add negative tests built from mutated copies of real GitHub data, tests for complete, incomplete, malformed and contradictory input sets, and a compatibility check against the committed real evidence of run 44082419253.
5. Update `docs/project-memory/architecture/CI_EVIDENCE.md` only.
6. Verify, commit locally in small commits, and write the attempt 1 run report as a separate final commit that records the baseline SHA. Do not push.

## Out of scope

See the block below. A correction that turns out to need a file outside `files_allowed` (for example a change to how the packet builder recomputes completeness, or to the task schema's id and branch patterns) is reported with a proposal and not made.

## How completion is shown

The five required checks with their exact test counts, the new negative tests failing against the baseline implementation and passing against the fixed one, the compatibility results on the real OPS-0003 evidence and on three real job logs, the boundary checks, and the run report at `docs/project-memory/runs/OPS-0005B/OPS-0005B-a1/report.json`. A local simulation of the workflow's commands is not a GitHub Actions run and is never reported as one.

## Structured definition

```json
{
  "schema_version": "1",
  "task_id": "OPS-0005B",
  "title": "CI evidence security corrections: fail-closed job-log parsing and complete-evidence semantics",
  "objective": "Correct the two weaknesses in the CI evidence collector that the first independent reviewer found (F-1, F-2) and the developer reproduced, before the collector is used for autonomous development decisions. F-1: a later step can print a forged GITHUB_TOKEN Permissions block or a forged Run header, and the job-log parser accepts it. F-2: evidence reads complete and passed although the check-run and job-log checks never ran. Implement fail-closed parsing and completeness, add negative tests from mutated copies of real GitHub data, update the one directly relevant architecture document, and change nothing else. Local only.",
  "depends_on": ["OPS-0004"],
  "blocked_by_open_questions": [],
  "requirement_refs": ["REQ-OPS-001", "REQ-OPS-007", "REQ-OPS-008", "REQ-OPS-009", "REQ-OPS-010", "REQ-OPS-011", "REQ-OPS-012"],
  "declared_risk_class": "B",
  "declared_risk_categories": ["ops_control_plane", "policy_or_schema", "tests_only", "docs_only"],
  "base_branch": "claude/ops-0004-review-foundation",
  "branch": "claude/ops-0005b-evidence-hardening",
  "files_allowed": [
    "ops/lib/ci-evidence.mjs",
    "ops/ci-evidence.mjs",
    "ops/tests/**",
    "docs/project-memory/schemas/ci-evidence.schema.json",
    "docs/project-memory/architecture/CI_EVIDENCE.md",
    "docs/project-memory/roadmap/OPS-0005B-TASK.md",
    "docs/project-memory/runs/OPS-0005B/**"
  ],
  "files_forbidden": [
    ".github/**",
    "src/**",
    "public/**",
    "creative/**",
    "CLAUDE.md",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "vercel.json",
    ".env*",
    "ops/decision-gate.mjs",
    "ops/lib/decision-gate.mjs",
    "ops/review-packet.mjs",
    "ops/lib/review-packet.mjs",
    "ops/lib/trusted-base.mjs",
    "ops/validate-memory.mjs",
    "docs/project-memory/policy/**",
    "docs/project-memory/decisions/**",
    "docs/project-memory/requirements/**",
    "docs/project-memory/reviewer/**",
    "docs/project-memory/schemas/task.schema.json"
  ],
  "out_of_scope": [
    "Pushing, merging, opening a pull request or deploying",
    "Changing GitHub account or repository settings, creating secrets or tokens, or activating a paid service",
    "Any change to the decision gate, the review packet builder or verifier, the trusted-base checker, the validator, the policy, the task schema or CLAUDE.md; a necessary change there is reported, not made",
    "Any change to HUMAN_DECISIONS.md and any new human-approval entry; the owner's instruction for this task is not transcribed into it in this run",
    "The human-decision governance proposal, which belongs in the final report only",
    "Any change to .github/workflows/ci.yml, the production website source, assets or build configuration",
    "Touching creative/ or any of the eight unpublished Reel commits, and any Instagram production asset",
    "Modifying the historical OPS-0003 or OPS-0004 commits or any other existing branch",
    "Treating text printed by the code under test as authenticated, signed or trustworthy",
    "Starting another task, including a reviewer run"
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "F-1, permission block. The job-log parser reads the GITHUB_TOKEN Permissions block only when exactly one exists and it precedes the first step header. A second block, or a block after a step header, never replaces or supplements the first, and the evidence then has a failing blocking consistency check, so ci_passed is false. The genuine block is still reported as read.",
      "verification_method": "command",
      "command": "node --test ops/tests/ci-evidence.test.mjs"
    },
    {
      "id": "AC-2",
      "statement": "F-1, step headers. A repeated Run header, a Run header that is not a step of the trusted workflow, and Run headers out of the trusted workflow's order each produce a failing blocking consistency check. Lines after a repeated header are never added to an earlier verified segment; earlier parsing results are never overwritten by later log content.",
      "verification_method": "command",
      "command": "node --test ops/tests/ci-evidence.test.mjs"
    },
    {
      "id": "AC-3",
      "statement": "F-1, compatibility and authority. The stored real logs of runs 43995081483 and 44082419253 still pass, and in verification so do the full real logs of runs 43995081483, 44082419253 and 44200515736 fetched from GitHub. GitHub's job and step conclusions stay the primary evidence of success; job-log text stays a claim by the code under test and never decides success alone.",
      "verification_method": "command",
      "command": "node --test ops/tests/real-evidence.test.mjs"
    },
    {
      "id": "AC-4",
      "statement": "F-1, negative tests. Tests built from mutated copies of real log data cover a forged permissions block, a forged test header with a forged TAP summary, a repeated header, out-of-order headers, and legitimate logs (CRLF, ANSI and timestamp variants). Each attack reproduced in OPS-0005A fails against the unfixed collector (shown by running the new tests against the baseline implementation) and passes against the fixed one.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-5",
      "statement": "F-2, explicit missing evidence. Missing check-run data and missing job-log data are identified explicitly in the evidence verdict as a list, and each mandatory check that could not run is recorded as a failed blocking consistency check instead of being absent.",
      "verification_method": "command",
      "command": "node --test ops/tests/ci-evidence.test.mjs"
    },
    {
      "id": "AC-6",
      "statement": "F-2, completeness and ci_passed. evidence_complete is false whenever a mandatory check was skipped, a mandatory input is missing or a blocking check failed. The safest value of ci_passed when mandatory evidence is missing (false or null) is chosen consistently with the packet builder's and the gate's existing contracts, without changing them, and explained. Partial observations are still reported accurately.",
      "verification_method": "command",
      "command": "node --test ops/tests/ci-evidence.test.mjs"
    },
    {
      "id": "AC-7",
      "statement": "F-2, tests. Tests cover complete, incomplete, malformed and contradictory input sets, and the command-line tool reports the missing evidence and exits non-zero when a human must review.",
      "verification_method": "command",
      "command": "node --test ops/tests/ci-evidence.test.mjs"
    },
    {
      "id": "AC-8",
      "statement": "Documentation. CI_EVIDENCE.md states the limits of parsing job-log text, why duplicated or forged headers are rejected, which evidence inputs a complete assessment requires, and the difference between CI success and authorization to proceed. No other architecture or project-memory document differs from the base, apart from this file and the run report.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-9",
      "statement": "Compatibility. Any schema change is additive and optional and schema_version stays 1. The committed real evidence of run 44082419253 still validates, a review packet that used it still verifies, and the corrected collector's output for the real OPS-0003 data equals that document except for the listed additions.",
      "verification_method": "command",
      "command": "node --test ops/tests/real-evidence.test.mjs ops/tests/review-packet.test.mjs ops/tests/decision-gate.test.mjs"
    },
    {
      "id": "AC-10",
      "statement": "The decision gate is not weakened. The gate, the packet builder and verifier, the trusted-base checker, the validator, the policy, the task schema, CLAUDE.md and every human-decision and requirement record are byte-identical to the base, and the gate and packet tests pass unchanged.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-11",
      "statement": "Lint, type check, project-memory validation, every automated test and the production build pass in a checkout that installed dependencies with npm ci --ignore-scripts, with the exact numbers of passing and failing tests recorded. A local run is never described as a GitHub Actions run.",
      "verification_method": "command",
      "command": "npm ci --ignore-scripts --no-audit --no-fund && npm run lint && npx tsc --noEmit && npm run ops:validate && npm run ops:test && npm run build"
    },
    {
      "id": "AC-12",
      "statement": "Boundaries. Nothing under src/, public/, creative/, .github/, CLAUDE.md, package.json or any build or Vercel configuration differs from the base; HUMAN_DECISIONS.md is unmodified with no new entry; none of the eight Reel commits is reachable from the task branch; nothing is pushed; main, claude-dev and every other branch, and the main working tree, are unchanged.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-13",
      "statement": "Review baseline. The commit that adds this file is the baseline for reviewing the implementation. It is made on top of 0a5707ade464a2ef4c0ab086e5973525e63f9ec2, changes only this file, and every implementation commit descends from it. The run report records its SHA.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-14",
      "statement": "A run report for attempt 1 exists and validates against the run-report schema.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file docs/project-memory/runs/OPS-0005B/OPS-0005B-a1/report.json"
    }
  ],
  "required_checks": [
    { "id": "lint", "command": "npm run lint", "description": "ESLint over the repository", "must_pass": true },
    { "id": "typecheck", "command": "npx tsc --noEmit", "description": "TypeScript type check", "must_pass": true },
    { "id": "build", "command": "npm run build", "description": "Production build of the website", "must_pass": true },
    { "id": "ops-validate", "command": "npm run ops:validate", "description": "Offline project-memory and workflow validation", "must_pass": true },
    { "id": "ops-test", "command": "npm run ops:test", "description": "Validator, checker, parser, trusted-base, CI evidence, review packet and decision gate tests", "must_pass": true }
  ],
  "max_attempts": 3,
  "approval_reference": null,
  "created_at": "2026-11-18T01:05:00Z",
  "created_by": "worker"
}
```
