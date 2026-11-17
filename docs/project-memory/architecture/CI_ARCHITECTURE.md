# CI architecture (OPS-0002)

**Status: implemented on the branch `claude/ops-0002-ci-baseline`, pushed once on the owner's explicit approval (HD-0014); its first GitHub run (run 43995081483, commit 0aba5e8, job `verify`) succeeded. The branch is not merged, so the workflow is not on `main` or `claude-dev`.** Authorised for local implementation (HD-0013) and for that one push (HD-0014). The decision record is [ADR-0011](adr/0011-ci-is-unprivileged-allow-listed-and-independent-of-any-model.md) (proposed). The design before implementation is [OPS-0002-PROPOSAL.md](../roadmap/OPS-0002-PROPOSAL.md); what activation needs is [OPS-0002-ACTIVATION.md](../roadmap/OPS-0002-ACTIVATION.md).

**Evidence tags:** **[D]** official GitHub documentation, read from the public `github/docs` source repository on 2026-11-17. **[A]** the action's own repository, read directly through git on 2026-11-17. **[T]** a test run in this environment. **[U]** not observable or not verified from here. Nothing marked [U] is claimed to work.

## 1. What was built

| File | Purpose |
|---|---|
| [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) | The baseline CI workflow |
| [`ops/lib/mini-yaml.mjs`](../../../ops/lib/mini-yaml.mjs) | A restricted YAML reader that rejects every construct it cannot interpret unambiguously |
| [`ops/lib/workflow-safety.mjs`](../../../ops/lib/workflow-safety.mjs) | The deterministic workflow-safety checker |
| `policy.json` `workflow_policy` + `policy.schema.json` | The approved shape of a workflow, as data a human owns (policy version 0.3.0) |
| [`ops/validate-memory.mjs`](../../../ops/validate-memory.mjs) | Runs the checker on every workflow file, enforces floors that the policy file alone cannot lower, and accepts `--file <workflow>` |
| `ops/tests/mini-yaml.test.mjs`, `ops/tests/workflow-safety.test.mjs` | Tests, including deliberately unsafe workflows that must be rejected |

No file under `src/`, `public/`, `creative/`, `package.json` or any build configuration changed.

## 2. The workflow

| Property | Value |
|---|---|
| Name / job | `CI` / `verify` (the check that a branch rule would require is the job name `verify`) |
| Starts on | `push` to `claude/**` and `claude-dev`; `pull_request` into `claude-dev` and `main`. Nothing else |
| Token permission | `contents: read`, set once at the top; no job sets permissions |
| Runner | GitHub-hosted `ubuntu-24.04`; timeout 15 minutes |
| Concurrency | One run per workflow and ref; a newer push cancels the older run |
| Steps | checkout; Node 22 setup; provider-credential guard; `npm ci --ignore-scripts --no-audit --no-fund`; `npm run lint`; `npx tsc --noEmit`; `npm run ops:validate`; `npm run ops:test`; `npm run build` |
| Not present | secrets, environments, deployments, artifacts, caches, services, containers, matrices, conditions, outputs, `pull_request_target`, `workflow_run`, manual or scheduled triggers |

Node 22 is the version used for every local check (22.23.4). The project declares only `node >= 18.18` in `engines`; this CI tests 22 only, and a floating `22` resolves to the newest 22.x at run time.

## 3. The two actions, and how their commit SHAs were verified

| Action | Release | Pinned commit | Runtime |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | node24 |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | node24 |

How each SHA was verified **[A]** (no SHA was taken from memory): the tag list was read from the action's own repository with `git ls-remote`; the newest release tags are the ones above (the previous major for both actions was v6, so the pins are the current majors); the repository was then cloned without file contents and the commit was confirmed to exist, to be the commit that both the release tag and the major tag point to, and to be contained in the repository's `main` branch; and the action's `action.yml` was read at that exact commit to confirm the `node24` runtime and the input defaults. This confirms the commit belongs to the official repositories and is a tagged release. It does not audit the action's code, and a pin does not protect against a compromise that already existed at that commit.

Two input defaults matter, and the workflow overrides both **[A]**:

- `actions/checkout` has `persist-credentials` default **true**, which leaves the workflow token in the local git configuration for the rest of the job. The workflow sets it to `false`.
- `actions/setup-node` has `package-manager-cache` default **true**: caching switches on by itself when the project's `package.json` names npm as its package manager (this project does not today). A dependency cache written by one run and restored by another is a classic way to carry something from an untrusted run into a later one, so the workflow sets it to `false`, and the policy refuses to approve the action without it.

## 4. Security decisions

