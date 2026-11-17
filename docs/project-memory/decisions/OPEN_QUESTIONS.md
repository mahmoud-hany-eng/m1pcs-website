# Open questions

Unresolved business and technical decisions. **No task may assume an answer.** A task that depends on a question lists it in `blocked_by_open_questions` and must not run until a human resolves it.

Each entry has a status (`open` or `resolved`), what it blocks, the question, and where it came from. A `Recommendation` line is a suggestion for the human to accept or reject, never a decision. A resolved entry points to the human decision that resolved it.

Items 1 to 19 are the unresolved decisions from the Phase 0 platform report; 20 to 34 were added by the automation audit, OPS-0001 and OPS-0002; 35 and 36 by OPS-0003.

### OQ-0001 — Paid hosting plans for production
- **Status:** open
- **Blocks:** PH-9
- **Question:** Will the business pay for production-grade hosting and backend plans? The site's hosting terms may restrict the free tier to personal use, and a free backend tier may pause or lack backups. This conflicts with the earlier statement that only Claude is paid for.
- **Recommendation:** Develop on free tiers and decide before any customer data goes live.
- **Source:** Phase 0 platform report, decision 1; REQ-OPS-005.

### OQ-0002 — Customer login method
- **Status:** open
- **Blocks:** PH-3
- **Question:** Email one-time code or magic link, password, Google sign-in, or phone one-time code (which needs paid SMS)?
- **Recommendation:** Email one-time code with an optional password.
- **Source:** Phase 0 platform report, decision 2.

### OQ-0003 — Account-linking policy
- **Status:** open
- **Blocks:** PH-3, PH-6
- **Question:** How is a WhatsApp customer or a guest quote linked to an account? Claim code only, or also automatic linking on a verified matching email?
- **Recommendation:** Single-use claim code; never link on unverified identity.
- **Source:** Phase 0 platform report, decision 3.

### OQ-0004 — Arabic and right-to-left support
- **Status:** open
- **Blocks:** PH-3
- **Question:** Is Arabic and right-to-left layout required in the account area?
- **Source:** Phase 0 platform report, decision 4.

### OQ-0005 — Order stages and customer-visible wording
- **Status:** open
- **Blocks:** PH-5
- **Question:** What are the order stages, which are visible to customers, and what is the exact wording?
- **Source:** Phase 0 platform report, decision 5.

### OQ-0006 — Definition of "fulfilled"
- **Status:** open
- **Blocks:** PH-7
- **Question:** Does fulfilled mean delivered, handed over, or fully paid first? Loyalty awards depend on it (REQ-LOY-004).
- **Source:** Phase 0 platform report, decision 6.

### OQ-0007 — What spending earns points, and rounding
- **Status:** open
- **Blocks:** PH-7
- **Question:** Do delivery fees, discounts, redeemed points or deposits count towards the QAR 10 earning base? How are amounts rounded?
- **Recommendation:** Round down per order.
- **Source:** Phase 0 platform report, decision 7.

### OQ-0008 — Redemption rules
- **Status:** open
- **Blocks:** PH-7
- **Question:** Minimum and maximum redemption, a cap per order, whether points can pay a deposit, stacking with discounts, expiry, transferability.
- **Source:** Phase 0 platform report, decision 8.

### OQ-0009 — Returns, refunds and points
- **Status:** open
- **Blocks:** PH-7
- **Question:** The business has a return window. Are points awarded only after it ends, and what happens to points when an order is refunded?
- **Source:** Phase 0 platform report, decision 9.

### OQ-0010 — Negative loyalty balance
- **Status:** open
- **Blocks:** PH-7
- **Question:** May a customer's balance go negative after a reversal?
- **Source:** Phase 0 platform report, decision 10.

### OQ-0011 — Staff roles and permissions
- **Status:** open
- **Blocks:** PH-4
- **Question:** Which staff roles exist, who may see costs, and who may adjust points?
- **Source:** Phase 0 platform report, decision 11.

