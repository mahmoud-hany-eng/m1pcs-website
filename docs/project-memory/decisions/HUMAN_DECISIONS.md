# Human decisions

Append-only log of decisions the human operator has made. Workers and models never edit this file; they may propose an entry in a run report.

- **Date** is the day the decision was recorded in project memory, which can be later than the day it was first stated.
- **Source** says where the decision came from, without quoting private content.
- An entry is never rewritten. A change of mind is a new entry that says which earlier entry it supersedes.

### HD-0001 — Scope of the business-management platform
- **Date:** 2026-11-16
- **Decision:** The existing website will be extended with customer accounts, a customer dashboard (orders, tracking, rewards), a private administrative dashboard, manual order management for website and WhatsApp customers, real-time customer-visible order progress, a loyalty rewards system, and private financial management, all backed by Supabase. The existing public site, including its design, animations, quotation flows, completed builds and WhatsApp integrations, must be preserved.
- **Source:** Human instruction at the start of the Phase 0 repository audit.
- **Affects:** REQ-PRES-001, REQ-PLAT-001, REQ-ACCT-001, REQ-ACCT-002, REQ-ORD-001, REQ-ORD-002, REQ-ORD-003, REQ-TRK-001, REQ-TRK-002, REQ-ADM-001, REQ-FIN-001, REQ-FIN-002, REQ-LOY-001

### HD-0002 — Phase 0 audits approved with modifications
- **Date:** 2026-11-16
- **Decision:** The Phase 0 technical audit and the automation architecture were reviewed and are approved with modifications. The modifications were not itemised in the instruction that started OPS-0001, beyond the constraints it lists (HD-0004). Until they are itemised (OQ-0020), every architecture entry is a recommendation, and every ADR stays proposed.
- **Source:** Human instruction that started OPS-0001.
- **Affects:** REC-PLAT-001, REC-OPS-001, ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008

### HD-0003 — Loyalty rules
- **Date:** 2026-11-16
- **Decision:** Customers earn 1 point per QAR 10 spent. Each point has a redemption value of QAR 0.10. Points are awarded only after an order is fulfilled. Duplicate awards must be prevented. Redemption restrictions and every other unspecified loyalty rule remain undecided.
- **Source:** Human instruction during the Phase 0 audit, restated in the OPS-0001 instruction.
- **Affects:** REQ-LOY-001, REQ-LOY-002, REQ-LOY-003, REQ-LOY-004, REQ-LOY-005, OQ-0007, OQ-0008

### HD-0004 — OPS-0001 authorised with explicit constraints
- **Date:** 2026-11-16
- **Decision:** OPS-0001 (shared project memory and development contracts) is approved. It is limited to documentation, schemas, a deterministic policy and an offline validator. It must not implement orchestration workflows or connect external services. It runs on the isolated branch claude/ops-0001-foundation, based on the remote integration baseline, without touching the unpushed Reel commits or the creative/ project and without pushing, merging or deploying. It must not create API keys, paid resources, GitHub secrets or environments, and it must not commit business-sensitive information.
- **Source:** Human instruction that started OPS-0001.
- **Affects:** REQ-OPS-007, REQ-ACCT-002, REQ-ORD-002, REQ-TRK-001, REQ-FIN-002, REQ-LOY-001

### HD-0005 — No push, merge or deploy without explicit approval
- **Date:** 2026-11-16
- **Decision:** Nothing is pushed, merged or deployed without the human's explicit approval in the working session. Commits stay local until the human says otherwise. No standing push authorisation exists yet (OQ-0028).
- **Source:** Standing human instruction repeated across earlier phases and in the OPS-0001 instruction.
- **Affects:** REQ-OPS-001, OQ-0028

### HD-0006 — Original build photos and the logo are never altered
- **Date:** 2026-11-16
- **Decision:** The original build photographs under public/builds and public/logo.png are never altered.
- **Source:** Standing human instruction from an earlier phase of the project.
- **Affects:** REQ-PRES-002

