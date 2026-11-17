# GitHub settings guide: branch rules for `main` and `claude-dev`

**Status: instructions only. Nothing here has been done, and the system may not do any of it** (changing repository settings is prohibited, PROHIB-008; HD-0015). The owner changes settings, in the GitHub web interface, after reviewing this guide. It extends [OPS-0002-ACTIVATION.md](OPS-0002-ACTIVATION.md) (section 2 there covers the Actions settings: fork approval, default token permission) and answers OQ-0034 part (3) and OQ-0036. The reasoning behind the trusted-base check is in [TRUSTED_CI.md](../architecture/TRUSTED_CI.md).

**Evidence tags:** **[D]** official GitHub documentation read on 2026-11-17 (menu labels change; match by meaning). **[O]** observed through read-only GitHub access in this session. **[T]** tested here. **[U]** cannot be observed from here: the owner must check it.

**Branch roles (permanent, REQ-OPS-011, HD-0018):** `claude/**` are isolated feature branches, `claude-dev` is the staging and integration-testing environment, `main` is production. Every website feature is tested on `claude-dev` before its production release, and only the owner's explicit approval authorizes a production merge or deployment. The rules below protect those roles; none of them is applied yet. The GitHub proxy used by browser sessions "doesn't limit which branches a push can update" (official documentation), so branch protection or rulesets are the only technical way to stop a session from writing to `claude-dev` or `main` (BROWSER_REVIEW.md).

## 1. What can be observed from here

| Item | Observation |
|---|---|
| Repository | Public, user-owned **[O]** |
| Collaborators | One: the owner, with the **admin** role **[O]** |
| Branch protection flag | `protected: false` on every branch (`main`, `claude-dev`, `claude/ops-0002-ci-baseline`, ...) **[O]**. Whether a ruleset exists is **[U]**: the read tools used here do not list rulesets |
| Code owners | No `CODEOWNERS` file in any of its three allowed locations **[O]** |
| Who the automation is to GitHub | The actor of the first live run, and of every push made from this environment, is the owner's own login **[O]** |
| Actions settings (default token permission, fork-PR approval, allowed actions), secrets, environments, the hosting project's settings | **[U]** |
| Whether a second identity can be connected to the Claude session | **[U]** |

Production is deployed from `main` by the hosting service **[O]** (earlier tasks). Pushing `main` is therefore a production release.

## 2. The point that decides everything: Claude acts as the owner

Every protection below is a rule about **identities**. Claude's pushes, and any pull request or merge it makes through the GitHub tools, are made as the owner **[O]**. So:

| Rule | Binds the owner's identity? | Therefore binds Claude today? |
|---|---|---|
| Block force pushes; restrict deletions | Yes, if the ruleset's bypass list is empty **[D]** | **Yes** |
| Require a pull request; require a passing status check | Yes, with an empty bypass list **[D]** | **Yes**: a direct push is refused. But Claude can still open a pull request, wait for the check and merge it |
| Require approvals (including code owners) | **A pull request's author cannot approve it** (long-standing GitHub behaviour; the documentation read for this task does not state it, so **[U]** until seen) | Claude's pull requests are the owner's, so the owner **cannot approve them either**. With the rule on, nothing merges unless the bypass list lets the owner through, and a bypass lets Claude through as well |
| Settings changes (rulesets, Actions, secrets) | Admin only | Claude has no tool for them (PROHIB-008), so this is a policy line, not a GitHub boundary |

So until a **second identity** exists, GitHub rules are **safety rails against mistakes and against direct pushes, not a barrier against the automation itself**. The barrier today is the instruction layer (CLAUDE.md, HD-0005: nothing is pushed or merged without explicit approval, and every such action is shown to the owner). That is honest and it works, but it is not enforced by GitHub. A real separation needs the automation to act as a different, lower-privileged identity, for example a second GitHub account (free) or a GitHub App, added with **Write** (not admin) access, so that the owner's account is the only approver and the only one who can change settings. Whether the Claude session can be connected under such an identity is unverified **[U]**; this is OQ-0036, an owner decision.