### OQ-0012 — Profit and financial rules
- **Status:** open
- **Blocks:** PH-8
- **Question:** Cash or accrual basis, how shipping and customs are allocated across items, exchange-rate treatment, payment fees, and tax treatment (to confirm with an accountant).
- **Source:** Phase 0 platform report, decision 12.

### OQ-0013 — Customer notification channel
- **Status:** open
- **Blocks:** PH-5
- **Question:** Manual WhatsApp links, email, or the paid WhatsApp Business API?
- **Recommendation:** Manual prefilled WhatsApp links, which cost nothing.
- **Source:** Phase 0 platform report, decision 13.

### OQ-0014 — Data retention, deletion and consent
- **Status:** open
- **Blocks:** PH-9
- **Question:** Retention periods, deletion requests and consent wording, including a review under Qatar's personal-data law.
- **Source:** Phase 0 platform report, decision 14.

### OQ-0015 — Importing historic customers and orders
- **Status:** open
- **Blocks:** PH-9
- **Question:** Should existing WhatsApp customers and past orders be imported, and in what format?
- **Source:** Phase 0 platform report, decision 15.

### OQ-0016 — Payment proof uploads
- **Status:** open
- **Blocks:** PH-5
- **Question:** Should customers upload payment proof such as transfer screenshots?
- **Source:** Phase 0 platform report, decision 16.

### OQ-0017 — Guest quote storage and retention
- **Status:** open
- **Blocks:** PH-6
- **Question:** Should guest quote requests be stored, and for how long?
- **Source:** Phase 0 platform report, decision 17.

### OQ-0018 — Location of the admin area
- **Status:** open
- **Blocks:** PH-4
- **Question:** A path inside the existing site, or a separate subdomain?
- **Source:** Phase 0 platform report, decision 18.

### OQ-0019 — Fate of creative/ and the unpushed Reel commits
- **Status:** open
- **Blocks:** STG-6
- **Question:** What happens to the creative/ video project and to the eight unpushed local Reel commits? The repository is public, so pushing them would publish them.
- **Progress:** OPS-0003 recorded the facts (see [GITHUB_SETTINGS_GUIDE.md](../roadmap/GITHUB_SETTINGS_GUIDE.md) section 7): the 8 commits change 60 files, all under creative/motion-ad/, about 10,000 added lines and 573 KB of text, with no video, audio, image or font file among the changed paths; the OPS branches change none of those paths, so the two sets cannot conflict; a file-mode change on one script is uncommitted in the main working tree only. Options for the owner: keep local and preserve them before any rule is enabled on claude-dev (a bundle file, or one named push to a separate branch); merge through a pull request later; or move the creative work to its own private repository. Nothing was done to them.
- **Source:** Phase 0 platform report, decision 19; HD-0008.

### OQ-0020 — Ratify the Phase 0 architecture with the owner's modifications
- **Status:** open
- **Blocks:** STG-4
- **Progress:** Partly answered. HD-0010 itemises the owner's modifications: the existing Claude subscription only, no paid AI service or API billing, routine low-risk tasks run automatically, and sensitive changes and production releases need a human. ADR-0009 and ADR-0010 record them. This no longer blocks OPS-0002, because a baseline CI workflow does not depend on any of these decisions.
- **Question:** Is HD-0010 the complete list of modifications to the Phase 0 architecture? If so, are ADR-0001 to ADR-0008 (as amended) ratified, so the policy can be marked active? If not, which further modifications apply?
- **Source:** HD-0002, HD-0010, HD-0012.

### OQ-0021 — OpenAI API spend, or a Claude-based reviewer
- **Status:** resolved
- **Resolution:** HD-0010
- **Blocks:** none
- **Outcome:** The owner chose the existing Claude subscription only. No OpenAI API integration, no separate Anthropic Console API billing and no additional paid AI service. The reviewer is a separate Claude session (ADR-0009, ADR-0010).
- **Question:** The OpenAI API is billed separately from a ChatGPT subscription. Accept a small prepaid balance with a hard monthly limit, or use a Claude-based reviewer that needs no new paid service?
- **Source:** Automation audit, human action 1; REQ-OPS-005.

