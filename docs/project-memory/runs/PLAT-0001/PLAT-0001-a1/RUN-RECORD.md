# PLAT-0001 — run record, attempt 1 (Supabase database foundation, Phase 1)

**Local only. Nothing was pushed, merged or deployed.** No Supabase project, credential, paid service or live resource
was created or contacted. This is a Markdown run record in the style of the OPS-0005B and OPS-0006 records; it is not a
schema-validated `report.json`, because no task file exists for PLAT-0001 (task files and human-decision records are
human-controlled and were deliberately not created).

The design is in [SUPABASE_FOUNDATION.md](../../../architecture/SUPABASE_FOUNDATION.md).

## Baseline and commits

| Role | Commit |
|---|---|
| **Baseline: the verified staging-integration commit (GitHub CI 561 of 561)** | `005196a058a7c667673e78c903a5fcd39fab1ff4` |
| Database foundation: migrations, config, README, real-Supabase checklist | `ad52795` |
| Typed interfaces, money helper, environment contract, `.env.example` | `2d5ccc5` |
| Local tests (real PostgreSQL), static checks, unit tests, scripts | `f28df57` |
| Architecture document | `89d2e19` |
| Memory document refers to `supabase/` paths as code, not links | `4260a9a` |
| This run record (the head of the branch) | the commit that adds this file |

Branch `claude/plat-0001-supabase-foundation`, created locally on 2026-11-18 at 19:17 UTC from the exact baseline above.
It was **not** based on the local `claude-dev` worktree. It has no upstream and no remote ref.

## What was built

* **Eleven migrations** (`supabase/migrations/`): schemas `public` / `private` / `admin`; customers and accounts;
  quotations; orders, items and customer-visible tracking; a QAR payments ledger; an append-only loyalty ledger; staff
  roles and permissions; business policies; the staff functions; and a final migration that runs
  `private.security_audit()` and fails on any violation.
* **TypeScript** (`src/lib/platform/`): hand-maintained row types, a QAR minor-unit helper, an environment contract.
  Nothing in the website imports them.
* **Tests** (`supabase/tests/`): database tests on a real PostgreSQL server, static checks, unit tests.
* **Documentation**: `supabase/README.md`, `supabase/tests/REAL_SUPABASE_CHECKS.md`, the architecture document.
* **Other**: `.env.example` (names only), `supabase/config.toml` (local stack, exposes only `public`),
  two `package.json` scripts (`db:test`, `db:test:static`). No dependency was added; `package-lock.json` is identical.

## Verification

Run from a clean checkout of the committed branch with a fresh `npm ci`. Node v22.23.4, PostgreSQL 16.15.

| Check | Result |
|---|---|
| `npm run ops:validate` | OK, 150 files; one warning, about the OPS-0006 task file, which this work did not touch |
| `npm run ops:test` | **561 of 561** (the same count as the baseline) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0, **56 of 56** static pages (the same as the baseline) |
| `npm run db:test:static` | **32 of 32** (15 unit tests of money and env, 17 static checks) |
| `npm run db:test` | **135 of 135**, against a real PostgreSQL server that the harness starts and removes |
| Mutation test of the SQL | **24 of 24** mutants caught |
| Mutation test of the static, TypeScript and type-contract checks | **24 of 24** caught |

**Locally executed:** everything in the table. The database tests exercise the migrations, constraints, row level
security, the privilege model, finance separation, transitions and the deposit gate, policies, payments, loyalty,
claim codes and staff permissions on a real PostgreSQL server.

**Needs a real Supabase instance, and was not run:** GoTrue issuing real tokens and the `aal` claim, PostgREST
exposing the schemas, Realtime, dashboard settings, the Supabase CLI and `config.toml`, and the migrations run as
Supabase's `postgres` role rather than a superuser. The shim in `supabase/tests/support/` only imitates the roles and
`auth.uid()` / `auth.jwt()`. The checklist is `supabase/tests/REAL_SUPABASE_CHECKS.md`. The migrations were run on
PostgreSQL 16 only, though they use nothing newer than 15.

