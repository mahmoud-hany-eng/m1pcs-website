# Open questions

Unresolved business and technical decisions. **No task may assume an answer.** A task that depends on a question lists it in `blocked_by_open_questions` and must not run until a human resolves it.

Each entry has a status (`open` or `resolved`), what it blocks, the question, and where it came from. A `Recommendation` line is a suggestion for the human to accept or reject, never a decision. A resolved entry points to the human decision that resolved it.

Items 1 to 19 are the unresolved decisions from the Phase 0 platform report; 20 to 34 were added by the automation audit, OPS-0001 and OPS-0002; 35 and 36 by OPS-0003; 37 by OPS-0004; 38 and 39 by the OPS-0004 correction.

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
- **Status:** resolved
- **Resolution:** HD-0021
- **Blocks:** none
- **Outcome:** Points are earned on the net final amount payable (the order total less any discount and less any redeemed credit), 1 point per QAR 10, rounded down, once, when the order is completed and fully settled. Nothing is earned on discounted or credited money. Delivery fees are part of the order total as the items make it. (Policy `loyalty.earning_base` = `net_payable`, floor.)
- **Question:** Do delivery fees, discounts, redeemed points or deposits count towards the QAR 10 earning base? How are amounts rounded?
- **Source:** Phase 0 platform report, decision 7.

### OQ-0008 — Redemption rules
- **Status:** open
- **Blocks:** PH-7
- **Question:** Partly answered by HD-0021: points may be redeemed against an order, in part or in full, never beyond the balance or the price left after the discount, by the owner only for now, as an order credit and not a payment. Decided for this release by HD-0022: no expiry for now, and no cap beyond the available points and the eligible order amount. Still open for later: a minimum, a cap per order or per day, transferability, whether points can pay a deposit (today they cannot: the deposit stays in cash), and stacking limits with discounts.
- **Source:** Phase 0 platform report, decision 8; HD-0021.

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
- **Progress (2026-11-17):** Option A was used a second time, for claude/ops-0003-trusted-ci (HD-0016), again as a one-time push that ended with its verification. The OPS-0004 branch is local only; pushing it needs its own approval naming the branch (see OQ-0037).
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
- **Progress (2026-11-17):** OPS-0004 adds a third allowed runtime, `manual_session` (a separate session that a person starts by hand), so that the first review test needs no token and no automation. The policy's selected runtime stays null, so every review carries the "trial, cannot be relied on" warning. The first test is described in [FIRST_REVIEW_RUNBOOK.md](../reviewer/FIRST_REVIEW_RUNBOOK.md); no reviewer has been run.
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
- **Progress (2026-11-17):** The trusted-base check ran on GitHub as part of the OPS-0003 CI run (417 of 417 tests passed, including its attack tests) and its evidence tool processed real GitHub data; it is still advisory and unanchored. OPS-0004's packet builder and gate run from a checkout of a trusted baseline commit and refuse to run elsewhere, which is the practical form of option (1) for the first manual test.
- **Source:** OPS-0003; HD-0015.

### OQ-0036 — A separate GitHub identity for the automation, and the branch rules that follow
- **Status:** open
- **Blocks:** STG-6 (and the meaning of "required approvals" on main)
- **Question:** The repository's only collaborator is the owner (admin), and every push and merge made from this environment is made as the owner. Branch rules therefore bind the automation only as far as they bind the owner, and a pull request's author cannot approve it, so requiring an approval would block every merge unless the owner is allowed to bypass, which also lets Claude through. Does the owner (1) apply the single-identity rules now as safety rails and rely on Claude's instructions and the owner's approval for merges to main (Profile 1 in [GITHUB_SETTINGS_GUIDE.md](../roadmap/GITHUB_SETTINGS_GUIDE.md)), and (2) later connect the automation under a separate, Write-only identity (a second free GitHub account or a GitHub App), after which the owner's approval is enforced by GitHub (Profile 2)? Whether a Claude session can be connected under such an identity is not verified.
- **Recommendation:** (1) now; investigate (2) before STG-6, and before any CI-hosted session holds a token (OQ-0032).
- **Progress (2026-11-17):** Both live runs (OPS-0002 and OPS-0003) list the owner's login as actor, so the repository still lacks enforced separation between the human owner and the identity Claude acts under. The Claude Code documentation read for OPS-0003 describes the official GitHub Action authenticating as the Claude GitHub App (a separate identity with Contents, Issues and Pull requests permissions and no Administration permission) when no `github_token` is passed; that route needs OQ-0032 and a reviewed workflow change. No setting was changed.
- **Source:** OPS-0003; HD-0015.

