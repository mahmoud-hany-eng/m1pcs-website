# OPS-0002 proposal: baseline CI with read-only permissions

**Status: implemented locally; not active.** This proposal was approved for local implementation only (HD-0013) and is now the task [OPS-0002-ci-baseline.md](../tasks/OPS-0002-ci-baseline.md). Where the implementation differs from the design below, the implementation and [CI_ARCHITECTURE.md](../architecture/CI_ARCHITECTURE.md) win: the safety check reads the workflow with a restricted YAML reader and enforces an allow-list from `policy.workflow_policy` instead of line-based text checks, the runner label is pinned (`ubuntu-24.04`), the actions are pinned to the SHAs verified for this task, and setup-node's automatic caching is switched off explicitly. Nothing is pushed. It would be the first part of stage STG-3 on the [roadmap](ROADMAP.md).

- **Class:** B. It adds `.github/workflows/ci.yml`, a control-plane path, so a human approves before the run and before any merge.
- **Blocked by:** none of the open questions that were listed for it. OQ-0020 and OQ-0023 are not needed (a baseline CI workflow is correct whatever the answers). **Activation needs OQ-0028**, because a workflow exists on GitHub only after a branch containing it is pushed.
- **Constraints carried over:** no production change, no secrets, no privileged credentials, no automatic deployment, no paid service, nothing pushed without approval.

## 1. Purpose and non-goals

**Purpose.** Give every worker branch an automatic, trustworthy check that runs the same commands a human runs, so that "tests passed" is evidence computed by GitHub and not a claim by a worker.

**Non-goals (explicitly out of scope):**

- Any secret, environment, token or privileged workflow. No `pull_request_target`, no `workflow_run`, no scheduled or manual triggers.
- Any deployment, automatic merge, release or change to hosting. The existing preview builds that the hosting service starts on a pushed branch are untouched.
- Any Claude session in CI (that is stage STG-4), and any use of an API key.
- Any change to website source, public files or the existing build and lint configuration. `package.json` already has every script that is needed.
- Branch protection or required checks (a one-time owner setting, later).
- The machine-readable result artifact and the collector (OPS-0003).

## 2. Deliverables

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` (new) | The workflow described in section 3 |
| `ops/lib/workflow-safety.mjs` (new) | A zero-dependency, text-based safety check of every workflow file |
| `ops/tests/workflow-safety.test.mjs` (new) | Tests that the checks pass on the real workflow and fail on deliberately unsafe ones |
| `docs/project-memory/runs/OPS-0002/OPS-0002-a1/report.json` (new) | The run report |
| `docs/project-memory/roadmap/ROADMAP.md` (edit) | Status only |

## 3. Workflow design

```yaml
name: CI
on:
  push:
    branches: ["claude/**", "claude-dev"]
  pull_request:
    branches: ["claude-dev", "main"]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<full 40-character commit SHA>   # pinned; the version is written in a comment
        with:
          persist-credentials: false
      - uses: actions/setup-node@<full 40-character commit SHA> # pinned
        with:
          node-version: 22
      - name: Fail if an API key exists in this job
        run: test -z "${ANTHROPIC_API_KEY:-}"
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run ops:validate
      - run: npm run ops:test
      - run: npm run build
