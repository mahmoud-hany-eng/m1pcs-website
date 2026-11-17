# Trusted-base verification (OPS-0003)

**Status: implemented on a local branch (`claude/ops-0003-trusted-ci`); not pushed; not active; advisory only.** Authorised for local implementation only (HD-0015). The decision record is [ADR-0012](adr/0012-trusted-base-verification-is-advisory-until-anchored.md) (proposed). The result format is described in [CI_EVIDENCE.md](CI_EVIDENCE.md); the GitHub settings that would make the base revision itself trustworthy are in [GITHUB_SETTINGS_GUIDE.md](../roadmap/GITHUB_SETTINGS_GUIDE.md); the proposal this task answers is [OPS-0003-PROPOSAL.md](../roadmap/OPS-0003-PROPOSAL.md).

**Evidence tags:** **[D]** official GitHub documentation, read from the public `github/docs` source repository on 2026-11-17. **[O]** observed in this repository through read-only GitHub access. **[T]** a test run in this environment. **[U]** not observable or not verified from here. Nothing marked [U] is claimed to work.

## 1. The problem, stated precisely

A branch is checked by CI, and CI runs the branch's own copy of everything that defines the check: the workflow file, `ops/` (the validator and the workflow-safety checker), the policy, the schemas and the package scripts. An autonomous worker that edits those files can therefore make its own work pass. Two weakenings were built as tests to show that this is not hypothetical:

| Test (in `ops/tests/trusted-base.test.mjs`) | What the branch changes | What the branch's own validator says | What the base-anchored check says |
|---|---|---|---|
| "THE GAP" | The workflow's token permission to `contents: write`, the policy's matching limit, and the policy schema's `const` that guards it, all together | **Pass** (the rules and the thing they judge were weakened in step) | Fail: the base policy rejects the workflow (`WF-PERMISSIONS`) and the base schema rejects the policy (`POLICY-SCHEMA`) |
| "THE GAP, second form" | The checker's permission rule disabled, and the workflow's permission weakened | **Pass** (the branch's weakened checker accepts the branch's workflow) | Fail: the base checker rejects the workflow; `ops/` is also reported as changed control-plane code |

Both tests first run the branch's own validator on the branch and require it to pass; a test that did not show the gap would prove nothing.

## 2. What was built

| File | Purpose |
|---|---|
| [`ops/lib/trusted-base.mjs`](../../../ops/lib/trusted-base.mjs) | `trustedBaseCheck({ repoDir, base, head })`: judges the change `base..head` with the rules of `base` |
| [`ops/ci-evidence.mjs`](../../../ops/ci-evidence.mjs) | Command line that runs the check and, optionally, adds what GitHub reports about a CI run (see [CI_EVIDENCE.md](CI_EVIDENCE.md)) |
| [`ops/tests/trusted-base.test.mjs`](../../../ops/tests/trusted-base.test.mjs) | 27 tests on throwaway git repositories, most of them attacks |
| [`ops/tests/git-fixture.mjs`](../../../ops/tests/git-fixture.mjs) | The throwaway repository helper |

`.github/workflows/ci.yml` is **unchanged**. No second job was added, on purpose (section 4).

## 3. How the check works

```
            base revision B (established)                head revision H (proposed)
            ─────────────────────────────                ───────────────────────────
  rules ──▶ ops/, policy, schemas  (read as files)       never executed, never imported
  data  ──▶                                              CLAUDE.md, .github, project memory, ops, package.json (read as files)

  rootB = H's files, with B's policy and B's schemas      → "does H pass B's rules?"
  rootA = H's files incl. H's policy, with B's schemas    → "does H's policy still pass B's validator?"
  (a base file always wins over a head file at the same path; a file H deletes comes back; a file H only adds is kept)

  a child process imports ONLY B's ops/validate-memory.mjs and ops/lib/policy.mjs and runs both roots
  changed paths = merge-base(B, H)..H, classified by B's policy; task scope read from B's task file
```

