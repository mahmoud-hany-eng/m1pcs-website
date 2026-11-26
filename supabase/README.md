# M1 business platform: Supabase foundation (PLAT-0001), customer accounts (PLAT-0002), real Supabase and the admin dashboard (PLAT-0003)

This directory holds the database foundation for customer profiles, quotations, orders, payments, order tracking, a
loyalty ledger and staff roles. It is **written and tested locally only**. No Supabase project exists for it, no
credential was created, nothing was deployed, and the public website does not read any of it yet.

**Phase 2 (PLAT-0002)** adds customer sign-in and a customer dashboard on top of it, in `src/`, behind a feature flag
that is off by default (see [`docs/project-memory/architecture/CUSTOMER_ACCOUNTS.md`](../docs/project-memory/architecture/CUSTOMER_ACCOUNTS.md)).
It was first exercised against a **local emulator** (`emulator/`) that is not Supabase.

**Phase 3 (PLAT-0003)** runs the same code against the **official Supabase local stack** (Auth, REST layer, Postgres and the
mail-testing service started by the Supabase CLI in Docker; see "The official local stack" below), adds the staff **admin
dashboard** and its server-only database gateway (see [`docs/project-memory/architecture/STAFF_GATEWAY.md`](../docs/project-memory/architecture/STAFF_GATEWAY.md)),
and the owner-confirmed deposit schedule. Still **nothing is connected to a hosted project**; the checklist for the first
real project is `tests/REAL_SUPABASE_CHECKS.md`.

The design, the reasons for it and the open questions are in
[`docs/project-memory/architecture/SUPABASE_FOUNDATION.md`](../docs/project-memory/architecture/SUPABASE_FOUNDATION.md).
This file is the practical guide: layout, how to run the tests, and how the foundation is meant to be applied later.

## Layout

| Path | What it is |
| --- | --- |
| `migrations/` | Fifteen ordered SQL migrations (eleven from Phase 1; 12 and 13 the Phase 2 corrections; 14 the confirmed deposit schedule; 15 the staff gateway role, claim-code revocation and multiple links, receipts and the staff functions). Apply in file order. Each one is complete on its own and safe to read. |
| `config.toml` | Supabase CLI configuration for a **local** stack. Exposes only the `public` schema. No secret, no project reference. |
| `templates/` | The email templates: confirmation and password recovery (links carry a one-time token hash and work in any browser), and an inert "sign in with your password" message for the service's sign-in-link email, which has no link or token because the site offers no passwordless sign-in. |
| `tests/db.plat0003.test.mjs`, `tests/staff-lib.test.mjs` | PLAT-0003 database tests (deposit schedule, gateway, claim links, staff functions) and unit tests for the admin form parsing. |
| `tests/real/` | **Official-stack tests** (API, staff and gateway, and browser journeys). They need the Supabase local stack running and skip otherwise. Kept apart from the emulator tests on purpose. |
| `tests/db.test.mjs` | Database tests against a real PostgreSQL server that the harness starts and removes. |
| `tests/static.test.mjs` | File-level checks: no credential or real personal data, RLS on every table, pinned `search_path`, narrow API exposure. |
| `tests/platform-lib.test.mjs` | Unit tests for the TypeScript money helpers and the environment contract. |
| `tests/accounts-lib.test.mjs` | Unit tests for the customer-account modules (redirects, cookies, validation, claim codes, view models). |
| `tests/accounts.e2e.test.mjs` | Browser journey tests (Playwright): the real built website against the local emulator. Skipped if Playwright is not installed. |
| `emulator/` | **Not Supabase.** A mock auth and data API in front of a real local PostgreSQL with the real migrations and RLS. Synthetic data only. |
| `tests/harness.mjs`, `tests/fixtures.mjs` | Throwaway-server helper and a small cast of synthetic identities. |
| `tests/support/supabase_shim.sql` | **Test-only.** Imitates the Supabase roles and `auth.uid()` so the migrations run on plain PostgreSQL. Never a migration. |
| `tests/REAL_SUPABASE_CHECKS.md` | What a local run cannot prove, as a checklist for the first real project. |

## Schemas

| Schema | Holds | Reachable by the API roles? |
| --- | --- | --- |
| `public` | Only what a customer may see: profile, quotations, orders, agreed prices, what has been paid, published tracking updates, the loyalty ledger and balance. Every table has row level security. | Yes, through RLS. Writes happen almost entirely through staff functions, not direct inserts. |
| `private` | Supplier costs, staff and customer notes, internal payment references, the full status history with reasons, business policies, staff and roles, audit log, claim codes. | **No.** No table privilege for `anon`, `authenticated` or `service_role`. `authenticated` may execute a few helper functions that the RLS policies call. |
| `admin` | Staff functions: create an order, move its status, record a payment, publish a tracking update, set a policy, issue a claim code, and so on. | Not exposed through the API in this phase (`config.toml` lists only `public`). Each function checks the caller's permission from the staff tables. |