```

- **Read-only.** The workflow-level permission is `contents: read` and no job raises it. No secret is referenced.
- **External pull requests.** Only the `pull_request` trigger is used. For a pull request from a fork, GitHub runs it with a read-only token and no access to secrets; the owner also sets the repository to require approval before workflows from outside collaborators run (approval A3). The pull request's own code is installed and built, which is why the job has no secret, no write permission and no cache to poison. Install scripts are not run (`--ignore-scripts`). Checkout does not keep credentials (`persist-credentials: false`). No value from the event is ever interpolated into a shell command.
- **No billing risk.** The guard step fails the job if an API key is defined (REC-OPS-015). No Claude session runs here.
- **No deployment.** There is no environment, no deployment step and no permission that could deploy.

## 4. Safety checks that the tests enforce

On the real workflow the tests assert, and on deliberately broken copies they confirm failure of:

1. The only top-level permission is `contents: read`, and no job sets `permissions`.
2. No `secrets.` reference, no `environment:`, no `id-token` permission.
3. Triggers are exactly `push` and `pull_request`, with the branch filters above. Never `pull_request_target`, `workflow_run`, `workflow_dispatch`, `schedule` or comment triggers.
4. Every `uses:` is pinned to a full 40-character SHA.
5. Checkout sets `persist-credentials: false`.
6. No `${{ github.event`, `github.head_ref` or `github.ref_name` expression inside a `run:` step.
7. `timeout-minutes` is set, there is no `continue-on-error`, and there is no `actions/cache` or `actions/upload-artifact`.
8. The API-key guard exists and no workflow passes an API-key input to any step.

These are line-based text checks, because the project has no YAML parser and adds no dependency. They are strict about the shapes the workflow uses, and the tests include unsafe examples that must be caught.

## 5. Acceptance criteria

1. The workflow exists and the safety tests pass.
2. The exact step sequence passes in a pristine checkout, including install without scripts.
3. `npm run ops:test` includes the new tests and all pass. `ops:validate`, lint, type check and build pass.
4. Only the files in section 2 are changed. Nothing under `src/` or `public/` changes, and the build output at the same path is identical to the baseline.
5. After an approved push (A2): the first run on that branch is green and the run log shows a read-only token.
6. Optional, with a separate approval: a deliberately failing branch shows red.

## 6. Tests

- **Local, before any push:** run the whole sequence in a throwaway pristine checkout; run the safety tests and their mutation cases; compare the production build at the same path.
- **Remote, only after A2:** the first run; the optional red demonstration.
- **Checked while preparing this proposal:** the install-without-scripts sequence (install, lint, type check, build) was run on a pristine checkout of `origin/claude-dev` with no API key and no token in the environment: see section 8.

## 7. Risks

| Risk | Mitigation |
|---|---|
| An outside pull request runs install and build code | No secret, read-only token, no scripts at install, no cache, approval required for outside collaborators (A3) |
| Abuse of free Actions minutes by outside pull requests | The same approval; minutes are free for a public repository |
| A worker edits the workflow to weaken it | `.github/**` is control-plane: it cannot be changed without a human approval, and the safety tests run in the same CI |
| The workflow runs from the pushed branch on the first push | The branch is reviewed by a human before the push (A2); only the owner pushes |
| Pinned SHAs become stale | Later: an automatic update mechanism (out of scope here) |
| A pushed branch also starts a hosting preview build | Existing behaviour, unchanged by this task (OQ-0029) |

## 8. Result of the preparatory test

The install-without-scripts sequence was run on a pristine checkout of `origin/claude-dev` with no API key, no GitHub token and `CI=true` in the environment (the run report of attempt 2 has the check `ci-sequence-no-scripts`):

| Step | Exit code | Seconds |
|---|---|---|
| `npm ci --ignore-scripts` | 0 | 15 |
| `npm run lint` | 0 | 3 |
| `npx tsc --noEmit` | 0 | 5 |
| `npm run build` | 0 | 27 |

So the site installs and builds without running any install script, which is what makes it reasonable to run an outside pull request's dependencies. This is a local test of the commands; it is not a run on GitHub Actions, which has not been tried.

## 9. Approvals needed, exactly

None of these has been given. Each is a decision by the owner.

**A1. Approve OPS-0002 to start.** Because the class is B and `.github/**` is control-plane, the owner approves before the run. Suggested wording: _"I approve OPS-0002 as described in docs/project-memory/roadmap/OPS-0002-PROPOSAL.md. Create the workflow and its tests locally on branch claude/ops-0002-ci-baseline. Do not push."_ It is recorded as a new human decision and referenced from the task record.

**A2. Authorise one push (OQ-0028, option A).** Suggested wording: _"After I have reviewed it, push claude/ops-0002-ci-baseline, only that branch, once."_ Consequences: the branch becomes public; the workflow runs once on it; the hosting service may start a preview build. It is the only way the workflow can become active. Without it, OPS-0002 stays a local branch.

**A3. Two one-time repository settings, done by the owner in GitHub (the system may not change repository settings, PROHIB-008):**
(a) Settings, Actions, General: require approval for workflows from outside collaborators (all outside collaborators);
(b) the default workflow token permission set to read-only.
Needed before relying on CI for outside pull requests, not for creating the workflow.

**A4. Approve the two GitHub-owned actions** (`actions/checkout` and `actions/setup-node`), pinned by commit SHA, and say how the SHAs are obtained: the owner supplies them, or authorises a read of those two repositories. This environment's GitHub access is limited to this repository, so it cannot look them up. Pinning by version tag is weaker and is not recommended.

**A5. A later, separate approval to merge into `claude-dev`.** Merging makes the workflow apply to every branch created from it. Merging into `main` is never part of OPS-0002 (a merge into the production branch is a production deployment).

## 10. Draft task record (not valid until approved; shown so it can be reviewed)

```json
{
  "schema_version": "1",
  "task_id": "OPS-0002",
  "title": "Baseline CI workflow with read-only permissions",
  "objective": "Add a read-only GitHub Actions workflow that runs lint, type check, memory validation, validator tests and the production build on worker and integration branches, with tests that enforce its safety properties.",
  "depends_on": ["OPS-0001"],
  "blocked_by_open_questions": [],
  "requirement_refs": ["REQ-OPS-001", "REQ-OPS-003", "REQ-OPS-006", "REQ-OPS-007", "REQ-OPS-008", "REQ-PRES-001"],
  "declared_risk_class": "B",
  "declared_risk_categories": ["ci_workflows", "ops_control_plane", "docs_only"],
  "base_branch": "claude-dev",
  "branch": "claude/ops-0002-ci-baseline",
  "files_allowed": [
    ".github/workflows/ci.yml",
    "ops/lib/workflow-safety.mjs",
    "ops/tests/workflow-safety.test.mjs",
    "docs/project-memory/runs/**",
    "docs/project-memory/roadmap/**"
  ],
  "files_forbidden": ["src/**", "public/**", "creative/**", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", ".env*"],
  "out_of_scope": [
    "Any secret, environment or privileged workflow",
    "Any deployment or automatic merge",
    "Any Claude session in CI",
    "Branch protection or required checks",
    "Pushing, merging or opening a pull request"
  ],
  "acceptance_criteria": [
    { "id": "AC-1", "statement": "The workflow passes every safety check and the checks fail on unsafe examples.", "verification_method": "command", "command": "npm run ops:test" },
    { "id": "AC-2", "statement": "The exact CI sequence passes in a pristine checkout.", "verification_method": "inspection", "command": null },
    { "id": "AC-3", "statement": "Nothing under src or public changes.", "verification_method": "inspection", "command": null }
  ],
  "required_checks": [
    { "id": "lint", "command": "npm run lint", "description": "ESLint over the repository", "must_pass": true },
    { "id": "typecheck", "command": "npx tsc --noEmit", "description": "TypeScript type check", "must_pass": true },
    { "id": "build", "command": "npm run build", "description": "Production build", "must_pass": true },
    { "id": "ops-validate", "command": "npm run ops:validate", "description": "Offline project-memory validation", "must_pass": true },
    { "id": "ops-test", "command": "npm run ops:test", "description": "Validator and workflow safety tests", "must_pass": true }
  ],
  "max_attempts": 3,
  "approval_reference": null,
  "created_at": "2026-11-17T00:00:00Z",
  "created_by": "worker"
}
```

`approval_reference` is null on purpose: it is set only when the owner records approval A1.
