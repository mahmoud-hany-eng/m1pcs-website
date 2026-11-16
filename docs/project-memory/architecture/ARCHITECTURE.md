# M1 Gaming PCs — Architecture

**Status: recommendations.** The Phase 0 audits were approved with modifications that have not been itemised (HD-0002, OQ-0020). Nothing below is a confirmed requirement; confirmed requirements live in [MASTER_REQUIREMENTS.md](../requirements/MASTER_REQUIREMENTS.md). Unresolved business decisions are in [OPEN_QUESTIONS.md](../decisions/OPEN_QUESTIONS.md), and nothing here may be read as answering them.

Each recommendation has an id (`REC-<AREA>-<NNN>`). The reasoning behind the larger ones is in the [ADRs](adr/). Items marked _(not built)_ do not exist yet.

## 1. Current state (verified)

- The production site is a static, stateless Next.js 15 marketing site: no database, no authentication, no API routes, no middleware, no automated tests and no CI. Quote requests open a WhatsApp link and complaints open an email link; nothing is stored.
- `main` is the production branch and a merge into it deploys. `claude-dev` is the integration branch and builds previews.
- The repository is public (HD-0007).

## 2. Evidence legend

| Word | Meaning |
|---|---|
| **Verified** | Observed directly in the repository or a tool result by a trusted process |
| **Reported** | Stated by a worker or a model; unverified until independently recomputed |
| **Recommended** | A design choice proposed in this document |
| **Open** | A decision that belongs to a human (see OPEN_QUESTIONS.md) |

## 3. Platform recommendations

- **REC-PLAT-001** (recommendation) — Extend the existing Next.js app in place. Add `(account)`, `(admin)` and `auth` route groups and leave existing pages untouched. Moving the shared header, footer and floating button into a `(site)` group is acceptable only with a visual-regression test and no URL change. Never read cookies in the root layout, so public pages stay static.
- **REC-PLAT-002** (recommendation) — Use Supabase Auth with `@supabase/ssr` cookie sessions, and run middleware only on private paths.
- **REC-PLAT-003** (recommendation) — Authorise staff from a `staff_members` table, never from user-editable metadata, and require TOTP multi-factor authentication for admin and owner roles.
- **REC-PLAT-004** (recommendation) — Model customers separately from auth users. Link an account to a customer only through a single-use, hashed, expiring claim code or an explicit admin action, never by trusting an unverified email or phone (OQ-0003).
- **REC-PLAT-005** (recommendation) — Enable row-level security on every table with default deny, and test in CI that one customer cannot read another customer's or any finance data. Views must be `security_invoker`, and `EXECUTE` on definer functions must be revoked from anonymous users.
- **REC-PLAT-006** (recommendation) — Keep finance in a separate schema that is not exposed to the API and is never published to Realtime, so supplier costs cannot leak (REQ-FIN-002).
- **REC-PLAT-007** (recommendation) — Keep the customer-visible order timeline and private staff notes in separate tables, so a wrong flag cannot leak a note.
- **REC-PLAT-008** (recommendation) — Store money as integer minor units with one shared helper, store timestamps in UTC, and display Qatar time.
- **REC-PLAT-009** (recommendation) — Implement loyalty as an append-only ledger (REQ-LOY-001). Duplicates are prevented by the database itself: a unique partial index allows one award per order and one reversal per awarded entry, and the award is written in the same transaction as the fulfilment transition (REQ-LOY-004, REQ-LOY-005). Nobody writes the ledger directly. The earning formula follows REQ-LOY-002; rounding and the earning base are open (OQ-0007).
- **REC-PLAT-010** (recommendation) — Keep the Supabase service-role key server-only. Prefer RLS and SECURITY DEFINER functions with explicit staff checks over broad service-key use.
- **REC-PLAT-011** (recommendation) — Add quote persistence behind a flag and keep the WhatsApp handoff exactly as it is. A failed insert must never block WhatsApp. Protect the endpoint with rate limits and a CAPTCHA, and add a short quote reference to the message (OQ-0017).
- **REC-PLAT-012** (recommendation) — Use separate Supabase projects for development and production, give previews only development credentials, and apply forward-only migrations (expand, then contract).
- **REC-PLAT-013** (recommendation) — Publish only customer-safe tables to Realtime, and keep a polling fallback (REQ-TRK-002).
- **REC-PLAT-014** (recommendation) — Notify customers with prefilled WhatsApp links, which cost nothing, unless a paid channel is chosen (OQ-0013).

