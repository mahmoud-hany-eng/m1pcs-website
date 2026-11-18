# OPS-0002 activation: what turning the CI workflow on needs

**Status (updated 2026-11-17): the one push described in section 1 was authorised and made (HD-0014), and the workflow ran green on GitHub (run 43995081483, commit 0aba5e8).** The settings in sections 2 to 4 have **not** been changed by the system, which may not do so (PROHIB-008), and remain the owner's decision. The branch is not merged. Exact branch rules for `main` and `claude-dev` are in [GITHUB_SETTINGS_GUIDE.md](GITHUB_SETTINGS_GUIDE.md). The rest of this page is the original instructions, kept as written; where it says nothing has been pushed, that was true when it was written. Design and security decisions: [CI_ARCHITECTURE.md](../architecture/CI_ARCHITECTURE.md).

**Evidence tags:** **[D]** official GitHub documentation, read from the public `github/docs` source repository on 2026-11-17. **[T]** tested here. **[U]** cannot be observed from here: the owner must check it.

## 1. What a workflow needs to become active

A workflow runs only from a commit that GitHub has received. Today the file is on a local branch, so GitHub does not know about it. Activation is therefore, at minimum, **one push of one branch**, which is the decision recorded as OQ-0028 option A: _"After I have reviewed it, push claude/ops-0002-ci-baseline, only that branch, once."_

### Which branches must be pushed

| Branch | Needed? | Why |
|---|---|---|
| `claude/ops-0002-ci-baseline` | **Yes, and only this one** | Its commit contains `.github/workflows/ci.yml`. The `push` trigger watches `claude/**`, so pushing it starts the first run from the pushed commit **[D]** (for `push`, the run is at the tip commit pushed) |
| `claude/ops-0001-foundation` | Not separately | It is an ancestor of the OPS-0002 branch, so its commits travel with it (see below) |
| `claude-dev` | **No** | Not authorised. The local `claude-dev` carries eight unpushed Reel commits, which must not be published |
| `main` | **Never** | A merge into `main` deploys the production site (REQ-OPS-001) |

**What the push publishes.** Pushing a branch publishes every commit under it that the remote does not have. The branch is based on the OPS-0001B branch, so the push also publishes the nine OPS-0001 and OPS-0001B commits beneath the OPS-0002 commits (project memory, contracts, policy and tooling: no source, no assets, no Reel commits **[T]**: the Reel tip is not an ancestor of the branch). The repository is public, so all of it becomes world-readable. HD-0013 permits provisional use of the public repository for non-sensitive project files, and the content scan runs on every file; it is still a visible consequence of OQ-0028 option A.

### Is a pull request necessary?

- **No, for the first run.** A push to `claude/ops-0002-ci-baseline` starts CI by itself.
- **A pull request is needed only to** (a) show the check on a pull request and exercise the `pull_request` trigger, and (b) merge. For a `pull_request` run, `GITHUB_SHA` is the pull request's merge commit **[D]**, and the workflow definition comes from that commit (standard GitHub behaviour, not separately verified **[U]**), so the workflow in the pull request would be the one that runs even though the base branch does not have it yet. Opening a pull request is a separate approval; this task does not open one.
- **Merging into `claude-dev` is a separate, later approval** (class B, control-plane file). Merging is what makes the workflow apply to branches created afterwards. One consequence to decide at that time: the local `claude-dev` has eight Reel commits that the remote does not have, so once the remote `claude-dev` moves, the two diverge and the owner must choose how to combine them. Never merge into `main` for this.

## 2. GitHub settings the owner must set (OQ-0034)

None of these can be set by the system. Exact menu text may differ slightly from GitHub's current interface.