### OQ-0022 — Claude plan allowance, extra usage and GitHub App installation
- **Status:** open
- **Blocks:** STG-4, STG-6
- **Question:** The owner must confirm four facts that this environment cannot observe: (1) the plan tier and its real usage limits, including any daily limit on cloud scheduled runs (published sources conflict); (2) that "extra usage" (metered overage, which is billed at API rates) is switched off on the account, so that hitting a limit stops work instead of charging; (3) that scheduled tasks and cloud sessions are enabled; (4) whether the Claude GitHub App is installed on this repository.
- **Source:** Automation audit, human action 2; HD-0010.

### OQ-0023 — Public repository or a private operations repository
- **Status:** open
- **Blocks:** STG-4
- **Progress:** The repository is public (HD-0007) and the system is built for that: the content policy, the secret scan and the privilege split all assume it. The working assumption is to stay public. It is not a decision, but it does not block OPS-0002, because the baseline CI workflow is correct on a public or a private repository. It starts to matter at STG-4, when review artifacts and run reports accumulate in the repository. HD-0013 records that the owner's side permits provisional use of the public repository for non-sensitive project files; that is not a decision to keep project memory here for good, so the question stays open for STG-4.
- **Question:** Keep project memory in this public repository (consequence: everything committed is world-readable, free rulesets and approval environments work), or move it to a private repository (consequence: those protections need a paid GitHub plan, and Actions minutes are limited)?
- **Recommendation:** Stay public, and keep sensitive material out of git entirely (HD-0007).
- **Source:** Automation audit, open question 4; HD-0007.

### OQ-0024 — Which OpenAI model to pin
- **Status:** resolved
- **Resolution:** HD-0010
- **Blocks:** none
- **Outcome:** Not applicable: no OpenAI model will be used.
- **Question:** Which model, chosen after reading the current pricing page? Published model names and prices conflict.
- **Source:** Automation audit, open question 5.

### OQ-0025 — Autonomy boundary
- **Status:** open
- **Blocks:** STG-7
- **Question:** Confirm that autonomous merging stops at the integration branch (claude-dev) and that merging to the production branch (main) is always human.
- **Recommendation:** Confirm; this is the current design.
- **Source:** Automation audit, open question 6.

### OQ-0026 — Approver and approval channel
- **Status:** open
- **Blocks:** STG-5
- **Question:** Who approves class B work, and through which channel? A GitHub environment with a required reviewer is planned but does not exist.
- **Source:** Automation audit, open question 7.

### OQ-0027 — When public-site changes may become class A
- **Status:** open
- **Blocks:** STG-7
- **Question:** The public site is class B until automated visual-regression baselines exist. When, and under what conditions, may purely visual or content changes be reclassified to class A?
- **Source:** OPS-0001 policy design (category ui_public_site).

### OQ-0028 — Push authorisation for worker branches
- **Status:** open
- **Blocks:** STG-3 (activation only), STG-6
- **Progress:** Not resolvable from existing decisions: HD-0005 says nothing is pushed without explicit approval, and no push has ever been authorised for the branches of this work. OPS-0002 was written locally without it (HD-0013 authorised local implementation only and expressly did not authorise pushing). A CI workflow only becomes active once its branch exists on the remote, so activation needs an explicit push decision. Note for the decision: pushing claude/ops-0002-ci-baseline also publishes the OPS-0001 and OPS-0001B commits underneath it (project memory and tooling only; none of the Reel commits), see [OPS-0002-ACTIVATION.md](../roadmap/OPS-0002-ACTIVATION.md).
- **Question:** Which of these does the owner authorise? (A) A one-time push of one named branch (for OPS-0002, claude/ops-0002-ci-baseline) after the work is reviewed. Consequence: that branch becomes public, the new workflow runs once on it, and a preview build may start; nothing else changes. (B) A standing authorisation to push any claude/ branch, never claude-dev or main. Consequence: every such push is public, runs CI and may start a preview build; it is needed for unattended operation (STG-6). (C) No push authorisation: the owner pushes by hand each time.
- **Recommendation:** A for OPS-0002; revisit B at STG-6, after OQ-0022 and OQ-0029 are answered.
- **Progress (2026-11-17):** Option A was chosen and used once for claude/ops-0002-ci-baseline (HD-0014). Its authorisation ended with that push. Each further branch, including claude/ops-0003-trusted-ci, needs its own explicit approval naming the branch. Standing authorisation (B) stays open for STG-6.
- **Source:** Automation audit, human action 6; HD-0005.