Two profiles follow. Apply **Profile 1** when the owner chooses to; move to **Profile 2** only after OQ-0036 is answered.

## 3. Prerequisites and order

1. OPS-0002 and OPS-0003 reviewed and merged into `claude-dev` by the owner (a merged OPS-0003 is what puts the check name, the evidence tool and this guide on the integration branch).
2. The CI workflow has already run green on the branch being protected. **[T]** The first run (run 43995081483) passed, job name `verify`, so the required check name is `verify`; GitHub documents that a check must have reported recently before it can be selected as a required check **[D]** ("must have recently submitted a check run"), so the first run is what makes `verify` selectable.
3. Settings are made in this order, and each is verified before the next: (a) the Actions settings of OPS-0002-ACTIVATION section 2; (b) the `claude-dev` ruleset; (c) `CODEOWNERS`; (d) the `main` ruleset last, because it is the one that can lock out a release.

## 4. Profile 1: one identity (the owner), available now

Use **Settings → Rules → Rulesets → New ruleset → New branch ruleset**. Rulesets are available for public repositories on the free plan **[D]**; classic branch protection also exists, but its administrator exemption is the default and it allows only one rule per branch, so rulesets are recommended. Leave **Bypass list** empty in all of them, so the rules bind the owner's identity too (a repository admin is exempt only if added to the bypass list **[D]**). If the owner ever needs an exception, the owner switches the ruleset's **Enforcement status** to Disabled in the web interface, acts, and switches it back; Claude cannot.

### 4.1 Ruleset `protect-main`

| Setting | Value | Why |
|---|---|---|
| Enforcement status | Active | |
| Target branches | Add target → Include by pattern → `main` | Production |
| Restrict deletions | On | A deleted production branch cannot be recovered by the hosting service |
| Block force pushes | On | History that a release report cites must stay reachable |
| Require a pull request before merging | On | No direct push to production |
| ↳ Required approvals | `0` now (see section 2: `1` would block every merge); `1` in Profile 2 | |
| ↳ Allowed merge methods | **Merge** only | Run reports and decisions cite commit ids. Squash and rebase create new ids, so a report would point at a commit that is not on `main` |
| ↳ Require conversation resolution before merging | On | |
| Require status checks to pass | On | |
| ↳ Status checks that are required | `verify` (source: GitHub Actions) | The job in `.github/workflows/ci.yml`. Expect two `verify` runs on a pull request, one for the `push` and one for the `pull_request` event; whether both must pass is **[U]** until observed on the first pull request |
| ↳ Require branches to be up to date before merging | On | The check must have run on the commit that will be merged |
| Require linear history, Require signed commits | Off | Not needed; the existing history is not linear and local commits are unsigned |

### 4.2 Ruleset `protect-claude-dev`

| Setting | Value | Why |
|---|---|---|
| Target branches | Include by pattern → `claude-dev` | The integration branch (ADR-0004) |
| Restrict deletions | On | |
| Block force pushes | On | |
| Require a pull request before merging | **Off in the first phase**; On when the worker flow of STG-6 exists | This environment's default instruction is to push `claude-dev` directly (section 6). Turning the rule on today ends that flow; it is correct only once workers push `claude/<task>` branches and merge through pull requests |
| Require status checks to pass | **Off in the first phase**; `verify` when the pull-request rule is on | A required check also forbids a direct push (the commit must already have passed) **[D]** |
| Allowed merge methods (when pull requests are on) | Merge only | As above |

`claude/**` worker branches get **no** ruleset: they are disposable, CI already runs on every push to them, and a rule would only get in the way of normal work.

### 4.3 Protecting the automation's own files

