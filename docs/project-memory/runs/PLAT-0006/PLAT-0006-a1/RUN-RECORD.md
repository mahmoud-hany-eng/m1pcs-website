# PLAT-0006 — run record, attempt 1 (order costs, completion dates, financial reporting, customer order history)

**Local only. Nothing was pushed, merged or deployed.** No hosted database was contacted or changed, no migration was applied anywhere but disposable local
PostgreSQL 16 databases, Production, `main`, `claude-dev`, the workflow default switch, the existing hosted synthetic orders and the Instagram creative files were not
touched. The brief is recorded as HD-0023; the design, exact definitions, edge cases and release plan are in
[FINANCIAL_REPORTING.md](../../../architecture/FINANCIAL_REPORTING.md); the owner's acceptance steps are in
[FINANCIAL_OWNER_ACCEPTANCE_CHECKLIST.md](../../../architecture/FINANCIAL_OWNER_ACCEPTANCE_CHECKLIST.md) (**not performed**: it needs the real staff second factor).

## What was built

| Layer | Files |
| --- | --- |
| Database (forward-only, additive, rerunnable) | `20261124120000_order_costs_and_completion_schema.sql`, `20261124120100_financial_reporting_functions.sql` |
| Staff gateway, API, actions, validation, types | `src/lib/staff/{gateway,api,actions,order-actions,validation,outcomes,types,finance,settle}.ts` |
| Screens | `src/components/admin/{forms,finance}.tsx`; `src/app/admin/{page,orders/page,orders/[id]/page,orders/new/page,customers/[id]/page}.tsx` |
| Tests | `financial.db.test.mjs` (51), `financial.pages.db.test.mjs` (30), `financial.layout.browser.test.mjs` (22), `finance-lib.test.mjs` (18), `compat.finance.deployed-statements.db.test.mjs` (5), nine new rules in `static.test.mjs` |
| Documents | `FINANCIAL_REPORTING.md`, `FINANCIAL_OWNER_ACCEPTANCE_CHECKLIST.md`, HD-0023, OQ-0044 to OQ-0047, the PLAT-0006 section of `supabase/release/README.md` |

## Verification (all on the final tree)

| Check | Result |
| --- | --- |
| `npm run test:db` (real PostgreSQL 16, real migrations, rendered pages, static rules) | **1082 tests, all pass** (1081 before the one revenue-versus-cash test added last; that file was rerun: 51 of 51) |
| `npm run test:browser` (customer journeys and the new desktop 1280 / phone 390 finance layout checks) | **116 of 116 pass** |
| `npm run ops:validate` | OK, 1 warning that predates this work (`OPS-0006-consumer-integrity.md` has no approval reference) |
| `npm run ops:test` | 563 of 563 pass |
| `npm run lint` | no problems |
| `npx tsc --noEmit` | clean |
| `npm run build` | compiles; all admin routes build |
| Mutation checks (twelve deliberate breakages, one at a time, in a backed-up copy of the migrations) | **12 of 12 caught** (below) |

### Mutation checks

Each breakage was applied to a copy-backed migration, the finance database and page tests were run, and the files were restored byte for byte (verified with `cmp`).

| # | Breakage | Caught by |
| --- | --- | --- |
| 1 | report groups by the date placed, not the completion date | 10 tests |
| 2 | month and year boundaries in UTC instead of Asia/Qatar | 6 tests |
| 3 | a missing cost treated as zero | 3 tests |
| 4 | `order_costs` no longer requires `finance.read` | 2 tests |
| 5 | `add_order_cost` no longer requires `finance.manage` | 2 tests |
| 6 | ordinary staff receive the cost columns of the completed-orders list | 2 tests |
| 7 | an edit no longer reopens "costs complete" | 2 tests |
| 8 | line allocation drops its remainders (with the migration's own self-check also disabled, so the test, not the build-time check, is what is proven) | the 250-case property test against a reference implementation |
| 9 | the completion date can be rewritten | 1 test |
| 10 | a completed order can change status again | 1 test |
| 11 | revenue snapshot ignores discount and loyalty credit | 2 tests |
| 12 | revenue snapshot counts cash received (a deposit becomes revenue) | the new partial-payment test |

The first mutation run **missed** numbers 8 and 12. Number 8 was a tooling error (the migration's own self-check refused to build the database, which my script
counted as zero failures). Number 12 was a real gap: every test order was paid in full before delivery, so cash and net payable were equal. A test was added
(an order delivered with only its deposit paid: revenue is the net payable, the unpaid part is reported as still owed, paying later changes nothing), and the
mutation was caught on the rerun.

## Defects found and fixed while testing

* Screenshots in a real browser showed the net-revenue figure overrunning its card at 1280 px (five columns too tight) and "provisional" written twice on the profit card.
  Fixed (three columns up to the largest width, one provisional marker) and a check was added that no amount spills out of the card or cell that holds it, at both widths.
* An edit form formatted an amount with `/ 100` and `toFixed`; it now uses the shared integer formatter, and a static rule forbids floating-point money in the finance code.
* A client form imported the staff types, against an existing structural rule; the form now defines the small shape it needs.
* Existing contract tests changed **on purpose**, each for a stated reason: the owner holds 26 permissions (was 25: `finance.verify`); `orders` has one more column
  (`completed_at`); three forms carry an idempotency key (the add-cost form sends its entry id through the same hook); the migration list has a fourth release; the CI
  script list includes the new suites; the one staff module a client form may import besides the earlier helpers is `finance.ts` (checked to be pure).

## Known limits

* The staff screens were not driven through a real login (it needs a real second factor). Pages are rendered from real database answers, and their markup and the website's
  own compiled stylesheet are checked in a real browser at both widths; the forms' write paths are proved on the real gateway statements. The owner's checklist closes the rest.
* Open accounting questions: OQ-0044 (refund after completion), OQ-0045 (who else may see costs), OQ-0046 (a completed order with a balance still owed),
  OQ-0047 (completion dates of orders delivered before this release).
* Still a **separate Production blocker, deliberately not changed here:** the legacy 6- and 7-argument `admin.create_order` overloads can create an order without the
  owner's discount and redemption rules.
* Reminders carried from the earlier release: revoke the Vercel project-scoped token; add the Supabase Auth redirect entry for the Preview URL before any customer e-mail
  flow test; clawback after a payment reversal remains unimplemented (OQ-0043); the hosted 11-argument `admin.create_order` carries the one-blank-line M2 deviation.

## Commits

Local commits on `claude/plat-0004-order-hardening`, not pushed (see `git log`).
