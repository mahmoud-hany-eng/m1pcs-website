---json
{
  "schema_version": "1",
  "task_id": "OPS-0001",
  "title": "Shared project memory and development contracts",
  "objective": "Create the foundational shared project memory, the Claude worker protocol, strict validation contracts, the deterministic policy and an offline validator for the M1 autonomous development system, without implementing orchestration workflows or connecting any external service.",
  "depends_on": [],
  "blocked_by_open_questions": [],
  "requirement_refs": ["REQ-PRES-001", "REQ-PRES-002", "REQ-OPS-001", "REQ-OPS-003", "REQ-OPS-004", "REQ-OPS-007"],
  "declared_risk_class": "B",
  "declared_risk_categories": ["ops_control_plane", "policy_or_schema", "docs_only", "tests_only", "dependencies"],
  "base_branch": "claude-dev",
  "branch": "claude/ops-0001-foundation",
  "files_allowed": [
    "CLAUDE.md",
    "ops/**",
    "docs/project-memory/policy/**",
    "docs/project-memory/schemas/**",
    "docs/project-memory/architect/**",
    "docs/project-memory/reviewer/**",
    "docs/project-memory/README.md",
    "docs/project-memory/requirements/**",
    "docs/project-memory/architecture/**",
    "docs/project-memory/roadmap/**",
    "docs/project-memory/decisions/**",
    "docs/project-memory/tasks/**",
    "docs/project-memory/runs/**",
    "package.json"
  ],
  "files_forbidden": [
    "src/**",
    "public/**",
    "creative/**",
    ".github/**",
    "next.config.ts",
    "tsconfig.json",
    "package-lock.json",
    "vercel.json",
    ".env*"
  ],
  "out_of_scope": [
    "GitHub Actions workflows or any orchestration code",
    "Calls to any external AI service or launching Claude sessions",
    "Creating API keys, secrets, environments or paid resources",
    "Any change to the production website source or assets",
    "Touching the eight unpushed Reel commits or the creative project",
    "Pushing, merging, opening a pull request or deploying",
    "Starting OPS-0002"
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "Every required project-memory file exists and the offline validator exits 0 on the repository.",
      "verification_method": "command",
      "command": "npm run ops:validate"
    },
    {
      "id": "AC-2",
      "statement": "The validator accepts the valid fixtures and rejects every invalid fixture and every mutation test with a readable message.",
      "verification_method": "command",
      "command": "npm run ops:test"
    },
    {
      "id": "AC-3",
      "statement": "policy.json defines risk classes A, B and C, protected paths, manual approval requirements, attempt, daily and concurrency limits, budget placeholders, a fail-closed kill switch and prohibited production operations, and classifies the golden paths correctly.",
      "verification_method": "command",
      "command": "npm run ops:validate"
    },
    {
      "id": "AC-4",
      "statement": "CLAUDE.md contains every section required by policy.memory_contract.claude_md_required_headings.",
      "verification_method": "command",
      "command": "npm run ops:validate"
    },
    {
      "id": "AC-5",
      "statement": "The confirmed requirements and loyalty rules are recorded exactly, recommendations and open questions are kept separate, and no redemption, account-linking or financial rule is invented.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-6",
      "statement": "Lint, type checking and the production build pass, and nothing under src/ or public/ differs from the base.",
      "verification_method": "command",
      "command": "npm run lint && npx tsc --noEmit && npm run build"
    },
    {
      "id": "AC-7",
      "statement": "The work is committed only on the task branch, nothing is pushed, and the unpushed Reel commits, the creative project and its file-mode change are untouched.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-8",
      "statement": "A run report for this attempt exists and validates against the run-report schema.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file docs/project-memory/runs/OPS-0001/OPS-0001-a1/report.json"
    }
  ],
  "required_checks": [
    { "id": "lint", "command": "npm run lint", "description": "ESLint over the repository", "must_pass": true },
    { "id": "typecheck", "command": "npx tsc --noEmit", "description": "TypeScript type check", "must_pass": true },
    { "id": "build", "command": "npm run build", "description": "Production build of the website", "must_pass": true },
    { "id": "ops-validate", "command": "npm run ops:validate", "description": "Offline project-memory validation", "must_pass": true },
    { "id": "ops-test", "command": "npm run ops:test", "description": "Validator tests and fixtures", "must_pass": true }
  ],
  "max_attempts": 3,
  "approval_reference": "HD-0004",
  "created_at": "2026-11-16T23:35:00Z",
  "created_by": "worker"
}
---

# OPS-0001 — Shared project memory and development contracts

This file records the task that created the project memory. It was transcribed by a worker session from the human's OPS-0001 instruction; the instruction, not this file, is the authority, and it is recorded as HD-0004.

## Context

The Phase 0 audits proposed an autonomous development system in which tasks are proposed and approved, Claude workers implement them, and a separate reviewer checks the evidence. Before any orchestration exists, the system needs shared memory, written protocols, strict contracts and a deterministic policy that do not depend on remembering old conversations (REQ-OPS-004). The repository is public (REQ-OPS-007), so nothing sensitive may be recorded.

## What to do

1. Create the project-memory structure under `docs/project-memory/`: README, master requirements, architecture and ADRs, roadmap, human decisions, open questions, a task template, the reviewer prompt, the policy and the schemas.
2. Record only confirmed requirements as requirements. Keep recommendations and unresolved questions separate. Use stable ids.
3. Write the worker protocol in the root `CLAUDE.md` and the reviewer's duties in `REVIEWER_PROMPT.md` (called `ARCHITECT_PROMPT.md` in attempt 1, renamed in attempt 2). The reviewer has no authority over deterministic rules.
4. Write strict, provider-neutral schemas for tasks, worker run reports and reviewer decisions (and one for the policy), consistent with each other.
5. Write `policy.json`: risk classes A, B and C, protected paths, approvals, limits, budget placeholders, a kill switch and prohibited production operations. Classes are computed by trusted logic, never by a model's own classification.
6. Write the offline validator `ops/validate-memory.mjs` with Node built-ins only, with tests and fixtures that show valid and invalid cases.
7. Run lint, type checking, the production build and the new tests; fix failures that this task caused.
8. Commit on the task branch only. Write the run report as a separate final commit.

## Out of scope

See the front matter. In particular: no workflows, no external APIs, no credentials, no website changes, no push, and do not begin OPS-0002.

## How completion is shown

The five required checks, with their exit codes, recorded in the run report at `docs/project-memory/runs/OPS-0001/OPS-0001-a1/report.json`, plus the baseline results of lint, type checking and build before any change.

## Revision history

- **Attempt 1** (HD-0004): created the project memory, the schemas, the policy and the validator.
- **Attempt 2** (the owner calls it OPS-0001B; HD-0011): a revision on the same branch, as the contract provides for. It records the owner's decision that automation uses only the existing Claude subscription (HD-0010), removes the external-provider reviewer design from the active architecture, keeps the contracts provider-neutral, assesses the Claude-only reviewer's feasibility from official documentation, narrows the open questions that blocked OPS-0002, and proposes OPS-0002 without starting it. The run report is `docs/project-memory/runs/OPS-0001/OPS-0001-a2/report.json`.
