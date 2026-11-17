---json
{
  "schema_version": "1",
  "task_id": "OPS-0002",
  "title": "Secure GitHub Actions CI foundation",
  "objective": "Add the baseline GitHub Actions CI workflow and a deterministic workflow-safety checker, so that every branch can be verified by an unprivileged, read-only pipeline before any automated reviewer or worker is connected. Implement locally only: nothing is pushed, merged, activated or changed in GitHub settings.",
  "depends_on": ["OPS-0001"],
  "blocked_by_open_questions": [],
  "requirement_refs": ["REQ-PRES-001", "REQ-OPS-001", "REQ-OPS-003", "REQ-OPS-007", "REQ-OPS-008", "REQ-OPS-010"],
  "declared_risk_class": "B",
  "declared_risk_categories": ["ci_workflows", "ops_control_plane", "policy_or_schema", "tests_only", "docs_only"],
  "base_branch": "claude-dev",
  "branch": "claude/ops-0002-ci-baseline",
  "files_allowed": [
    ".github/workflows/ci.yml",
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
    "Changing GitHub account or repository settings (the owner does that: OQ-0034)",
    "Any secret, token, API key, environment or paid service; any Claude or other model session in CI",
    "Any change to the production website source, assets or build configuration",
    "Touching the eight unpushed Reel commits or the creative project",
    "Beginning OPS-0003 (the machine-readable CI result and the trusted-base check)"
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "The workflow exists and the deterministic checker accepts it against policy.workflow_policy.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file .github/workflows/ci.yml"
    },
    {
      "id": "AC-2",
      "statement": "The checker rejects deliberately unsafe workflows (forbidden triggers, write permissions, secrets, deployment, unpinned or unapproved actions, missing commands) and the restricted YAML reader rejects ambiguous constructs.",
      "verification_method": "command",
      "command": "node --test ops/tests/workflow-safety.test.mjs ops/tests/mini-yaml.test.mjs"
    },
    {
      "id": "AC-3",
      "statement": "Lint, type check, the production build, the project-memory validation (which now includes the workflow check) and every automated test pass, in a checkout that installed dependencies with npm ci --ignore-scripts and had no credential in its environment.",
      "verification_method": "command",
      "command": "npm ci --ignore-scripts --no-audit --no-fund && npm run lint && npx tsc --noEmit && npm run ops:validate && npm run ops:test && npm run build"
    },
    {
      "id": "AC-4",
      "statement": "Nothing under src/ or public/ differs from the base, and the build output at the same path is identical to the baseline after removing per-build randomness.",
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
      "statement": "What activation needs (branches, pull request, GitHub settings, protection rules, plan availability, preview-build effects) is documented, and local validation is clearly distinguished from a real GitHub Actions run.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-7",
      "statement": "A run report for this attempt exists and validates against the run-report schema.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file docs/project-memory/runs/OPS-0002/OPS-0002-a1/report.json"
    }
  ],
  "required_checks": [
    { "id": "lint", "command": "npm run lint", "description": "ESLint over the repository", "must_pass": true },
    { "id": "typecheck", "command": "npx tsc --noEmit", "description": "TypeScript type check", "must_pass": true },
    { "id": "build", "command": "npm run build", "description": "Production build of the website", "must_pass": true },
    { "id": "ops-validate", "command": "npm run ops:validate", "description": "Offline project-memory and workflow validation", "must_pass": true },
    { "id": "ops-test", "command": "npm run ops:test", "description": "Validator, checker and parser tests", "must_pass": true }
  ],
  "max_attempts": 3,
  "approval_reference": "HD-0013",
  "created_at": "2026-11-17T00:48:57Z",
  "created_by": "worker"
}
---

# OPS-0002 — Secure GitHub Actions CI foundation

This file records the task that adds the baseline CI. It was transcribed by a worker session from the human's OPS-0002 instruction; the instruction, not this file, is the authority, and it is recorded as HD-0013. The design was proposed beforehand in [OPS-0002-PROPOSAL.md](../roadmap/OPS-0002-PROPOSAL.md).

## Context

Before any automated reviewer or worker is connected, the repository needs an independent check that a branch builds, passes lint and type checks, and keeps the project memory valid, so that "tests passed" is evidence computed by GitHub and not a claim by a worker (REQ-OPS-010). Because the repository is public, that check runs code from branches that anyone may be able to propose, so it must be unprivileged: read-only token, no secrets, no deployment.

## What to do

1. Create a local branch `claude/ops-0002-ci-baseline` from the OPS-0001B branch, without the Reel commits.
2. Add `policy.workflow_policy` and its schema: the approved triggers, permissions, runner, actions (each pinned to a verified full commit SHA), inputs and commands.
3. Add `ops/lib/mini-yaml.mjs` (a restricted YAML reader that rejects ambiguous constructs) and `ops/lib/workflow-safety.mjs` (the deterministic checker), and run the checker inside `npm run ops:validate`.
4. Write `.github/workflows/ci.yml` and tests that introduce unsafe configurations and expect rejection.
5. Verify locally, and say plainly that a local check is not a GitHub Actions run.
6. Document the architecture, the security decisions, what activation needs, the remaining blockers, and the recommended OPS-0003 scope.
7. Commit locally on the task branch only. Write the run report as a separate final commit.

## Out of scope

See the front matter. In particular: no push, no pull request, no change to GitHub settings, no secret, and do not begin OPS-0003.

## How completion is shown

The five required checks with their exit codes, the workflow-safety and parser tests, a simulated run of the exact workflow command sequence in a clean checkout with no credentials, the same-path build comparison, and the preservation evidence, all recorded in the run report at `docs/project-memory/runs/OPS-0002/OPS-0002-a1/report.json`.