## Running the tests

```
npm run db:test:static   # no database needed; also needs Node 22.18+ for the TypeScript unit tests
npm run db:test          # needs the PostgreSQL server programs (initdb, pg_ctl, psql) and Node 22.18+ (212 tests)
```

```
npm run accounts:e2e    # the browser journeys; needs PostgreSQL as above, Playwright (global install is found), and builds the site if needed
npm run accounts:preview  # starts the emulator and prints how to try the dashboard in a browser, with demonstration data
```

`db:test` finds PostgreSQL under `/usr/lib/postgresql/<version>/bin`. Set `PG_BIN` to another directory if needed, and
`M1_REQUIRE_PG=1` to make a missing server an error instead of a skip. The server runs as the `postgres` user when the
tests are started as root, in a temporary directory that is removed afterwards. It listens on a unix socket only, never on the
network. The suite takes a few seconds.

What this proves, and what it does not, is stated at the top of `tests/db.test.mjs` and in
`tests/REAL_SUPABASE_CHECKS.md`. In short: migrations, constraints, RLS, privileges, transitions, ledgers, claim codes
and the staff checks are exercised for real; GoTrue, PostgREST, Realtime, the dashboard and the Supabase CLI are not.

## The official local stack (Supabase CLI and Docker)

Needs Docker and the Supabase CLI (a pinned copy is fine: `npm i supabase@3.2.0` in a scratch folder, not in this
project). Nothing here creates an online project or uses a credential: the CLI generates local-only keys for a disposable
database.

```
supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
# applies the 15 migrations to a fresh Postgres, starts Auth, the REST layer, Kong and Mailpit (http://127.0.0.1:54324)
supabase db reset                 # re-applies the migrations after you change one
npm run real:test                 # 50 API, staff and gateway tests against the real services
npm run real:e2e                  # 22 browser journeys (customers and staff, desktop and phone width); builds the site if needed
REAL_E2E_SHOTS=/some/folder npm run real:e2e   # also writes screenshots
supabase stop --no-backup
```

The tests read the stack's address and keys from `supabase status -o json` (set `SUPABASE_CLI` if the CLI is not on the path)
or from `M1_STACK_*` variables; keys are never written to a file. The staff gateway login is given a throw-away password
for the test run only, and set back to no login afterwards. They run **serially** (`--test-concurrency=1`) because they
share one database.

**This is not a test of a hosted project.** What it can and cannot prove is in
`docs/project-memory/architecture/CUSTOMER_ACCOUNTS.md` (section 9) and `tests/REAL_SUPABASE_CHECKS.md`.

`db:test` is **not** part of the GitHub Actions workflow in this phase: changing the workflow is a separate approval.
The runners already ship PostgreSQL, so adding it later is small.

## Applying this to a real project (later, and only after approval)

Not authorised or done in this phase. When it is approved:

1. Create a **development** Supabase project, separate from production, with its own keys.
2. Put the URL and the anon key in the hosting provider's settings for the Preview environment only. Never commit them.
3. Apply the migrations to the development project (for example `supabase db push` after `supabase link`).
4. Run `select count(*) from private.security_audit();`. It must return `0`.
5. Work through `tests/REAL_SUPABASE_CHECKS.md` and record the result.
6. Only then consider a production project, with its own migration review.

## Writing a new migration

* Add a new file with a later timestamp. Never edit an applied migration.
* Create every table with `enable row level security`, then grant the least privilege to the API roles. Default
  privileges in `public` grant a lot, so the migrations revoke explicitly.
* A function that runs with the owner's rights needs `security definer` **and** `set search_path = ''`, and
  `execute` revoked from `public` and `anon`.
* Put anything financial or internal in `private`. If a column's name suggests a cost, a margin or a note, the
  migration `20261118121000_security_guards.sql` audit will refuse it in `public`.
* Money is an integer count of minor units of QAR, in a column ending `_minor`.
* Business rules that the owner may change (deposit, payment gate, loyalty rates, MFA) are rows in
  `private.business_policies`, never constants in code.
* Run `npm run db:test:static` and `npm run db:test`.

## Placeholders, not decisions

**The deposit policy is no longer a placeholder: it is the schedule the owner confirmed** (15 % / 25 % / 35 % of the whole
order total, by total; see `docs/project-memory/architecture/DEPOSIT_POLICY_AUDIT.md`). The earlier flat 50 % stays in the
version history only. The tests that need round numbers use a clearly labelled TEST EXAMPLE flat schedule installed by the
test fixture, never by a migration.

The order-status vocabulary, the payment policy, the staff roles and the loyalty details beyond the earn
rate and the point value are **provisional placeholders**, marked in the data and tracked as open questions
(OQ-0005, OQ-0006, OQ-0007, OQ-0010, OQ-0011, OQ-0012). They exist so the mechanism can be built and tested. The owner
sets the real values through the policy functions, and nothing here should be read as a business decision.