1. **Revisions are resolved once, to commit ids**, after the names are validated (no leading `-`, no newline or NUL, at most 255 characters, `--end-of-options`, `^{commit}`), so a branch name cannot inject an option and a moving branch cannot change between steps.
2. **Trees are read with `git ls-tree -r -z` and `git cat-file`**, not `git archive`. **[T]** `git archive` honours `export-ignore` from the head's own `.gitattributes`, so a workflow hidden that way would be missing from the archive; a test shows the archive really omits the file and the check still finds it.
3. **Symbolic links and submodules inside the governed paths are refused**, in the base and in the head, not followed. Blobs are capped at 5 MB, the tree at 64 MB and 5000 files.
4. **The head is data.** Nothing from the head is imported, required or executed. A test plants a side effect in the head's validator and checker, proves that it runs when the head validates itself, and proves it does not run under the check.
5. **The child process has a sanitised environment**: only `PATH`, `LANG`, `LC_ALL`, `TZ`, `TMPDIR`; `HOME` is a temporary directory; no variable that looks like a credential, no `GIT_DIR`, no `GIT_ASKPASS`, no `SSH_AUTH_SOCK`; git hooks and `fsmonitor` are off; a 120-second timeout.
6. **Task scope comes from the base.** If a task id is given, the changed paths are judged against the task file as it is in the base. A head that widens its own task file gains nothing (tested).
7. **Everything the check writes goes to a temporary directory that is removed afterwards.** The repository is not touched (tested: status, refs and stash are identical before and after).

## 4. The limit that matters: a second job in the same workflow is not a security boundary

OPS-0003 was asked to analyse this explicitly. The conclusion is that **nothing built here is independent enforcement**, and the verdict says so (`enforcement: "advisory_only"`).

### 4.1 Why adding a second job to `ci.yml` would not help

| Fact | Evidence | Consequence |
|---|---|---|
| A workflow started by `pull_request` runs **the workflow file from the pull request's merge commit** | **[D]** (`GITHUB_SHA` for `pull_request` is the merge commit; the workflow file used is the one at that commit) | The pull request that is being judged controls the file that decides whether the check runs |
| A required status check is matched by **name** (and optionally by the app that reported it) | **[D]** rulesets and branch protection: "required status checks"; the expected source is an app, not a workflow | Every workflow in this repository reports through the same app (GitHub Actions). A job named `verify` in a rewritten workflow that only runs `true` satisfies a rule that requires `verify` |
| A job can be removed, renamed, conditioned (`if: false`), or have its steps replaced | the file is plain text in the pull request | A "trusted" second job can be deleted in the same commit that weakens the first one |
| Checking out the base inside a job gives the **rules** from the base, but the **steps that run them** are still the pull request's | follows from the above | The base-validator step can be skipped, or pointed at the head |

So a second job in the same file adds checking, not a boundary. This is also why the workflow-safety checker enforces **exactly one job** (`WF-JOBS`): the approved shape is not extended.

### 4.2 What would be an independent anchor

A boundary exists only where the thing that enforces the check cannot be changed by the change under review. Four candidates were examined:

| Anchor | Independent of the pull request? | Available here? | Cost or risk |
|---|---|---|---|
| **A workflow that runs from the default branch** (`workflow_run`, `pull_request_target`, `workflow_dispatch`, `schedule`) | Yes: **[D]** these events use the workflow file from the default branch, which a pull request cannot edit before it is merged | The default branch is `main`, the production branch **[O]**, so adding such a workflow is a human-approved production merge. `workflow_run` and `pull_request_target` also run with a privileged token. **[D]** GitHub documents a planned default policy that blocks `pull_request_target` in public repositories, so building on it is fragile. The workflow policy forbids all of them (policy floor) | Privileged triggers that read untrusted branches are the classic way to leak a token. Not recommended; a separate ADR and owner decision would be needed |
| **Organisation-level required workflows** (a ruleset that runs a workflow from another repository) | Yes, in principle | **[D]** only for organisation or enterprise accounts; the repository is user-owned **[O]** | Moving the repository to an organisation: an owner decision with its own cost question (OQ-0023) |
| **A required reviewer that is not the author** (branch rule: approvals, code owners) | Yes, if the approver's identity is different from the one that pushes | **[O]** the owner is the only collaborator and the automation acts as the owner. The rule can be set, but the same identity can both push and approve or bypass | A second identity is needed; see [GITHUB_SETTINGS_GUIDE.md](../roadmap/GITHUB_SETTINGS_GUIDE.md) |
| **Run the tool somewhere the pull request cannot reach**: the owner's machine, or the future reviewer session (REC-OPS-016: its workspace comes from the base branch and the branch reaches it only as data) | Yes, if the tool and the base are taken from an established revision | Yes: it is a plain command, with no network and no credential | It is only as good as whoever runs it, and the result is not signed (section 5) |