| # | Setting (Repository → Settings → Actions → General unless stated) | Recommended value | Why | Evidence |
|---|---|---|---|---|
| S1 | **Actions permissions** | Actions enabled. If the restriction options are offered: allow actions created by GitHub only | Both actions in the policy are GitHub-owned, and nothing else is needed | The policy and workflow need only `actions/checkout` and `actions/setup-node` **[T]**; the exact option names are [U] |
| S2 | **Approval for running fork pull request workflows from contributors** | **Require approval for all external contributors** | Without it, a first-time outside contributor's pull request starts a run with no approval. The documentation warns that the two "first-time contributor" options are satisfied by anyone who has had one innocuous change merged | **[D]**: the three options and the warning are in GitHub's documentation. Approvals not given within 30 days expire |
| S3 | **Workflow permissions** | **Read repository contents and packages permissions**; leave **Allow GitHub Actions to create and approve pull requests** unticked | This workflow sets its permission explicitly, so it does not depend on the default; a read-only default protects every future workflow | The setting exists **[D]**; the repository's current value is [U] |
| S4 | Optional policy: **Require actions to be pinned to a full-length commit SHA** | On, if offered for this repository | Enforces by GitHub what the checker enforces by file; the workflow already complies | The policy exists **[D]**; whether it is offered to a repository owned by a personal account is [U] |
| S5 | **Branch protection or a ruleset** (Settings → Branches, or Rules) on `claude-dev` and, separately, `main`: require a pull request, require the status check named **`verify`**, block force pushes and deletion | After the first green run (a required check can only be chosen once GitHub has seen it) | A red CI then blocks a merge; `main` is production, so protect it first | Availability: see section 3. GitHub advises that job names be unique across workflows when status checks are required **[D]**, and `verify` is |
| S6 | Optional: a **CODEOWNERS** file naming the owner for `.github/`, `ops/`, `docs/project-memory/policy/` and `docs/project-memory/schemas/`, plus a rule that requires code-owner review | Consider it | A pull request runs its own copy of the checker, so CI cannot vouch for changes to the control plane; a required review can | Reasoning in CI_ARCHITECTURE.md section 9 |

### Settings that are NOT needed and must not be created for this workflow

Secrets, variables, environments, deploy keys, tokens (including any Claude token), a self-hosted runner, a GitHub App, or a webhook. If any of them already exists, the workflow neither reads nor needs it.

## 3. Are these available on the current plan?

The plan and the type of account that owns the repository cannot be observed from here **[U]**; the owner confirms them in the repository's settings. What GitHub documents:

| Feature | Public repository | Private repository | Evidence |
|---|---|---|---|
| Actions minutes on standard GitHub-hosted runners | Free | Counted against the plan's allowance | **[D]** "Public repositories: This usage remains free" |
| Branch protection rules | Available on GitHub Free, for personal accounts and for organizations | Needs GitHub Pro, Team or Enterprise | **[D]** |
| Rulesets | Available on GitHub Free | Needs GitHub Pro, Team or Enterprise | **[D]** |
| "Branch restrictions" (limiting who may push) | Only for repositories owned by an organization | Only for organization-owned repositories on Team or Enterprise | **[D]** |
| Environments (not used here) | Available | Needs Pro, Team or Enterprise | **[D]** |
| Approval for fork pull request workflows, token default, Actions policies | Repository settings | Same | **[D]** that they exist; their exact availability for this repository is [U] |

So, while the repository stays public (OQ-0023), everything recommended above is documented as available on the free plan, with the single caveat that "restrict who can push" needs an organization-owned repository and is not needed here. If the repository ever becomes private, free branch protection and rulesets would be lost unless the plan changes.

## 4. Could any step start an existing Vercel preview deployment?

- **The workflow itself: no.** It has no deployment step, no environment, no hosting token, no call to any hosting service, and the checker rejects them **[T]**. A workflow run does not push anything.
- **The push that activates it: very likely yes, unrelated to the workflow.** The hosting service is connected to the repository through its own Git integration, which has built previews for pushed branches before (the integration branch "builds previews", ARCHITECTURE.md section 1; the question of filtering preview builds is open as OQ-0029). Whether it builds *every* branch, including `claude/ops-0002-ci-baseline`, depends on that service's settings, which cannot be observed from here **[U]**.
- **What such a preview would contain:** the same website. The branch changes nothing under `src/` or `public/` and no build configuration, and the same-path production build of the branch is byte-identical to the baseline after removing per-build randomness (the run report has the result **[T]**). It is a preview deployment only; the production site changes only on a merge into `main`, which this work never does.
- **Status checks:** if the hosting service reports its build as a check or commit status on the branch, it will appear next to the CI job. That is a different check from `verify`, and it should not be selected as a required check in S5.

## 5. After activation: what to check on the first run

1. The `verify` job passes. If the checkout or Node setup step fails, the pinned SHAs are the first suspects; a failure there says nothing about the project.
2. In the log of the first step ("Set up job"), the **GITHUB_TOKEN Permissions** section shows only `Contents: read` and `Metadata: read` **[U]**: this is expected GitHub behaviour but has not been observed for this workflow.
3. The guard step succeeds (no provider credential in the environment), and the install step prints no script execution.
4. Optional, with a separate approval: push a deliberately failing branch to confirm that red is red, and confirm that a fork pull request waits for approval (S2).

## 6. Undoing it

Deleting the remote branch stops further runs on that branch; disabling or deleting the workflow is done in the repository's Actions page by the owner. The workflow holds no secret and has written nothing, so there is nothing to revoke.
