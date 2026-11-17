---json
{
  "schema_version": "1",
  "task_id": "OPS-0004",
  "title": "Review packet, deterministic decision gate and first manual-review preparation",
  "objective": "Build the minimum offline infrastructure for the first genuine developer-to-reviewer experiment: a review packet builder that binds everything a reviewer may read to one commit, one task and one attempt with the reviewer's instructions taken from a trusted baseline; a deterministic decision gate that judges a reviewer's structured decision and never approves anything; negative security tests and a mutation check; and a runbook for the first manual, subscription-only reviewer session. Implement locally only: nothing is pushed, merged, deployed or activated, no reviewer is run and no credential is created.",
  "depends_on": ["OPS-0003"],
  "blocked_by_open_questions": [],
  "requirement_refs": ["REQ-PRES-001", "REQ-OPS-001", "REQ-OPS-003", "REQ-OPS-007", "REQ-OPS-008", "REQ-OPS-009", "REQ-OPS-010"],
  "declared_risk_class": "B",
  "declared_risk_categories": ["ops_control_plane", "policy_or_schema", "tests_only", "docs_only"],
  "base_branch": "claude-dev",
  "branch": "claude/ops-0004-review-foundation",
  "files_allowed": [
    "ops/**",
    "docs/project-memory/policy/**",
    "docs/project-memory/schemas/**",
    "docs/project-memory/reviewer/**",
    "docs/project-memory/README.md",
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
    "Changing GitHub account or repository settings, creating secrets or tokens, or activating a paid service",
    "Running a reviewer, automatic or manual, and beginning OPS-0005",
    "The offline completion detector, the next-task generator, automatic dispatch and any orchestrator",
    "Any change to .github/workflows/ci.yml",
    "Any change to the production website source, assets or build configuration",
    "Touching the eight unpushed Reel commits or the creative project",
    "New business requirements or changes to confirmed M1 customer-platform requirements"
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "The review packet builder produces a deterministic, hash-bound packet whose reviewer instructions, task definition, policy, decision schema and cited requirements come from a trusted baseline commit (never the worker's branch); labels the worker's report and the diff text as claims; recomputes the CI result from GitHub's data; refuses oversized, credential-bearing or incomplete input; and its verifier notices tampering even when the hashes are recomputed.",
      "verification_method": "command",
      "command": "node --test ops/tests/review-packet.test.mjs"
    },
    {
      "id": "AC-2",
      "statement": "The decision gate returns one of REVIEW_VALID_HUMAN_APPROVAL_REQUIRED, REQUIRES_CORRECTIONS, REVIEW_REJECTED or REVIEW_INVALID; rejects forged bindings, the same worker and reviewer session, contradictory CI, downgraded risk classes and hostile proposed tasks; never lets a reviewer approval override a protected, control-plane, financial, authentication, security or production requirement; and always reports that a human is required and that nothing is merged, deployed, authorised or launched.",
      "verification_method": "command",
      "command": "node --test ops/tests/decision-gate.test.mjs"
    },
    {
      "id": "AC-3",
      "statement": "The tools process the real GitHub data of OPS-0003's run 44082419253 (stored as a fixture with a real-versus-synthetic table), and a packet for the real OPS-0003 change is built and verified from the final baseline commit.",
      "verification_method": "command",
      "command": "node --test ops/tests/real-evidence.test.mjs"
    },
    {
      "id": "AC-4",
      "statement": "A mutation check weakens each security rule of the packet builder, the gate and the text checks one at a time in a scratch copy and the tests notice every non-equivalent weakening.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-5",
      "statement": "A runbook describes how a person starts a completely separate, restricted Claude Code reviewer session on the existing subscription from a clean trusted baseline, with the exact launch message, and no reviewer is started by this task.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-6",
      "statement": "Lint, type check, the production build, the project-memory validation and every automated test pass, in a checkout that installed dependencies with npm ci --ignore-scripts and had no credential in its environment.",
      "verification_method": "command",
      "command": "npm ci --ignore-scripts --no-audit --no-fund && npm run lint && npx tsc --noEmit && npm run ops:validate && npm run ops:test && npm run build"
    },
    {
      "id": "AC-7",
      "statement": "Nothing under src/, public/, creative/, .github/, CLAUDE.md, package.json or any build configuration differs from the base branch.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-8",
      "statement": "The work is committed only on the task branch, nothing is pushed, the branch contains none of the eight Reel commits, and the main working tree, the Reel commits and the creative file-mode change are untouched.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-9",
      "statement": "Project memory records the successful live OPS-0003 run, no longer states that OPS-0003 never ran on GitHub, and states that OPS-0003 remains advisory, that the repository still lacks enforced human/worker identity separation, that the first reviewer test is manual and subscription-only, and that no automatic reviewer or dispatch is active; no business requirement is added or changed.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-10",
      "statement": "A run report for this attempt exists and validates against the run-report schema.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file docs/project-memory/runs/OPS-0004/OPS-0004-a1/report.json"
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
  "approval_reference": "HD-0017",
  "created_at": "2026-11-17T13:10:00Z",
  "created_by": "worker"
}
---

# OPS-0004 — Review packet, deterministic decision gate and first manual-review preparation

This file records the task that builds the minimum offline infrastructure for the first developer-to-reviewer experiment. It was transcribed by a worker session from the human's OPS-0004 instruction; the instruction, not this file, is the authority, and it is recorded as HD-0017. The original, larger proposal is [OPS-0004-PROPOSAL.md](../roadmap/OPS-0004-PROPOSAL.md); the owner authorised only a reduced scope.

## Context

OPS-0003's run on GitHub succeeded (run 44082419253, HD-0016) and the architecture lead accepted it as a completed phase, with its trusted-base check still advisory. The next step toward a Claude developer, verified CI, an independent Claude reviewer, a deterministic gate and a next task is a defined, tamper-evident input for the reviewer and a deterministic check of its output, both testable without a model, a token or a push. OPS-0004 is built on the unmerged OPS-0003 branch as a deliberate dependency exception (HD-0017); this is for implementation and testing only and approves neither integration nor deployment.

## What to do

1. Create a local branch `claude/ops-0004-review-foundation` from `claude/ops-0003-trusted-ci` (50a46ca) in a separate worktree, without the Reel commits.
2. Implement the review packet builder and verifier, with one new strict manifest schema.
3. Implement the deterministic decision gate on the existing decision schema and validator, adding only the `manual_session` runtime.
4. Write negative security tests and a mutation check; store the real data of run 44082419253 as a fixture and test the tools against it.
5. Write the runbook for the first manual review, update the reviewer prompt, and build the first real OPS-0003 packet from the final baseline commit. Do not start a reviewer.
6. Update project memory to the verified reality (HD-0016, HD-0017, OQ-0037, ADR-0013, roadmap, corrected statements).
7. Verify locally. Commit locally on the task branch only. Write the run report as a separate final commit.

## Out of scope

See the front matter. In particular: no push, no pull request, no change to GitHub settings, no token or credential, no reviewer run, and do not begin OPS-0005.

## How completion is shown

The five required checks with their exit codes, the three new test files and the mutation check, a simulated run of the workflow's command sequence in a clean checkout with no credentials, the preservation evidence, and the status of the real OPS-0003 packet, all recorded in the run report at `docs/project-memory/runs/OPS-0004/OPS-0004-a1/report.json`.
