# Open questions

Unresolved business and technical decisions. **No task may assume an answer.** A task that depends on a question lists it in `blocked_by_open_questions` and must not run until a human resolves it.

Each entry has a status (`open` or `resolved`), what it blocks, the question, and where it came from. A `Recommendation` line is a suggestion for the human to accept or reject, never a decision. A resolved entry points to the human decision that resolved it.

Items 1 to 19 are the unresolved decisions from the Phase 0 platform report; 20 onward were added by the automation audit and OPS-0001.

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
- **Source:** Phase 0 platform report, decision 19; HD-0008.

### OQ-0020 — Itemise the modifications to the Phase 0 architecture
- **Status:** open
- **Blocks:** STG-3
- **Question:** Which modifications were intended when the Phase 0 audits were approved with modifications (HD-0002)? Until they are itemised, all ADRs stay proposed.
- **Source:** HD-0002.

### OQ-0021 — OpenAI API spend, or a Claude-based reviewer
- **Status:** open
- **Blocks:** STG-4
- **Question:** The OpenAI API is billed separately from a ChatGPT subscription. Accept a small prepaid balance with a hard monthly limit, or use a Claude-based reviewer that needs no new paid service?
- **Source:** Automation audit, human action 1; REQ-OPS-005.

### OQ-0022 — Claude plan allowance and GitHub App installation
- **Status:** open
- **Blocks:** STG-6
- **Question:** What daily and hourly allowance for cloud runs does the Claude plan really have, and is the Claude GitHub App installed on this repository? Published documentation about daily caps conflicts.
- **Source:** Automation audit, human action 2.

### OQ-0023 — Public repository or a private operations repository
- **Status:** open
- **Blocks:** STG-3
- **Question:** Keep project memory in this public repository, or move it to a private one? A private repository on a free plan loses rulesets and approval environments.
- **Recommendation:** Stay public, and keep sensitive material out of git entirely (HD-0007).
- **Source:** Automation audit, open question 4.

### OQ-0024 — Which OpenAI model to pin
- **Status:** open
- **Blocks:** STG-4
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

### OQ-0028 — Standing push authorisation for worker branches
- **Status:** open
- **Blocks:** STG-6
- **Question:** Will the human grant a standing authorisation for Claude to push to claude/ branches (and to the integration branch), with production staying human-only? No standing authorisation exists (HD-0005).
- **Source:** Automation audit, human action 6.

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