### OQ-0037 — How is the first manual reviewer session hosted and fed?
- **Status:** open
- **Blocks:** OPS-0005 (the first manual review)
- **Question:** The first review test is manual and subscription-only (HD-0017). The reviewer must work from a clean checkout of the trusted baseline (the reviewed OPS-0004 commit), and the packet must reach the machine that runs the separate Claude Code session. How does the owner want to do it? (1) Authorise a one-time push of the branch claude/ops-0004-review-foundation (it also publishes the OPS-0004 commits; the packet itself is not committed). (2) A git bundle, which works only for a terminal user. (3) Another arrangement. No token or credential is created in any case.
- **Update (OPS-0004 correction, HD-0020):** the owner uses Claude Code in a browser (REQ-OPS-013). A browser session can reach only what GitHub holds, and a bundle upload is a terminal feature, so option (2) is not available to the owner. The browser reviewer rebuilds the packet itself inside its own session from the pushed baseline branch, the pushed OPS-0003 branch and GitHub's own CI data ([BROWSER_REVIEW.md](../architecture/BROWSER_REVIEW.md), [FIRST_REVIEW_RUNBOOK.md](../reviewer/FIRST_REVIEW_RUNBOOK.md)). The one human action that cannot be avoided is the push in option (1).
- **Recommendation:** (1): authorise one normal push of exactly claude/ops-0004-review-foundation, naming the branch, immediately before OPS-0005. The push adds only the OPS-0004 commits on top of the already published OPS-0003 branch.
- **Source:** OPS-0004; HD-0017; HD-0020.

### OQ-0038 — Where does the Instagram production work live, and is website-showreel marketing production?
- **Status:** open
- **Blocks:** the preservation and removal steps of the Instagram separation plan (HD-0019)
- **Question:** The Instagram Reel work must live outside the website repository (REQ-OPS-012). The tracked part is small (about 1.6 MB of scripts, text and code), but 5.4 GB of renders, exports, frames and audio exist only on the development container's disk and are in no Git history. Where should the work live: (1) a separate private GitHub repository the owner creates, (2) the owner's own storage by download from a session, or (3) another arrangement? Does the owner also confirm that `creative/website-showreel/` (a 9:16 Remotion and Three.js product film built from site captures, imported by nothing in the website) counts as marketing video production and is to be separated too? Which renders are kept: the 14 final MP4 files and their stems (about 711 MB) are the originals; the 4.1 GB of render frames and the 276 MB of installed packages can be regenerated.
- **Recommendation:** (1) for the sources and the final MP4 files, a private repository dedicated to Instagram production, with the large media kept as release assets or under Git LFS; keep `out/` and `node_modules/` only if re-rendering for hours is unacceptable. Until a home exists the container is the single copy, so the owner should say soon.
- **Source:** OPS-0004 correction; HD-0019; [INSTAGRAM_SEPARATION_PLAN.md](../roadmap/INSTAGRAM_SEPARATION_PLAN.md).

### OQ-0039 — History: rewrite the published history, and what happens to the local claude-dev branch
- **Status:** open
- **Blocks:** nothing now; needed before the removal of `creative/` is finished
- **Question:** (a) The 140 Instagram files stay in the published history of `claude-dev` and of the OPS-0002 and OPS-0003 branches after they are removed from the branch tip. Rewriting that published history (and force-pushing) would change every later commit id, break the recorded CI run and review-packet hashes, and still not remove forks or caches. Does the owner want it? (b) After the originals are archived and the archive is confirmed, should the local `claude-dev` branch with the eight unpublished Reel commits be kept as a local archive branch that is never pushed, or reset to `origin/claude-dev`?
- **Recommendation:** (a) no rewrite; the scan found no credential or customer data, and `main` has never contained these files. (b) Keep the local branch until the archive is confirmed, then decide; the commits are preserved by the bundle either way. Neither is done without the owner's explicit message.
- **Source:** OPS-0004 correction; HD-0019; [INSTAGRAM_SEPARATION_PLAN.md](../roadmap/INSTAGRAM_SEPARATION_PLAN.md).

### OQ-0040 — An order whose discount and loyalty credit leave less to pay than the cash deposit
- **Status:** open
- **Blocks:** nothing now (the case is blocked, with an explanation, at creation and at confirmation)
- **Question:** The deposit is a cash amount taken from the original gross total (HD-0021). A large discount, or points worth a lot, can leave a net payable amount below it (for example a QAR 1,000.00 order with a QAR 910.00 discount leaves QAR 90.00 against a QAR 150.00 deposit). Today such an order cannot be created or confirmed. Should it stay blocked, or should the deposit be fixed at the net amount, or should an order paid wholly by discount and points be allowed with no cash at all?
- **Recommendation:** Keep it blocked until the owner states which; it is one function (`private.order_pricing_quote`) and one constraint (`orders_confirmed_deposit_within_net`).
- **Source:** HD-0021 part D; [PRICING_AND_REWARDS.md](../architecture/PRICING_AND_REWARDS.md) section 6.