### HD-0007 — The repository is public
- **Date:** 2026-11-16
- **Decision:** The repository is public. No business-sensitive information may be committed to it.
- **Source:** Human instruction in the OPS-0001 instruction.
- **Affects:** REQ-OPS-007, ADR-0001, OQ-0023

### HD-0008 — Reel work and creative/ are left untouched
- **Date:** 2026-11-16
- **Decision:** The eight unpushed Reel commits on the local development branch and the creative/ project, including its file-permission change, are not touched, reset, reverted, rebased or pushed by this work. Their future is a separate human decision (OQ-0019).
- **Source:** Human instruction in the OPS-0001 instruction.
- **Affects:** OQ-0019

### HD-0009 — Operating principles of the autonomous development system
- **Date:** 2026-11-16
- **Decision:** The automation aims for minimal human intervention, but production deployments, destructive operations, billing changes and sensitive infrastructure changes always need explicit human approval. Paid infrastructure is introduced only when justified. Credentials are never exposed or requested in conversation. The system must not depend on remembering old Claude conversations. Work happens on a dedicated development branch with preview environments.
- **Source:** Human instruction in the automation brief that followed Phase 0.
- **Affects:** REQ-OPS-001, REQ-OPS-002, REQ-OPS-003, REQ-OPS-004, REQ-OPS-005, REQ-OPS-006