The fourth is what OPS-0003 prepares: a command that anyone holding an established copy of the repository can run, so that the reviewer stage (STG-4) can measure a change against the base **without trusting the branch**. It is not enforcement until a reviewer session or a protected workflow runs it every time.

### 4.3 What stays true until an anchor exists

- **Control-plane changes still need a human.** The policy already classes `.github/**`, `ops/**`, the policy, the schemas, `CLAUDE.md` and the reviewer prompt as control-plane (class B, human approval before a run and before a merge), and the check reports every such change in `control_plane_paths` and sets `human_review_required`. The check never lowers an approval; it can only add reasons.
- **A green CI run is not evidence about the CI definition.** If the change touches the workflow, `ops/`, the policy, the schemas, the package scripts or a build input, `ci_trust_basis` is `ci_definition_modified_from_base` and a human is required (tested).
- **The base must itself be established.** The check trusts the base revision completely. That is only reasonable if the base was reached by a reviewed merge, which is what the branch rules in the settings guide are for. If the base is a branch the worker can push to, the check measures against something the worker controls.

## 5. What the check does not do

| Limit | Why it matters | What covers it |
|---|---|---|
| It does not judge **what a changed checker does**. Changed `ops/` code is reported, not understood | A comment-only edit and a rule deletion look the same to a flag | Human review of every `ops/**` change |
| The base rules only know what the base validator knows. A weakening the base validator does not model passes | A rule that was never written cannot reject anything | Review of the base itself; the policy floors; new rules arrive by reviewed change |
| `BUILD_INPUTS` is a list of file names (package files, `next.config.*`, `tsconfig.json`, ESLint and PostCSS configuration and similar). Code imported by those files, or by `next build`, is not listed | `next build` runs arbitrary project code | The CI environment (nothing to steal, nothing to write); `src/**` is already a protected path under the policy |
| Whether a **dependency** changed is only seen through `package.json` scripts and the lockfile being in `BUILD_INPUTS` | A new package can run code at build time | CI has no secret; the lockfile change is flagged as a build input |
| The output is **unauthenticated tool output**. Anyone can write a file that looks like it | A file cannot prove where it came from | Run the tool yourself from the base; never accept an evidence file produced by the branch (stated in every document) |
| The `--anchor` option is a **claim** by the caller, recorded as such (`anchor_is_claim: true`) | It would be easy to type `protected_workflow` | It changes nothing in the verdict; a later stage that really is anchored may set it |
| It has not run on GitHub | Everything here was tested locally | The first run on GitHub needs a push, which is an owner decision (OQ-0028) |

## 6. Test coverage

27 tests in `trusted-base.test.mjs` and 34 in `ci-evidence.test.mjs` (61 in all) against real temporary git repositories. The attacks covered: the lockstep weakening and the weakened checker (above); a checker edit alone; a second and a hidden workflow (`export-ignore`); the package script `ops:validate` replaced by `true`, and npm hooks around CI scripts; website source, original photos, the logo and `.env` paths; `CLAUDE.md` and the reviewer prompt; planted code in the head's validator; symbolic links in the head and in the base; option injection, newlines, over-long and unknown revision names; unrelated histories; a base with no validation logic; a moved base; a head that widens its own task file; very large changes; leftovers in the repository and the temporary directory; determinism and schema conformance; credentials in the child environment; and the command line's exit codes.

**[T]** A mutation check was run in a scratch copy: 28 deliberate weakenings of the security rules in the two library files (for example "ignore the base policy", "skip the symlink refusal", "accept any check-run app", "read the task file from the head") were applied one at a time. The first run found four that no test noticed; tests were added; the final run killed all 28. The script is a scratch tool and is not part of the repository.

## 7. How to use it

```
# from an established copy of the repository (the base's own ops/ directory):
node ops/ci-evidence.mjs --repository <owner>/<name> --repo-dir . --base <base-rev> --head <head-rev> [--task OPS-0003]
```

Exit code `0` means no human review is required by the evidence; `3` means a human must review (the reasons are printed to standard error); `2` is bad usage or unreadable input; `1` is an internal error. A reviewer session would run this from its own trusted workspace and treat the JSON as one input among several.