| Layer | Setting | Effect |
|---|---|---|
| **CODEOWNERS** | Create `.github/CODEOWNERS` (section 5). In both rulesets turn on **Require review from Code Owners** (Profile 2) | A change to a control-plane path needs the owner's approval. GitHub reads CODEOWNERS from the **base** branch of the pull request **[D]**, so a pull request cannot grant itself ownership |
| **Path restrictions** | A ruleset's "Restrict file paths" (push rules) would block any push that touches `.github/**`, `ops/**`, the policy and the schemas | Push rulesets are documented for **private and internal** repositories on the Team plan **[D]**. This repository is public, so they are **not available**. Do not rely on them |
| **The project's own deterministic check** | `npm run ops:validate` on every branch: path classes, workflow shape, policy floors, schemas | Already active in CI. It marks every control-plane change as class B (human approval before a run and before a merge) |
| **Trusted-base check** | `node ops/ci-evidence.mjs --base ... --head ...` | Advisory (ADR-0012). It measures whether a change altered the rules that judge it |

### 4.4 What Profile 1 achieves and does not

| Achieves | Does not achieve |
|---|---|
| No direct push to `main`; no force push or deletion of `main` or `claude-dev`; no merge into `main` with a red or missing `verify`; every release is visible as a pull request | Preventing Claude, acting as the owner, from opening and merging a pull request that passes `verify`. Approval is the owner's decision in the web interface and, today, Claude's own instructions |
| A reviewable pull request for every production change | Any binding of control-plane changes by GitHub; a pull request that weakens CI can still pass its own CI (TRUSTED_CI.md section 1) |

## 5. Profile 2: a separate automation identity (the real hardening; owner decision OQ-0036)

