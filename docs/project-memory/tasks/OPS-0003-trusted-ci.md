---json
{
  "schema_version": "1",
  "task_id": "OPS-0003",
  "title": "Trusted CI verification and integration security",
  "objective": "Make it possible to judge a change with the rules of an established base revision instead of the branch's own copy, so that a future autonomous worker cannot pass its own checks by editing them; express CI results as data taken from GitHub's own APIs for a future reviewer; and document the GitHub settings that would make the base trustworthy. Analyse explicitly why a second job in the same modifiable workflow is not an independent boundary, and claim no independent enforcement. Implement locally only: nothing is pushed, merged, activated or changed in GitHub settings.",
  "depends_on": ["OPS-0002"],
  "blocked_by_open_questions": [],
  "requirement_refs": ["REQ-PRES-001", "REQ-OPS-001", "REQ-OPS-003", "REQ-OPS-007", "REQ-OPS-008", "REQ-OPS-009", "REQ-OPS-010"],
  "declared_risk_class": "B",
  "declared_risk_categories": ["ops_control_plane", "policy_or_schema", "tests_only", "docs_only"],
  "base_branch": "claude-dev",
  "branch": "claude/ops-0003-trusted-ci",
  "files_allowed": [
    "ops/**",
    "docs/project-memory/policy/**",
    "docs/project-memory/schemas/**",
    "docs/project-memory/README.md",
    "docs/project-memory/requirements/**",
    "docs/project-memory/architecture/**",
    "docs/project-memory/roadmap/**",
    "docs/project-memory/decisions/**",
    "docs/project-memory/tasks/**",
    "docs/project-memory/runs/**"
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
    ".env*"
  ],
  "out_of_scope": [
    "Pushing, merging, opening a pull request or deploying",
    "Changing GitHub account or repository settings, creating rulesets, CODEOWNERS or secrets (the owner does that: OQ-0034, OQ-0036)",
    "Any change to .github/workflows/ci.yml: no second job is added, because a second job in the same modifiable workflow is not an independent boundary",
    "Any token, API key, environment, paid service, or Claude or other model session; implementing the reviewer",
    "Any change to the production website source, assets or build configuration",
    "Touching the eight unpushed Reel commits or the creative project",
    "Beginning OPS-0004 (the offline completion detector, review packet and decision gate)"
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "The trusted-base check judges a change with the validator, policy and schemas of the base revision, never executes or imports the head, and its negative tests show attacks that pass the branch's own validation (lockstep weakening of workflow, policy and schema; a weakened checker) being caught.",
      "verification_method": "command",
      "command": "node --test ops/tests/trusted-base.test.mjs"
    },
    {
      "id": "AC-2",
      "statement": "CI results are produced as a strict, schema-validated document from GitHub's Actions and Checks data, with expectations taken from the base, test counts labelled as claims, and the real first live run as a fixture; hostile variations are rejected.",
      "verification_method": "command",
      "command": "node --test ops/tests/ci-evidence.test.mjs"
    },
    {
      "id": "AC-3",
      "statement": "Lint, type check, the production build, the project-memory validation and every automated test pass, in a checkout that installed dependencies with npm ci --ignore-scripts and had no credential in its environment.",
      "verification_method": "command",
      "command": "npm ci --ignore-scripts --no-audit --no-fund && npm run lint && npx tsc --noEmit && npm run ops:validate && npm run ops:test && npm run build"
    },
    {
      "id": "AC-4",
      "statement": "Nothing under src/, public/, creative/, .github/, CLAUDE.md or package.json differs from the base, and the build output at the same path is identical to the baseline after removing per-build randomness.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-5",
      "statement": "The work is committed only on the task branch, nothing is pushed, the branch contains none of the eight Reel commits, and the main working tree, the Reel commits and the creative file-mode change are untouched.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-6",
      "statement": "The documentation states the anchoring limitation explicitly (a second job in the same workflow is not a boundary), claims no independent enforcement, keeps control-plane changes human-approved, gives exact branch settings for main and claude-dev with what is and is not observable, accounts for the eight Reel commits, and records the first live run in project memory.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-7",
      "statement": "The next task for automatic Claude review is designed as a proposal that needs no token and no model call, and nothing of the reviewer is implemented.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-8",
      "statement": "A run report for this attempt exists and validates against the run-report schema.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file docs/project-memory/runs/OPS-0003/OPS-0003-a1/report.json"
    }
  ],
  "required_checks": [
    { "id": "lint", "command": "npm run lint", "description": "ESLint over the repository", "must_pass": true },
    { "id": "typecheck", "command": "npx tsc --noEmit", "description": "TypeScript type check", "must_pass": true },
    { "id": "build", "command": "npm run build", "description": "Production build of the website", "must_pass": true },
    { "id": "ops-validate", "command": "npm run ops:validate", "description": "Offline project-memory and workflow validation", "must_pass": true },
    { "id": "ops-test", "command": "npm run ops:test", "description": "Validator, checker, parser, trusted-base and CI evidence tests", "must_pass": true }
  ],
  "max_attempts": 3,
  "approval_reference": "HD-0015",
  "created_at": "2026-11-17T11:18:30Z",
  "created_by": "worker"
}
---

# OPS-0003 — Trusted CI verification and integration security

This file records the task that strengthens CI against a worker that edits the checks which judge its own work. It was transcribed by a worker session from the human's OPS-0003 instruction; the instruction, not this file, is the authority, and it is recorded as HD-0015. The scope was proposed beforehand in [OPS-0003-PROPOSAL.md](../roadmap/OPS-0003-PROPOSAL.md); the implementation deliberately differs from it in one respect (no second job), explained in [TRUSTED_CI.md](../architecture/TRUSTED_CI.md).

## Context

OPS-0002's workflow ran green on GitHub (run 43995081483, HD-0014). A green run, however, is produced with the branch's own workflow, validator, checker, policy and schemas, so a worker that changes them can make its own work pass. A second job in the same workflow does not fix that: a `pull_request` run uses the workflow file of the pull request's merge commit, and a required check is matched by name. The task therefore builds a measurement that can be run from somewhere the change cannot reach, labels it advisory, and keeps human approval for control-plane changes.

## What to do

1. Create a local branch `claude/ops-0003-trusted-ci` from the OPS-0002 branch, without the Reel commits.
2. Implement the trusted-base check as a tool (`ops/lib/trusted-base.mjs`): rules from the base revision, head read only as data, sanitised child process, strict path and size limits, symbolic links refused.
3. Implement the CI evidence document (`ops/lib/ci-evidence.mjs`, `ops/ci-evidence.mjs`, a strict schema registered in the validator) from GitHub's Actions and Checks data, with expectations from the base, and store the first live run as a fixture.
4. Write negative security tests on real throwaway git repositories, and run a mutation check of the security rules.
5. Document the architecture and the anchoring limitation, the evidence design, the exact GitHub settings and their interaction with Claude's workflow, the Reel commits, and the proposal for the next task. Update project memory to the verified reality.
6. Verify locally, and say plainly that nothing here has run on GitHub.
7. Commit locally on the task branch only. Write the run report as a separate final commit.

## Out of scope

See the front matter. In particular: no push, no pull request, no change to GitHub settings, no change to the workflow, no token or secret, no reviewer, and do not begin OPS-0004.

## How completion is shown

The five required checks with their exit codes, the two new test files and the mutation check, a simulated run of the workflow's command sequence in a clean checkout with no credentials, the same-path build comparison, and the preservation evidence, all recorded in the run report at `docs/project-memory/runs/OPS-0003/OPS-0003-a1/report.json`.