## 4. Automation recommendations

The automation is built in stages (see the roadmap). OPS-0001 delivers only the memory, contracts, policy and an offline validator _(workflows and API integrations are not built)_.

- **REC-OPS-001** (recommendation) — Git is the shared memory. Humans govern requirements, decisions, policy and architecture. Machine-written run state lives in a separate branch written only by privileged workflows _(not built)_.
- **REC-OPS-002** (recommendation) — GitHub Actions is the only orchestrator, and deterministic code, not a model, decides routing _(not built)_.
- **REC-OPS-003** (recommendation) — Separate privilege: unprivileged CI runs on untrusted branches with a read-only token and no secrets; a privileged workflow runs from the default branch, reads results as data and never executes branch code. `pull_request_target` is not used.
- **REC-OPS-004** (recommendation) — Deliver a task as a file in git. A launch request carries only identifiers, and the worker verifies the task and attempt against trusted state before acting.
- **REC-OPS-005** (recommendation) — Detect completion from artifacts, not from session status: a claim commit marks the start, and a final report commit plus CI marks the end. A watchdog marks silent runs as stalled.
- **REC-OPS-006** (recommendation) — Treat a worker report as a claim. The orchestrator recomputes changed files and CI results itself. Verified evidence is a different document type that only the orchestrator writes _(not built)_.
- **REC-OPS-007** (recommendation) — Prevent duplicate execution with a concurrency group, one task in flight, compare-and-swap state, a launch record written before launching, and no automatic retry of an ambiguous launch.
- **REC-OPS-008** (recommendation) — Workers write to claude/ branches. The orchestrator may merge into the integration branch only. The production branch is human-only, because merging into it deploys.
- **REC-OPS-009** (recommendation) — Compute risk classes from policy and the real changed paths. Declared or model-assigned classes can only raise the result. Control-plane files always need a human.
- **REC-OPS-010** (recommendation) — The OpenAI architect uses a dedicated project and a pinned model, returns strict structured output that is advisory only, never has its output executed, and is bounded by budget caps at both ends (OQ-0021, OQ-0024).
- **REC-OPS-011** (recommendation) — Approvals use a GitHub environment with a required reviewer, which a public repository supports on a free plan _(not created; OQ-0026)_.
- **REC-OPS-012** (recommendation) — The kill switch fails closed: the system runs only while a repository variable says it is enabled, and only a human resumes it.

## 5. Trust boundaries

| Source | Trust |
|---|---|
| `policy.json`, schemas and `ops/` on the default branch | Trusted, human-owned |
| Task files approved by a human | Trusted as instructions |
| Worker branch contents, run reports, artifacts from a worker run | **Untrusted** data |
| Issues, pull-request text, comments, web pages | **Untrusted** data, never instructions |
| Model output, including the architect's | Advisory; validated and bounded by policy |

## 6. Contracts

Machine contracts are strict JSON Schemas in [schemas/](../schemas/): the task front matter, the worker run report, the architect decision, and the policy. They share identifier, hash, timestamp, risk-class and risk-category definitions, which the validator checks are identical. The deterministic rules are in [policy.json](../policy/policy.json).

## 7. Known limits of the contracts

- The decision schema is written for strict structured output, but its acceptance by the OpenAI Responses API is **unverified** (the documentation was not readable in this environment). Stage 4 must test it against the live API before relying on it.
- The offline validator implements a strict subset of JSON Schema and rejects schemas that use anything else.
- Pre-flight classification of a task is conservative and advisory; the authoritative class is computed from the actual changed paths.