### OQ-0029 — Hosting plan and preview-build filter
- **Status:** open
- **Blocks:** STG-6
- **Question:** Which hosting plan is in use, and should previews for worker branches be filtered to limit builds?
- **Source:** Automation audit, human action 7.

### OQ-0030 — How the backend dev project is connected
- **Status:** open
- **Blocks:** PH-2
- **Question:** Connect through an installed connector or a securely stored credential, and which exact network hosts are allowed for the work environment? Nothing is provisioned until a human approves.
- **Source:** Phase 0 platform report, human action 2 and 3.

### OQ-0031 — Which runtime hosts the reviewer session
- **Status:** open
- **Blocks:** STG-4
- **Question:** The reviewer must be a separate Claude session (HD-0010). Two runtimes are documented. (1) actions_hosted_session: a restricted Claude session run by the official GitHub Action inside a GitHub Actions job. It reads files prepared by trusted steps, has a read-only tool list and a read-only repository token, and its structured result is validated by the deterministic validator. It is documented and subscription-authenticated, but it is a CI-hosted session, not a cloud session, and it needs OQ-0032. (2) cloud_routine_session: a Claude cloud session started by an experimental API call or by a pull-request trigger. It is a true cloud session, but it cannot be restricted to read-only per routine, it acts under the owner's own GitHub identity (the same as the worker), and a pull-request trigger starts from the worker's own branch, so the worker's own instruction files would be loaded. See REVIEWER_FEASIBILITY.md.
- **Recommendation:** actions_hosted_session, because it is the only runtime whose isolation can be enforced from documented features. This needs the owner to accept that the reviewer is a CI-hosted Claude session rather than a cloud session.
- **Source:** OPS-0001B feasibility assessment; HD-0010.

### OQ-0032 — Authorise a long-lived subscription token for CI
- **Status:** open
- **Blocks:** STG-4
- **Question:** Running a Claude session inside GitHub Actions needs a long-lived token tied to the owner's subscription. The owner would create it on their own machine with the official command (valid for one year, model requests only) and store it as a protected repository secret. Does the owner authorise this? Consequences: runs draw down the same subscription usage as interactive work; the token is a credential that must never be committed or typed into a chat; its exposure is limited by the reviewer's read-only tool list; it can be revoked. The documentation reviewed describes the official action and the token for CI, but does not say whether automated use of a subscription token is otherwise permitted, so a small terms-of-use uncertainty remains that only the owner can accept. An API key must never exist in that environment, because it would take precedence and switch billing to API rates.
- **Recommendation:** Decide after OPS-0002 has proved the baseline CI; do not create the token earlier.
- **Source:** OPS-0001B feasibility assessment; HD-0010.

### OQ-0033 — How the next worker session is started
- **Status:** open
- **Blocks:** STG-6
- **Question:** After a task is approved, how does the next worker session start? (1) A human starts it (documented; no automation). (2) A cloud scheduled task is started by its experimental fire endpoint (documented but experimental: it returns a session link, but has no status, no completion callback, no idempotency key, a per-task token and a limit of 30 starts per hour per task). (3) The worker also runs as a restricted Claude session inside GitHub Actions (documented, with a deterministic completion signal, but it is a CI-hosted session and needs OQ-0032).
- **Recommendation:** Option (1) through STG-5; choose between (2) and (3) at STG-6 after watching how the experimental interface behaves.
- **Source:** OPS-0001B feasibility assessment; REQ-OPS-009.