| Requirement | How it is met | Evidence |
|---|---|---|
| Explicit minimum token permission | A top-level `permissions: contents: read`. Anything not listed is none. The checker requires exactly this block, rejects blanket values (`read-all`, `write-all`), extra scopes, and per-job permissions | Checker + tests. That unlisted scopes become none: **[D]** ("If you specify the access for any of these permissions, all of those that are not specified are set to `none`.") |
| Read-only repository access | `contents: read`; `persist-credentials: false`; no step pushes, tags or writes | Checker rejects any other command. Whether the repository's *default* token is read-only is an owner setting that is [U] (OQ-0034), but this workflow does not depend on it |
| No production environment access | No `environment`, no deployment, no deployment word anywhere in names or values | Checker (`WF-KEYS`, `WF-DEPLOY`) |
| No API secrets, no Claude token, no database credentials | No secret or token reference exists; the checker rejects `secrets.`, `github.token`, `GITHUB_TOKEN` and credential-looking names anywhere; no `env` block; no step input is open; the first command fails the job if a provider credential variable is defined | Checker (`WF-SECRETS`, `WF-KEYS`). That the repository holds no secrets at all is [U] |
| No write to protected branches | Read-only token, no stored credential, no push command, and `main` is never a push trigger | Checker (`WF-RUN`, `WF-TRIGGER`) + policy floor |
| No `pull_request_target` | Forbidden by policy, by the validator's floor, by the checker, and by a raw scan that does not depend on the parser | Four independent checks |
| No automatic deployment | See "No production environment access"; the workflow does not call any hosting service | Checker |
| No privileged execution from untrusted pull requests | Only `pull_request` and `push`. For a pull request from a fork **[D]**: "Workflows triggered from a forked repository using the `pull_request` event have read-only permissions and have no access to secrets." The risky triggers (`pull_request_target`, `workflow_run`) are the ones that give a write token and secrets to code from elsewhere, and they are forbidden | **[D]**; checker |

### Can an untrusted pull request obtain repository secrets?

What is established, and what is not:

- **From a fork:** no. **[D]** A `pull_request` workflow from a fork has a read-only token and no access to secrets, whatever the workflow file says. A pull request that edits the workflow file does not change that, because the restriction is applied by GitHub to the event, not by the file.
- **From a branch in this repository:** such a branch can only be pushed by someone with write access. For that case the protection is that **this workflow references no secret**, the checker enforces that on every run, and a change to the workflow is a control-plane change that needs human approval. This is a statement about the file.
- **Whether the repository holds any secrets** (for example a deployment secret used by another system) **cannot be observed from here [U]**. The workflow does not read any.

So: verified for the file and for the documented fork behaviour; not verifiable for the repository's settings.

## 5. Install and build scripts, honestly

`npm ci --ignore-scripts` stops *dependencies* from running install, preinstall and postinstall scripts. In this project **[T]**:

- The lockfile has 438 packages. Two declare an install script: `fsevents` (optional, macOS only, never installed on Linux) and `unrs-resolver` (a development dependency). The project's own `package.json` has no lifecycle script (`preinstall`, `install`, `postinstall`, `prepare`).
- Installing without scripts, then lint, type check and build all exit 0 on a clean checkout with no credential in the environment, so the pipeline does not need the skipped scripts.

That is **all** it establishes. It does **not** make the later steps safe, and the design does not rely on it:

| Step | What runs from the branch under test |
|---|---|
| `npm run lint` | The ESLint configuration and its plugins (JavaScript from the branch) |
| `npx tsc --noEmit` | The type checker; it reads project files, and does not run project code |
| `npm run ops:validate` / `ops:test` | `ops/*.mjs` from the branch, which include the checker itself |
| `npm run build` | `next.config.ts`, every module imported at build time, and the build loaders |

A pull request can therefore make CI execute arbitrary code. What makes that acceptable is the environment, not the install flag: an ephemeral GitHub-hosted runner; a read-only token; no credential left on disk; no secret, no cache and no environment; a 15-minute timeout; and, as an owner setting (OQ-0034), approval before a workflow from an outside contributor runs. The residual risks that remain after all of that are the ones any unprivileged build has: the code can use the runner's network and compute (limited by the timeout, by cancelling superseded runs, and by the approval setting), and a pull request can change `package-lock.json` to fetch different packages, which is code under test, not a privilege.

## 6. What the checker enforces

The checker enforces one approved shape taken from `policy.workflow_policy` and rejects everything else. It does not try to recognise "bad" workflows, because a deny-list cannot cover what nobody thought of.