### HD-0010 — The automation uses only the existing Claude subscription
- **Date:** 2026-11-17
- **Decision:** The owner decided that development automation uses the existing Claude subscription only: no OpenAI API integration, no separate Anthropic Console API billing, and no additional paid AI services. Routine, low-risk development tasks execute automatically. Human approval remains required for sensitive changes and production releases. The reviewer is therefore a separate Claude session, and the JSON contracts stay provider-neutral. This supersedes the OpenAI-based reviewer proposed in the Phase 0 automation audit.
- **Source:** Human instruction that started OPS-0001B (decisions relayed by the project's planning and architecture lead).
- **Affects:** REQ-OPS-005, REQ-OPS-008, REQ-OPS-009, REC-OPS-010, ADR-0009, ADR-0010, OQ-0021, OQ-0024, OQ-0020

### HD-0011 — OPS-0001B authorised as attempt 2 of OPS-0001
- **Date:** 2026-11-17
- **Decision:** OPS-0001B is approved as a revision of OPS-0001 on the same isolated branch, recorded as attempt 2 (the second attempt of the existing task, within its attempt limit). Scope: record the owner's decisions; remove OpenAI-specific content from the active architecture; keep the schemas provider-neutral; assess Claude-only reviewer feasibility from official documentation; resolve OQ-0020, OQ-0023 and OQ-0028 only where existing decisions allow; prepare an OPS-0002 proposal; validate. Restrictions are unchanged: no push, merge or deploy; the eight unpushed Reel commits and the creative file-mode change stay untouched; no change to the website's public functionality; no secrets, API keys or paid resources; OPS-0002 is not begun.
- **Source:** Human instruction that started OPS-0001B.
- **Affects:** REQ-OPS-001, REQ-OPS-003, REQ-OPS-007, HD-0005, HD-0008

### HD-0012 — OPS-0001 provisionally accepted
- **Date:** 2026-11-17
- **Decision:** The project's planning and architecture lead (outside the automation) reviewed OPS-0001 and provisionally accepted it on the reported results: 144 of 144 tests, lint, type check and production build passing; 25 confirmed requirements; 30 open questions; a dedicated local worktree and branch; no production changes; the eight Reel commits preserved. Provisional means the ADRs stay proposed and the policy stays a draft until the owner ratifies them (OQ-0020).
- **Source:** Human instruction that started OPS-0001B.
- **Affects:** ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, OQ-0020

### HD-0013 — OPS-0002 authorised for local implementation; the public repository may be used provisionally
- **Date:** 2026-11-17
- **Decision:** The project's planning and architecture lead (outside the automation) reviewed OPS-0001B and provisionally approved it. The owner's decisions stay binding: only the existing Claude subscription (no OpenAI API, no paid Anthropic API integration); routine low-risk development should eventually run automatically while sensitive changes and production releases need a human; the Reel work and the production website are protected. The current public repository may be used provisionally for non-sensitive project files (this does not answer OQ-0023). OPS-0002, the secure GitHub Actions CI foundation, is authorised for implementation **locally only**, on the isolated branch claude/ops-0002-ci-baseline based on the OPS-0001B branch and without the Reel commits. The instruction requires explicit minimum token permissions, read-only repository access, no secrets, no Claude token, no database credentials, no pull_request_target, no deployment, a deterministic workflow-safety checker with tests, actions pinned to verified full commit SHAs, and no claim that installing without scripts makes later project scripts safe. **Not authorised:** pushing, merging, deploying, paid services, or any change to GitHub account or repository settings.
- **Source:** Human instruction that started OPS-0002 (decisions relayed by the project's planning and architecture lead).
- **Affects:** REQ-OPS-007, REQ-OPS-008, REQ-OPS-009, REQ-OPS-010, HD-0005, HD-0007, HD-0010, HD-0012, OQ-0023, OQ-0028

### HD-0014 — One-time push of claude/ops-0002-ci-baseline authorised, and performed
- **Date:** 2026-11-17
- **Decision:** The owner approved a **one-time** push of the single branch claude/ops-0002-ci-baseline (OQ-0028 option A), conditional on pre-push checks (branch and tip, clean tree, approved OPS-0001/0001B/0002 work only, none of the eight Reel commits, no change under src/, public/ or creative/, no credential or private data in what is published, correct remote, no force). The push was made once, as a normal push, and the authorisation ended with its verification. Not authorised, and not done: pushing claude-dev, main or any other branch, merging, deploying, changing GitHub settings, creating secrets, activating paid services.
- **Result recorded:** GitHub Actions run 43995081483 on commit 0aba5e8, job `verify`, concluded success: 353 tests, lint, type check and the production build passed; the token had `contents: read` and `metadata: read` only; no production change; the eight Reel commits stayed local and untouched. This is the first GitHub-observed result for the workflow.
- **Source:** Human instruction "OPS-0002 Activation: Authorized Branch Push & Live CI Verification".
- **Affects:** OQ-0028, OQ-0034, HD-0005, HD-0013

### HD-0015 — OPS-0003 authorised for local implementation; OPS-0002 live CI verification accepted
- **Date:** 2026-11-17
- **Decision:** The project's planning and architecture lead (outside the automation) reviewed the live CI verification of OPS-0002 and accepted it on the verified facts in HD-0014. OPS-0003, trusted CI verification and integration security, is authorised for implementation **locally only**, on the isolated branch claude/ops-0003-trusted-ci based on the OPS-0002 branch and without the eight Reel commits. Objective: stop a future autonomous worker from bypassing security checks by modifying the checks that evaluate its own work, and prepare for independent Claude reviewer sessions. The instruction requires that a second job in the same modifiable workflow is **not** treated as an independent security boundary, that nothing is described as independent enforcement unless it is anchored to a protected workflow or trusted configuration, and that control-plane changes still need human review and approval until that is established. **Not authorised:** pushing, merging, production deployment, modifying GitHub settings, creating tokens, secrets or paid resources, implementing the reviewer, or starting another task.
- **Source:** Human instruction that started OPS-0003 (decisions relayed by the project's planning and architecture lead).
- **Affects:** REQ-OPS-008, REQ-OPS-009, REQ-OPS-010, HD-0005, HD-0008, HD-0010, HD-0013, OQ-0028, OQ-0034

### HD-0016 — The OPS-0003 branch was pushed once, its live run verified, and OPS-0003 accepted as a completed development phase
- **Date:** 2026-11-17
- **Decision:** The owner approved a **one-time** push of the single branch claude/ops-0003-trusted-ci (OQ-0028 option A) after 11 pre-push checks, and the push was made as a normal push that created the branch. The authorisation ended with that push and its verification. Not authorised, and not done: pushing claude-dev, main or any other branch, merging, opening a pull request, deploying, changing GitHub settings, creating secrets or paid services. The project's planning and architecture lead then reviewed the live verification and accepted OPS-0003 as a completed development phase, on the verified facts below, while recording that its trusted-base checker remains advisory and is not independently enforced.
- **Result recorded:** GitHub Actions run 44082419253 on commit 50a46ca, job `verify`, concluded success on its first attempt: 417 of 417 tests (a count printed by the code under test), lint, type check, project-memory validation (111 files) and the production build (56 of 56 pages) passed; the job's token had contents: read and metadata: read only; no secret, environment or deployment step. The CI-evidence tool processed the real, unmodified GitHub responses (all fetched without authentication) and produced evidence bound to the right commit and run: CI passed, CI definition modified from base, so a human is required. The push produced one Vercel Preview deployment and no Production deployment. `main` (b180378) and `claude-dev` (b7348bb) were unchanged on the remote; the eight Reel commits stayed local and untouched.
- **Source:** Human instruction "OPS-0003 Live Activation and Verification" and the architecture lead's review that opened OPS-0004.
- **Affects:** OQ-0028, OQ-0034, OQ-0035, OQ-0036, HD-0005, HD-0008, HD-0015

### HD-0017 — OPS-0004 authorised for local implementation as a reduced task; a stacked dependency exception is recorded
- **Date:** 2026-11-17
- **Decision:** A reduced OPS-0004 is authorised for implementation **locally only**, on the isolated branch claude/ops-0004-review-foundation based on claude/ops-0003-trusted-ci (50a46ca88a682095b07422152136a747d12bddd3), in a separate worktree, without the eight Reel commits. Scope: a review packet builder, a deterministic decision gate, a manual-review runbook with the exact launch prompt, negative security tests, and project-memory updates. Not authorised: pushing, merging, deploying, changing GitHub settings, creating credentials, activating paid services, running an automated reviewer, or beginning OPS-0005. **Dependency exception:** OPS-0003 is not merged into claude-dev, and OPS-0004 is built on top of it for implementation and testing only; this records neither approval to integrate nor approval to deploy. For the first review experiment the trusted baseline is the reviewed OPS-0004 commit, because the OPS-0003 task file does not exist at the OPS-0003 base. The first reviewer test is manual and subscription-only, and no automatic reviewer or dispatch system is active.
- **Source:** Human instruction "OPS-0004: Review Packets, Decision Gate & First Reviewer Test Preparation".
- **Affects:** REQ-OPS-008, REQ-OPS-009, HD-0005, HD-0008, HD-0010, HD-0015, HD-0016, OQ-0031, OQ-0032, OQ-0035, OQ-0036, OQ-0037

### HD-0018 — The official development structure: claude/** features, claude-dev staging, main production
- **Date:** 2026-11-17
- **Decision:** The owner confirmed the permanent development structure. `claude/**` branches are isolated feature-development branches. `claude-dev` is the staging and integration-testing environment. `main` is the final production website. All website features must be tested on `claude-dev` before their production release. Only the owner's explicit approval may authorize a production merge or deployment. Temporary stacked feature branches (a `claude/**` branch built on another) are permitted for implementation and validation, but they do not replace the staging requirement. This refines REQ-OPS-006 (HD-0009) and is recorded as REQ-OPS-011.
- **Source:** Human instruction "OPS-0004 Correction: Browser Compatibility and Permanent Repository Rules", item 2.
- **Affects:** REQ-OPS-006, REQ-OPS-011, HD-0001, HD-0017

### HD-0019 — Instagram advertising and video production stay completely separate from the website repository
- **Date:** 2026-11-17
- **Decision:** The owner requires, permanently, that Instagram advertising and video production remain completely separate from the website's GitHub repository. The repository must not contain rendered Instagram videos, Instagram advertising projects, Remotion projects used solely for Instagram production, video-generation scripts used solely for marketing, or temporary video exports and generated Reel assets. Website assets genuinely required by the website are separate and permitted. The existing tracked `creative/` files (140 published on `claude-dev`, 196 locally) and the eight unpublished Reel commits are a known violation of this rule. They are to be investigated and remedied by a plan that preserves the original Instagram work outside the repository, prevents future Instagram files from being committed, removes the Instagram-only files from the current development state after the owner's approval, explains what remains in history, avoids rewriting published history unless separately approved, and leaves every website file and function unchanged ([INSTAGRAM_SEPARATION_PLAN.md](../roadmap/INSTAGRAM_SEPARATION_PLAN.md)). In the run that recorded this decision nothing under `creative/` and none of the Reel commits was moved, deleted, reset, rebased, rewritten or modified, and no Reel content was pushed. Recorded as REQ-OPS-012.
- **Source:** Same instruction, item 3.
- **Affects:** REQ-OPS-012, REQ-OPS-007, HD-0005, HD-0007, OQ-0019, OQ-0038, OQ-0039

### HD-0020 — The owner works in the browser; the OPS-0004 correction is authorised locally
- **Date:** 2026-11-17
- **Decision:** The owner uses Claude Code at claude.ai/code in a browser and not through a local terminal or editor (REQ-OPS-013). The architecture lead provisionally accepted the OPS-0004 implementation and required, before OPS-0005, a browser-native procedure for the first reviewer test, the permanent repository rules above, and updated runbook documentation. This correction was authorised **locally only**, on the existing OPS-0004 branch: no push, merge, deployment, repository-setting change, credential, paid service or start of OPS-0005, and no change to the production website or the unpublished Reel work. Any review from a browser session stays advisory until read-only isolation and reliable evidence provenance are actually established. The security policy, decision gate, schemas and tests were not weakened.
- **Source:** Same instruction, items 1, 4, 5 and 6.
- **Affects:** REQ-OPS-013, HD-0017, OQ-0031, OQ-0037

### HD-0021 — Five deposit tiers on the original gross total; owner-only order discounts and loyalty redemption; points earned on the net amount
- **Date:** 2026-11-23
- **Decision:** The owner replaced the three deposit tiers with five, by the **original gross** order total: up to QAR 3,000.00 is 15 %; QAR 3,000.01 to 5,000.00 is 25 %; QAR 5,000.01 to 10,000.00 is 35 %; QAR 10,000.01 to 15,000.00 is 50 %; above QAR 15,000.00 is 60 %; rounded to the nearest QAR 0.01. A discount or redeemed points never reduce the tier or the deposit. The new schedule applies to orders confirmed from now on; a deposit already fixed on a confirmed order is not changed. Orders may carry an ordinary discount (a fixed amount, preferably also a percentage), applied by the owner only for now, with a record of who authorized it. A customer's loyalty points may be redeemed against an order (1 point = QAR 0.10, partially or in full, never more than the balance or than what is left to pay after the discount), by the owner only for now, as an **order credit and not a payment**. Points are still earned at 1 per QAR 10, but on the **net final amount payable** (excluding discounts and redeemed credit), rounded down, once, when the order is completed and the payable amount is fully settled. Where discounts and credit would leave less to pay than the gross-based cash deposit, the order is blocked and reported as a policy decision; the deposit is not lowered and no payment is invented. A cancellation returns redeemed points by a compensating ledger entry; earned points are not clawed back, and no balance goes negative, until the owner approves that policy. Delivery address and collection method stay optional (arranged by WhatsApp).
- **Implemented locally as:** PLAT-0005 on `claude/plat-0004-order-hardening` (three forward-only migrations, the order form's Pricing & Rewards section, statements). Nothing was applied to a hosted database or deployed. See [PRICING_AND_REWARDS.md](../architecture/PRICING_AND_REWARDS.md).
- **Source:** Human instruction "M1 Gaming PCs — Update Deposit Policy, Add Order Discounts & Loyalty Redemption", parts A to I.
- **Affects:** REQ-LOY-002, REQ-LOY-003, REQ-LOY-004, REQ-LOY-005, REQ-LOY-006, REQ-ORD-004, OQ-0007, OQ-0008, OQ-0040, OQ-0041, OQ-0042, HD-0003

### HD-0022 — Release decisions for Pricing & Rewards (final financial review)
- **Date:** 2026-11-23
- **Decision:** For this release the owner confirmed: (1) **only the owner** may authorize discounts and loyalty redemption; (2) **no loyalty points expiry** for now; (3) **no separate redemption cap**: only the customer's available points and the eligible order amount limit a redemption; (4) a redemption **must never create a negative points balance**; (5) discounts may be a **fixed QAR amount or a percentage**; (6) **existing legacy orders and their pricing history are preserved**; (7) **new orders use the new Pricing & Rewards system**; (8) **delivery or collection arrangements stay optional** in the dashboard, because the owner manages them through WhatsApp. The owner also decided that **automatic loyalty clawback after a payment reversal is NOT implemented**; that scenario is reported as an unresolved policy decision (OQ-0043).
- **Source:** Human instruction "M1 Gaming PCs — Pricing & Rewards Final Financial Review", section 4.
- **Affects:** REQ-LOY-006, REQ-ORD-004, OQ-0008, OQ-0041, OQ-0042, OQ-0043, HD-0021

### HD-0023 — Order costs, completion dates and unified financial reporting
- **Date:** 2026-11-24
- **Decision:** The owner asked for private, editable **direct costs per order** (several entries, estimated or actual, addable and correctable at any stage including after delivery and completion, with an immutable revision history); **owner-only** access to costs, profit and margin (customers, anonymous callers, ordinary staff and every customer-facing API never receive them); a **completion date** recorded automatically the first time an order reaches Delivered / Collected (Asia/Qatar months), by which all reports are grouped (an order created in November and completed in December counts in December only; the creation date and the payment dates are not changed); historical backfill **only** where the status history proves the exact time, otherwise "needs historical verification" with no invented date; **order profit** defined as net revenue (original total less the owner-approved discount and the redeemed loyalty credit) less direct costs, **not** company net profit; a missing cost is never zero and incomplete costs make a profit provisional; a **Financial performance** section above the orders list (year and month selectors, a January to December table, drill-down by completion date, database-side aggregation); a grouped, simplified **Overview**; and a customer **order history** that leads with the final net payable. The existing Pricing & Rewards system, the five deposit tiers, loyalty redemption, payments and Workflow V1/V2 must not be broken. This is not a complete accounting or inventory system.
- **Implemented locally as:** PLAT-0006 on `claude/plat-0004-order-hardening` (two forward-only migrations, the cost editor, the Orders and Overview and customer screens). Nothing was applied to a hosted database, deployed or pushed. See [FINANCIAL_REPORTING.md](../architecture/FINANCIAL_REPORTING.md).
- **Source:** Human instruction "M1 Gaming PCs — Unified Financial Reporting, Editable Order Costs and Customer Order Details", parts 1 to 9.
- **Affects:** REQ-ORD-004, REQ-LOY-006, OQ-0043, OQ-0044, OQ-0045, OQ-0046, OQ-0047, HD-0021, HD-0022

### HD-0024 — Orders page finalised (filters, sort, paging) and an account menu in the public header
- **Date:** 2026-11-25
- **Decision:** After testing the financial reporting in the DEV Preview the owner asked to (1) **remove the redundant "Orders completed in <period>" table** from `/admin/orders` while keeping the Financial performance section, its figures, its January to December table, its year and month selection and the by-completion-date (Asia/Qatar) grouping, and removing the links, anchors and pagination that pointed at the removed table; (2) turn the operational Orders table into a filtered, sorted, paged list done **in the database**: the 5 newest orders by default (newest first, "Showing 1–5 of N"), a month and year filter and an optional inclusive Qatar-date range (the range takes precedence over month and year, visibly), by the date an order was **placed** and independent of the report; sorting by newest, oldest, lowest or highest **amount payable** (total less discount less redeemed credit) with a stable tie-break; the existing search and status filters kept and combinable; 5/10/25 rows per page (5 default); every choice in the address; a three-row filter layout with a fixed search field; stacked controls on a phone; and (3) a small circular **account menu** right of Get a Quote in the public header (My Account, Customer Sign In, Create Account, Staff Dashboard), also in the hamburger menu, that respects the existing customer-account and staff switches, offers nothing where the routes are off (in particular on Production), and activates neither customer accounts nor the admin routes in Production.
- **Choices made in carrying it out (not in the brief):** a month with no year means that month of the current Qatar year; an invalid date range shows an explanation and no list rather than a different list; Apply filters is offered beside Reset as well as Search at the top (all controls are one form); the Orders list shows cards below 1280 px (eight columns need the room beside the sidebar) and the placed date on every card; the price column shows the **payable** amount with the original as "was"; the header cannot know whether a visitor is signed in (HttpOnly cookies, static pages), so it leaves out only plainly redundant entries (OQ-0048); the menu's links are decided from the environment of the deployment's build for the public pages (on Vercel a build and its run share one environment).
- **Implemented locally as:** PLAT-0007 on `claude/plat-0004-order-hardening` (one additive migration, `20261125120000_orders_list_paging.sql`, adding `admin.list_orders_page` and nothing else; `admin.list_orders` untouched). Nothing was applied to a hosted database, deployed or pushed. See [ORDERS_LIST.md](../architecture/ORDERS_LIST.md) and [PUBLIC_HEADER_ACCOUNT_MENU.md](../architecture/PUBLIC_HEADER_ACCOUNT_MENU.md).
- **Source:** Human instruction "M1 Gaming PCs — Final Orders Page UX Improvements + Website Account Dropdown", parts 1 to 6.
- **Affects:** HD-0023, REQ-ORD-004, OQ-0048, OQ-0049

### HD-0025 — Corrective release for PLAT-0007: header layout at 1024px and the Orders sort label
- **Date:** 2026-11-25
- **Decision:** After the PLAT-0007 DEV staging release (migration and Preview accepted) the owner authorized **a narrowly scoped corrective release for two issues only**: (1) the public header's six links wrapped onto two rows at 1024px on the GitHub CI runner (CI run #19), which the owner treated as a genuine responsive-layout defect: the layout must stay correct across font environments, the profile icon and Get a Quote must stay, the existing M1 design is kept, using the hamburger navigation at narrower desktop and tablet widths is acceptable, essential navigation must not be hidden, the failing CI test must not be weakened, and 1024, 1060, 1100, 1280 and 1440px must be tested including fallback-font conditions; (2) a non-default Orders sort showed "newest first" in one label: every visible sort label must name the actual sort, and the count and pagination labels must stay accurate. One local commit, exactly one normal push to `claude/plat-0004-order-hardening`, then verification of CI and the Vercel Preview. No migration, no change to Production, `main`, `claude-dev`, the workflow default, authentication or MFA, or the Instagram files.
- **Choices made in carrying it out (not in the brief):** the six links are in the bar from 80em (1280px at the default text size), written in em so larger default text gets the menu earlier; from 1024px Get a Quote and the account button stay in the bar and the menu button sits beside them; the menu then holds only the six links (it does not repeat what the bar shows). Opening the menu closes the account menu and the other way round. The sort phrase in the summary line is the chosen label in lower case.
- **Implemented as:** PLAT-0007-a2 (see the run record). The failing assertion was kept and made stricter, never relaxed; the two original defects were put back one at a time and each is caught.
- **Source:** Human instruction "M1 PLAT-0007 — Fix CI Header Layout and Orders Sort Label".
- **Affects:** HD-0024, OQ-0048