### OQ-0041 — The legacy "Discount" line item
- **Status:** open
- **Blocks:** nothing now
- **Question:** Orders could carry a negative "Discount" item line, which lowers the gross total and therefore the deposit. The new order form no longer offers it and the new `create_order` refuses it; the earlier entry points still accept it and existing orders keep theirs. Should the item kind be retired from the database, and what should be done about existing orders that carry one? (The final financial review reproduced that the earlier signatures still let any staff member create such a line with no owner authorization; `supabase/release/pricing_legacy_orders_contract.sql` closes them once the website deployed before the pricing release is retired. It is prepared and tested, and not applied.)
- **Source:** HD-0021; [PRICING_AND_REWARDS.md](../architecture/PRICING_AND_REWARDS.md) section 6.

### OQ-0042 — Who may see a customer's loyalty balance when creating an order, and limits on discounts
- **Status:** open
- **Blocks:** nothing now
- **Question:** Today the balance is shown to the owner and to anyone with `loyalty.read`; discounts and redemption are owner only. When other roles may discount or redeem (the owner said "initially"), should there be a maximum discount (a percentage or an amount) per role, and a reason list rather than free text?
- **Source:** HD-0021.

### OQ-0043 — Points already earned on an order whose payment is later reversed
- **Status:** open
- **Blocks:** nothing now (the owner decided not to implement clawback in this release; HD-0022)
- **Question:** Points are awarded once, when an order is completed and its net payable amount is fully paid. If a payment on that order is reversed afterwards (a refund, a bounced transfer), the order is no longer fully paid but the points stay with the customer, and the database does not take them back. Should earned points be taken back, partly or fully, when a payment is reversed; should a customer ever be allowed a negative points balance as a result (today the ledger refuses one); and how should points that were already spent be handled? Until the owner decides, a reversal changes the order's balance and the cash ledger only, never the points.
- **Recommendation:** Keep as is. If clawback is wanted, add it as a compensating ledger entry that is created only by an explicit owner action, never automatically, and decide first what happens when the points are already spent.
- **Source:** HD-0022; related OQ-0009, OQ-0010; [PRICING_AND_REWARDS.md](../architecture/PRICING_AND_REWARDS.md) section 6.

### OQ-0044 — Refunds to the customer after an order is completed
- **Status:** open
- **Blocks:** nothing now (there is no refund function; a payment reversal changes the order's cash balance only)
- **Question:** When money is returned to a customer after Delivered / Collected, should it reduce the order's recognized net revenue (and in which month: the completion month, or the month of the refund), or be reported as a separate refund line? Today the revenue snapshot of a completed order is immutable, and a reversal only brings the outstanding balance back.
- **Recommendation:** Treat a refund as its own owner-approved, dated entry that reduces the revenue of the **month it is made**, never rewriting the completion month, so closed months do not move.
- **Source:** HD-0023; related OQ-0043; [FINANCIAL_REPORTING.md](../architecture/FINANCIAL_REPORTING.md) section 6.

### OQ-0045 — Who besides the owner may see costs and profit
- **Status:** open
- **Blocks:** nothing now (owner only, as asked)
- **Question:** Should a separate finance or manager role ever see order costs and profit, or enter costs? The three permissions (`finance.read`, `finance.manage`, `finance.verify`) exist and are held by the owner role only; granting them to another role needs no code change.
- **Recommendation:** Keep owner only until a person is trusted with it; then grant `finance.read` first, and `finance.manage` separately.
- **Source:** HD-0023.

### OQ-0046 — A completed order that still has a balance owed
- **Status:** open
- **Blocks:** nothing now
- **Question:** Revenue is recognized on completion on the **net payable**, so an order delivered with part of the balance unpaid still counts in full in its completion month, and the unpaid part is shown as "still owed". Should the owner instead be able to hold such an order out of the revenue until it is paid?
- **Recommendation:** Keep revenue on completion (the brief's definition) and watch the "Completed with a balance still owed" item on the Overview.
- **Source:** HD-0023.

### OQ-0047 — Completion dates of orders delivered before this release
- **Status:** open
- **Blocks:** nothing now (such orders are flagged and counted in no month until confirmed)
- **Question:** Orders delivered before completion dates were recorded keep a completion date only when their status history proves it. For the others the owner must confirm the real date from their own records, one order at a time, in the order page. Should any be left unverified?
- **Recommendation:** Verify each from the delivery note or customer message and record how it was known in the reason field.
- **Source:** HD-0023; [FINANCIAL_REPORTING.md](../architecture/FINANCIAL_REPORTING.md) section 2.