Prerequisite: the automation connects as a different identity with **Write** access only (the owner's account stays the only admin). Then, in addition to Profile 1:

| Setting | Value |
|---|---|
| `protect-main`: Required approvals | `1` |
| `protect-main`: Require review from Code Owners | On |
| `protect-main`: Dismiss stale pull request approvals when new commits are pushed | On |
| `protect-main`: Require approval of the most recent reviewable push | On (the person who pushed last cannot be the approver) |
| `protect-claude-dev`: pull request required, approvals `0` for class A tasks later (STG-7), `1` while the owner approves each merge | Per the autonomy decision (OQ-0025) |
| Bypass list | Still empty |

With that, the automation can push `claude/**` branches and open pull requests, CI runs, and **only the owner's approval** merges into `main`, whatever the pull request changes. The reviewer stage (STG-4) is advice to the owner; it does not replace the approval.

### Proposed `.github/CODEOWNERS` (not created; it is a control-plane file and would be a reviewed change)

```
# Everything that defines how changes are checked, approved or deployed is owned by the repository owner.
/.github/                       <owner-login>
/ops/                           <owner-login>
/docs/project-memory/policy/    <owner-login>
/docs/project-memory/schemas/   <owner-login>
/docs/project-memory/reviewer/  <owner-login>
/CLAUDE.md                      <owner-login>
/package.json                   <owner-login>
/package-lock.json              <owner-login>
/next.config.*                  <owner-login>
/vercel.json                    <owner-login>
/public/builds/                 <owner-login>
/public/logo.png                <owner-login>
```

Replace `<owner-login>` with `@` followed by the owner's GitHub login. The paths mirror the policy's control-plane and immutable rules (PATH-001 and the immutable list), so the two cannot drift silently: the validator already pins those paths with golden cases.

## 6. How the rules interact with Claude's branch-based development

| Today | Under Profile 1 | Under Profile 2 |
|---|---|---|
| A worker session pushes `claude/<task>`; CI runs on `push` | Unchanged | Unchanged |
| This environment's default instruction is to develop on `claude-dev` and push it directly | Still works while `protect-claude-dev` has no pull-request rule (section 4.2) | Replaced by: push `claude/<task>`, open a pull request into `claude-dev` |
| A worker never merges into `main` (HD-0005) | Now also refused by GitHub for direct pushes; a pull request can still be merged by the identity Claude uses, so the instruction layer stays the barrier | Enforced by approval |
| A release is a push of `main` by the owner, after approval (done once, `b180378`) | Becomes a pull request from `claude-dev` into `main` that must show a green `verify` | Same, with the owner's approval |
| CI triggers: `push` to `claude/**` and `claude-dev`; `pull_request` into `claude-dev` and `main` | Unchanged. The rule needs `verify` on the pull request's head commit, which both triggers produce | Unchanged |
| A change to `ci.yml` | Reviewed as class B | Needs the owner's code-owner approval; CI of the pull request runs the **pull request's** workflow, so the owner reviews the workflow file, not the check mark |

**Lock-out risks:** (1) renaming the job or workflow makes the required check unsatisfiable; the check-name stability test proposed in OPS-0003-PROPOSAL part D should be added when the rules are on. (2) A required check that never reports blocks merges; if the CI workflow is ever removed, the owner disables the ruleset first. (3) Required approvals under Profile 1 would block all merges (section 2).

## 7. The eight unpushed Reel commits

Facts **[O]**: the local `claude-dev` (187e045) is 8 commits ahead of `origin/claude-dev` (b7348bb), which is the base of every OPS branch. The commits change **60 files, all under `creative/motion-ad/`** (about 10,000 added lines, 573 KB of text; no video, audio, image or font file is among the changed paths). A further uncommitted change, a file-mode flip on `creative/motion-ad/scripts/deliver-v8.sh`, exists only in the main working tree. The OPS branches change **94 paths, none under `creative/`**: the two sets of changed paths are **disjoint [T]**, so the OPS work and the Reel work cannot conflict. `creative/**` is excluded from lint and from the type check by the project's own configuration, and `next build` does not read it, so pushing it is **not expected** to change CI results (**not tested**: configuration read, not run). The policy classes `creative/**` as `other` / class B / protected: a human approves changes to it (PATH-040).

What the rules change for them: with `protect-claude-dev` in the first phase nothing changes for a direct push of `claude-dev`; once a pull request is required there, the local `claude-dev` can no longer be pushed as it is. Options, for the owner (OQ-0019):

| Option | What it does | Notes |
|---|---|---|
| **R1 (recommended): keep local until OQ-0019 is decided; before any rule is enabled on `claude-dev`, preserve them** | Either `git bundle create` a backup file outside the repository, or push the 8 commits once to a new branch such as `claude/reel-1-v2` (an explicit, named, one-time approval, as for OPS-0002) | A pushed branch is public (OQ-0023). Review what the commits contain before choosing the push; no media file is in them, but the scripts and narration text are |
| R2: merge through a pull request | From `claude/reel-1-v2` into `claude-dev` after the OPS pull requests; class B, human approval; no path overlap, so no conflict | Do not rebase or squash the commits: their identities are recorded in earlier reports |
| R3: move the creative work to its own (private) repository | Keeps public exposure to the owner's choice and the site repository's history free of media tooling | An owner decision; a free private repository exists, but a second repository means a second set of rules |

None of this is done by OPS-0003: the Reel commits, the creative project and its file-mode change are untouched.

## 8. After the owner has changed settings: what to check

| Check | How |
|---|---|
| The rule is active and has an empty bypass list | Settings → Rules → Rulesets → the ruleset: Enforcement status Active, Bypass list empty |
| A direct push to `main` is refused | The owner tries pushing a throwaway commit to a throwaway branch named like the rule's pattern only if the rule has a test pattern; otherwise read the ruleset's "Rule Insights" after the first pull request. **Do not test by pushing to `main`** |
| `verify` is the required check and passes on the first pull request | The pull request's checks list |
| The system can read the result | The branch list's `protected` flag and the pull request's checks are readable with the same read-only access used here; the ruleset's own page is not **[U]** |