**A note on the mutation results.** Three of the 24 SQL mutants (letting an API role read supplier costs, letting
`service_role` write payments, adding an internal-reference column to a customer-visible table) were not caught by an
individual test. They were refused earlier: the migration-time security audit raised an exception, so the migrations
never applied. That is the audit doing its job, and each was confirmed by name, but it is a different mechanism from
a failing test.

## Findings made during verification, and what was done

1. **A real defect in claim-code generation.** The code took its 20 characters from one UUID, so two positions were
   fixed by the UUID format and the code had about 74 random bits, not the intended 80; a second UUID call was dead
   code. It was not exploitable (rate limit, expiry, single use), but it was wrong. It now uses only the random
   positions (80 bits). A test issues 200 codes and requires every position to vary; it **fails on the old generator**
   (`position 13 showed only 1 different characters`) and passes on the new one.
2. **Two tests were weaker than they looked.** Mutation testing showed that one test never reached the rule it named
   (a URL rejected for another reason first) and another could not isolate the "same key in both variables" rule.
   Both were rewritten and the mutants are now caught.
3. **My own test file tripped the credential scan.** It contained a key-shaped placeholder literal. The scan was not
   relaxed; the test now builds such strings at run time.
4. **Dangling links made 29 existing project tests fail.** First the memory document linked to this run record before it
   existed (6 tests), then to files in `supabase/`, which the project's test harness does not copy (the other 23). The
   harness copies only `CLAUDE.md`, `docs/project-memory`, `ops` and `.github`, so the links were turned into code
   spans and the record was added. The control was measured, not assumed: the unchanged baseline passes 561 of 561 in
   the same environment, and the branch now does too. The ops test harness was not modified.
5. **A first bundle comparison disagreed, and was explained before being trusted.** Two production builds in
   different directories differed in a webpack module id. Built from the same directory, base and branch produce
   byte-identical client JavaScript and CSS; only the random build-id folder name differs, and its two manifest files
   have identical hashes.
6. **My first browser script had wrong assumptions** (the browser's own validation stops an empty form before the
   page's message; some categories require an answer). It was corrected until it reflected how the form behaves.

## The existing quotation flow is preserved

* Since the baseline, the only changes are additions under `supabase/`, `src/lib/platform/`, `.env.example`, one
  memory document and this record, plus two scripts in `package.json`. Nothing under `src/` outside the new folder,
  `public/`, `creative/` or any configuration changed. `QuoteForm.tsx`, `whatsapp.ts`, `quote-schema.ts`,
  `types/quote.ts` and `site-config.ts` have the same blob ids as the baseline.
* A static test fails if any website file imports the platform code or a Supabase package.
* A real browser run on the production build (a synthetic WhatsApp number, set only in a scratch build) confirmed: the
  page opens with no sign-in; an empty form is refused and sends nothing; a completed form shows the confirmation and
  opens **exactly one** `wa.me` link whose message carries the name, phone and category; and no request leaves the page
  except that link, so there is no Supabase call.

## Boundaries

`main`, `claude-dev` (still the eight unpublished Reel commits, tip `187e045`), the Instagram work under `creative/`,
the staging branch (`005196a`) and draft PR 1 were not touched; no GitHub write was made. Local `main` last moved on
2026-11-01 and is simply behind `origin/main`.

## Remaining work and decisions

* Create a **development** Supabase project, apply the migrations, and complete `REAL_SUPABASE_CHECKS.md`.
* Owner decisions that the placeholders wait on: order stages (OQ-0005), the definition of fulfilled (OQ-0006), the
  earning base and rounding (OQ-0007), redemption (OQ-0008), negative balances (OQ-0010), staff roles (OQ-0011),
  financial rules (OQ-0012), guest-quote storage (OQ-0017). The deposit percentage and whether a deposit is
  refundable have **no open question yet**; a human should open one.
* Add `db:test` to the CI workflow, in its own approved change.
* This is class B/C work (protected paths). It needs the owner's approval before any merge.
