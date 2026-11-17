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