| Code | Rejects |
|---|---|
| `WF-SYNTAX` | Any YAML the restricted reader cannot interpret unambiguously (anchors, aliases, tags, flow mappings, duplicate keys, tabs, extra documents, multi-line scalars, ...) |
| `WF-FILE-UNAPPROVED`, `WF-FILE-MISSING`, `WF-LOCAL-ACTION` | A workflow file not listed in the policy (a new workflow is a policy change), a missing required one, a `.github/actions` directory |
| `WF-TRIGGER` | Any event other than `push` and `pull_request`; forbidden events by name with the reason; any filter other than `branches`; branch lists that differ from the policy |
| `WF-PERMISSIONS` | A missing block, blanket values, any scope other than `contents: read` |
| `WF-RUNNER`, `WF-TIMEOUT`, `WF-CONCURRENCY`, `WF-JOBS` | Self-hosted or unlisted runners, a missing or excessive timeout, missing or non-cancelling concurrency, more than one job |
| `WF-KEYS` | Any key outside the approved shape; dangerous ones (environment, env, if, continue-on-error, needs, strategy, container, services, per-job permissions) with the reason |
| `WF-ACTIONS` | Local and container actions, unapproved actions, tags, branches, short or different SHAs, a missing version comment, extra or missing or different inputs (so no `token`, `cache` or `ref` input) |
| `WF-RUN`, `WF-REQUIRED`, `WF-ORDER`, `WF-STEPS` | Any command not in the policy list, multi-line scripts, repeats, missing required commands, wrong order |
| `WF-EXPRESSION` | The `${{ }}` syntax anywhere except the concurrency group, and there only for `github.workflow` and `github.ref` |
| `WF-SECRETS`, `WF-DEPLOY` | Credential, token, provider and secret-store names, and deployment, release, publish and production words, in any key or value |
| `WF-RAW` | A dangerous token outside comments that the structured checks did not already report (an independent last line of defence) |

The validator also enforces floors that editing `policy.json` alone cannot lower: `pull_request_target`, `workflow_run`, `workflow_dispatch` and `schedule` stay forbidden; push filters cannot cover the production branch or every branch; no self-hosted runner; the five verification commands and the credential guard stay required; checkout keeps `persist-credentials: false` and Node setup keeps its cache off; no approved input may look like a credential; the policy's approval must be an existing human decision (`POLICY-INVARIANT`, `WF-POLICY`). Lowering a floor needs a change to the validator, which is a control-plane file.

## 7. Test coverage

At the time of writing: 42 tests for the restricted reader (what it reads, and 28 constructs it must reject), 126 tests for the checker (the real workflow is accepted; unsafe variants are rejected in the categories triggers, permissions, secrets, deployment, actions, commands, expressions, runner and structure, syntax evasion, file-level checks, and policy floors), and the existing suites; 353 tests in all (OPS-0001B had 185). Every mutation helper asserts that the text it changes exists exactly once, so a test cannot pass because its change did nothing. The run report records the exact results, including a mutation check that disabling each rule makes tests fail. A second reader (PyYAML) was run once against the real workflow and produced the same structure as the restricted reader; that cross-check is recorded in the run report and is not part of the test suite, because the suite has no dependency on another language.

## 8. Local validation is not a GitHub Actions run

| Local checks establish | They do not establish |
|---|---|
| The commands in the workflow, run in the same order in a clean copy of the tree with no credential and `CI=true`, all exit 0 | That GitHub accepts the workflow file at all (no push has happened and no workflow linter such as actionlint is available in this environment) |
| The file matches the approved shape, and the shape forbids the dangerous constructs | How GitHub's own YAML reader treats the file (reduced by the restricted subset and the PyYAML cross-check, not eliminated) |
| The two action SHAs exist in the official repositories and run on node24 | That the actions run on the hosted runner image, or that `ubuntu-24.04` is still offered when the first run happens [U] |
| Nothing in the file references a secret | That the repository has no secrets, or that the owner's settings are as recommended |

**Update (2026-11-17):** the first real run has happened (HD-0014): run 43995081483 on commit 0aba5e8, job `verify`, success. All nine expected steps concluded success; the job log shows the token had `contents: read` and `metadata: read` only, `OK: checked 93 file(s); 0 warning(s).`, 353 of 353 tests, and 56 static pages generated. That confirms GitHub accepts the workflow and that the hosted runner executes it. It does not change the two rows of the table above that are about settings and about secrets the repository may hold, which stay [U].

## 9. Limits and remaining blockers

- **A pull request runs its own copy of the checker.** A green CI result is therefore not evidence about changes to `.github/**`, `ops/**`, the policy or the schemas (REC-OPS-021). Those stay control-plane paths with human review. OPS-0003 added a tool that measures such a change against the base revision's rules ([TRUSTED_CI.md](TRUSTED_CI.md)); it is advisory, because a second job in this same workflow would not be an independent boundary.
- **Activation needs an owner decision to push (OQ-0028) and owner settings (OQ-0034).** Nothing in this task changes either.
- **Pinned actions age.** Nothing updates them automatically; a later task can add a reviewed update process.
- **`ubuntu-24.04` and Node 22 are pinned labels** that GitHub and the Node project will eventually retire; the checker and the policy make a change a reviewed decision.
- **`npm run build` is the slowest step (about 30 s here)** and runs for every push to a `claude/**` branch; the cost is free minutes on a public repository **[D]** but would count against a plan if the repository became private (OQ-0023).
- The repository's hosting service may also start its own preview build for a pushed branch. That is separate from this workflow and is described in [OPS-0002-ACTIVATION.md](../roadmap/OPS-0002-ACTIVATION.md).
- A pre-existing, unrelated notice: the installed ESLint version prints a deprecation warning during install. It does not affect any check and was not changed.