### OQ-0034 — GitHub settings that the owner must set before relying on CI
- **Status:** open
- **Blocks:** STG-3 (relying on CI results from outside contributors, and requiring them for merges)
- **Question:** The CI workflow is unprivileged by construction, but three things around it can only be set or observed by the owner in GitHub, and the system may not change repository settings (PROHIB-008). Does the owner (1) set "Approval for running fork pull request workflows from contributors" to "Require approval for all external contributors", (2) confirm the default workflow token permission is read-only and that GitHub Actions may not create and approve pull requests, and (3) after the first green run, add a branch protection rule or ruleset on the integration and production branches that requires the CI job as a status check? Consequences: without (1) a first-time outside contributor's pull request can start a run without approval (the run is still read-only and has no secrets) and consume free minutes; without (2) the repository's default may grant the token write access wherever a workflow forgets to restrict it (this workflow restricts it explicitly); without (3) a red CI result does not stop a merge. Also needed: the owner's confirmation that the two GitHub-owned actions in policy.workflow_policy (checkout and Node setup, each pinned to a SHA that was verified against its own repository) are acceptable.
- **Recommendation:** Yes to all three; details and exact menu names are in [OPS-0002-ACTIVATION.md](../roadmap/OPS-0002-ACTIVATION.md).
- **Progress (2026-11-17):** The first green run exists (run 43995081483, HD-0014), so part (3) can now be configured: the required check is the job name `verify`. Exact rulesets for main and claude-dev, the CODEOWNERS proposal and the interaction with Claude's branch workflow are in [GITHUB_SETTINGS_GUIDE.md](../roadmap/GITHUB_SETTINGS_GUIDE.md). The settings themselves, including the default token permission and fork-run approval, are still not observable from here and nothing was changed. One finding changes how far a rule can bind the automation: Claude acts as the owner (OQ-0036).
- **Source:** OPS-0002; HD-0013.

### OQ-0035 — Where is the trusted-base check anchored?
- **Status:** open
- **Blocks:** STG-4 (relying on the check as a gate rather than a measurement)
- **Question:** The trusted-base check (OPS-0003, [TRUSTED_CI.md](../architecture/TRUSTED_CI.md), ADR-0012) judges a change with the rules of an established base revision, but it is only independent of the change if it is run by something the change cannot alter. A second job in the same workflow is not such a thing, because a pull request runs its own copy of the workflow file. Which anchor does the owner accept? (1) The reviewer session's trusted workspace, which runs the tool from the base revision and receives the branch as data (no new workflow; needs OQ-0031). (2) A required reviewer who is not the author (needs OQ-0036). (3) An organisation-level required workflow (needs an organisation account and its cost, OQ-0023). (4) A privileged default-branch workflow (`workflow_run` or `pull_request_target`): not recommended; it is forbidden by the policy floors, anchors on the production branch, runs with a privileged token against code the pull request supplies, and GitHub documents a planned default block on `pull_request_target` in public repositories.
- **Recommendation:** (1) for the first reviewer stages, plus (2) once a second identity exists.
- **Source:** OPS-0003; HD-0015.

### OQ-0036 — A separate GitHub identity for the automation, and the branch rules that follow
- **Status:** open
- **Blocks:** STG-6 (and the meaning of "required approvals" on main)
- **Question:** The repository's only collaborator is the owner (admin), and every push and merge made from this environment is made as the owner. Branch rules therefore bind the automation only as far as they bind the owner, and a pull request's author cannot approve it, so requiring an approval would block every merge unless the owner is allowed to bypass, which also lets Claude through. Does the owner (1) apply the single-identity rules now as safety rails and rely on Claude's instructions and the owner's approval for merges to main (Profile 1 in [GITHUB_SETTINGS_GUIDE.md](../roadmap/GITHUB_SETTINGS_GUIDE.md)), and (2) later connect the automation under a separate, Write-only identity (a second free GitHub account or a GitHub App), after which the owner's approval is enforced by GitHub (Profile 2)? Whether a Claude session can be connected under such an identity is not verified.
- **Recommendation:** (1) now; investigate (2) before STG-6, and before any CI-hosted session holds a token (OQ-0032).
- **Source:** OPS-0003; HD-0015.
