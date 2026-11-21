# Order workflow tests (layers A and B)

Automated tests of the whole M1 order workflow: quote → confirmed order → deposit → sourcing → build → ready → final payment →
delivery → loyalty points, with the refusals, the repeats and the authorization boundaries. Written 2026-11-21 against
`claude/plat-0003-admin-dashboard` at `f3e7677`, and updated for PLAT-0004 (`claude/plat-0004-order-hardening`). Every name and figure is synthetic. Nothing here touches a hosted project.

## What each layer proves, and what it does not

| Layer | File | Runs against | Proves | Does **not** prove |
| --- | --- | --- | --- | --- |
| **A. Database** | `workflow.db.test.mjs` (`npm run workflow:db:test`) | A throw-away **PostgreSQL 16** cluster with the **real migrations**, the **real staff functions** (`admin.*`) and the **real row level security** | Order lifecycle, exact money, deposit tiers, loyalty rules, refusals, repeats and races, staff permissions, customer isolation | The website; Supabase Auth; the real second factor (the harness supplies the JWT claims, as every database test here does) |
| **B. Customer website** | `workflow.customer.e2e.test.mjs` (`npm run workflow:e2e`) | A **production build** of the site in **Chromium** at **1280 × 900** and **390 × 844**, reading a local database through the **emulator** | What a customer actually sees after each staff step; exact amounts on screen; no sideways scroll on a phone; isolation in the browser and through the data API | Supabase Auth (the sign-in service is a mock with no MFA); the **staff screens** (they need a real second factor); a hosted deployment |
| **C. Idempotency** | `idempotency.db.test.mjs` (`npm run workflow:idempotency:test`) | The same real PostgreSQL 16 server, **through the real `m1_staff_gateway` role**, executing the SQL text the website sends (read from `gateway.ts`) | A repeat or retry never creates a second payment, order or loyalty entry; conflicting reuse is refused; keys are per staff member and unreadable to every API role; **real parallel sessions**, a statement timeout, a killed client and a lost response | The staff screens in a browser (they need a real second factor) |

The staff screens are therefore **not** browser-tested by these suites. Staff actions are performed by calling the real database
functions, which is where every rule is enforced. A signed-in customer is checked to have no route into `/admin`.

Requirements: PostgreSQL 16 server programs (`PG_BIN`, or on the path), Playwright with Chromium, and no network. Layer B builds the
site once (`next build`, about a minute) and reuses the build while the sources are unchanged. `M1_REQUIRE_PG=1` makes a missing
server a failure instead of a skip. `WORKFLOW_TEST_VERBOSE=1` prints every refusal message (layer A) and every page's text
(layer B). `WORKFLOW_E2E_SHOTS=<directory>` saves a few screenshots.

## Money convention

Every amount is an **integer number of QAR minor units** (QAR 1.00 = 100). The tests restate the confirmed rules in exact `BigInt`
arithmetic and compare the database and the page with it: deposit = `floor((total × rate_bps + 5000) / 10000)` with the rate
chosen by the **whole** total (≤ 300 000 → 1500 bps, ≤ 500 000 → 2500, above → 3500); points = `floor(total / 1000)`. A schema test
asserts that every `*_minor` column is an integer type and that no floating-point or `money` column exists in the public schema.

## Scenario map

| Scenario | Where | What it checks |
| --- | --- | --- |
| **S1** full lifecycle, QAR 4,350.55 (435 055) | A: *S1*; B: *S1 as the customer sees it* | Create (provisional deposit 108 764), confirm (deposit fixed at 25 %, policy v3), gate refused at 0 and at 50 000 paid, over-payment refused, Fawran 58 764 completes the deposit, every step in order, skipped steps refused, final payment 326 291 leaves balance 0 and **no points**, delivery awards exactly **435** once, delivered is final, 9 history rows, audit trail, three distinct receipts, ledgers immutable. In the browser, after every step, at both widths |
| **S2** delivered before the final payment | A and B | Delivered with QAR 1,700.00 owed: **0 points**, manual award cannot bypass; final payment awards 200 in the same transaction; repeat payment refused; repeat award returns the same entry |
| **S3** money refusals | A | Zero, negative, future-dated, unknown method, over-total, cancelled order, reversal re-closes the deposit gate, unknown ids, empty reason |
| **S4** no early points | A | Paid but not delivered, cancelled, QAR 9.99 (no entry), floor boundaries 999/1000/1999/2000, staff cannot award |
| **R4** deposit boundaries | A | QAR 3,000.00 → 450.00 (15 %); 3,000.01 → 750.00 (25 %, whole total); 5,000.00 → 1,250.00 (25 %); 5,000.01 → 1,750.00 (35 %). Stored amount, rate, policy version, preview, and a gate that refuses one dirham short and opens at the amount |
| **S5** authorization | A | Staff (10 permissions) vs owner (21): staff cannot record or reverse payments, read payments/loyalty/finance/audit/policies/staff, adjust loyalty or change policy; first-factor and no-`aal` claims get nothing; forged claims, a non-staff user and inactive staff get nothing; through the gateway role the **database re-checks the session row** (none / first factor only / someone else's / token says aal1 are all refused); nobody can write money or status directly |
| **S6** isolation | A and B | Alice vs Bob vs a stranger vs a visitor over orders, items, payments, tracking, loyalty and balances, with positive controls; no staff function, private table or write is reachable by a customer; in the browser Bob gets the identical not-found for Alice's order as for one that does not exist; the data API agrees |
| Repeats and races | A | Duplicate payment, duplicate order, duplicate adjustment, repeated transition/award/reversal; **real concurrent sessions**: two full payments → one wins; payment and delivery together (either order) → one award; two deliveries → one wins |
| Invariants | A | Over every order, payment and ledger entry left by all scenarios: paid = sum of rows, balance = total − paid, 0 ≤ paid ≤ total, reversals are exact negatives and unique, every payment and order audited once, last history row = status, balance view = ledger sum, no negative balance, one award per order |

**Mutation evidence** (migrations changed in a scratch copy, tests run, change reverted; the repository was never modified):

| Broken rule | Caught by |
| --- | --- |
| Deposit tier edge moved from 300 000 to 300 001 | R4 3,000.01 |
| Loyalty award ignores full payment | A: S2 (2 tests); B: S2 |
| Over-payment cap removed | A: 5 tests (S1, S2, S3) |
| `aal` claim no longer required | A: S5 MFA claim, gateway test |
| Gateway no longer verifies the session row | A: S5 gateway test |
| Customer ownership check always true | A: S6; B: the data-API test (the website's own filter hid it from the page test) |

## Assumptions register: behaviour the tests *pin*, not decisions the owner has made

These are current defaults. The tests record them so a change is noticed; they are **not** treated as final. The tests are tagged
`[ASSUMPTION …]`.

| Ref | Assumption pinned | Status |
| --- | --- | --- |
| OQ-0005 | The status vocabulary and its order (`pending_confirmation` … `delivered`, plus `on_hold`, `cancelled`) | Provisional |
| OQ-0006 | Points are awarded when the order is **delivered and fully paid**, whichever happens last; `orders.full_payment` gates no status, so an order **can** be delivered with a balance | Unconfirmed |
| OQ-0007 | Points = `floor(order total / QAR 10.00)` on the whole order total (delivery and service lines included) | Unconfirmed (the earn rate itself, 1 point per QAR 10, is confirmed) |
| OQ-0010 | A loyalty balance may not go below zero | Undecided |
| `admin.mfa` | A second factor is required for any staff permission | Recommended, not confirmed |

## Findings

**Defects found by the first round of testing, and fixed in PLAT-0004** (both are now ordinary passing regression tests, not TODOs):

| Id | Severity | Finding | Fix and regression coverage |
| --- | --- | --- | --- |
| DEFECT-1 | Low, customer-visible | A **Fawran** payment was shown to the customer as "**Other method**": the website's label list had no entry for it. | `fawran: "Fawran"` added in `src/lib/accounts/shared/view-models.ts`. Unit test (every method the database accepts has its own label, read from the typed list) and the browser regression in `workflow.customer.e2e.test.mjs`. |
| DEFECT-2 | Low, defence in depth | `admin.transition_order` validated the move **before** it checked the permission, so a caller signed in to the database with no permission who knew an order id was told its current status in the error text. | New forward-only migration `20261121120000_transition_order_permission_first.sql` checks `orders.transition` first. Regression test in `workflow.db.test.mjs` (stranger, customer, inactive staff, owner at aal1, forged claims, visitor). |

**Idempotency gaps found by the first round, and closed in PLAT-0004** (design: `docs/project-memory/architecture/IDEMPOTENCY.md`; proof: `idempotency.db.test.mjs`, `npm run workflow:idempotency:test`):

| Id | Was | Now |
| --- | --- | --- |
| GAP-1 | The same payment submitted twice recorded **two** payments. | A key is **required** through the gateway; an identical repeat returns the original payment and records nothing; the same key with different data is refused; races, timeouts, a killed client and a lost response record **exactly one**. |
| GAP-2 | The same order created twice made two orders. | Same, for `admin.create_order`. |
| GAP-3 | The same loyalty adjustment submitted twice made two entries. | Same, for `admin.adjust_loyalty` (no staff screen exists; the rule is the database's). |

A **key-less direct** database call (migrations, test harnesses, an owner at a SQL prompt) still behaves as before and is not deduplicated; the tests that say so are tagged `[PLAT-0004]`.

**Protected** (tested and working): a repeated receipt number, a repeated status move, a repeated award (same entry returned, unique per order), a second reversal of a payment or of an award; concurrent payments (the order row is locked: exactly one of two full payments is recorded) and concurrent pay + deliver (exactly one award).

**Observed behaviour that needs an owner decision** (recorded, **not** changed):

1. Only the **owner** can record or reverse payments; the staff role holds no `payments.record`. Intended?
2. **Reversing the final payment of a delivered order leaves the points in place** and the order delivered (the money is owed again). The owner can reverse the award by hand (`loyalty.adjust`); nothing does it automatically.
3. The automatic award writes **no audit row of its own** (the delivery or payment that triggered it is audited; manual adjustments and reversals are).
4. An order can be **delivered with a balance due** (OQ-0006); the points then wait for the final payment.
5. A reversal row carries **no receipt number**.
6. A very small order can have a deposit of **0** (rounding), and an order under QAR 10.00 earns no points and no ledger entry.
7. A refused unknown payment method surfaces the raw constraint name (`payments_method_check`) rather than a plain message.

## Not covered here (needs a different environment, not more of these tests)

The real Supabase Auth service, the real second factor, the staff dashboard in a browser, the hosted pooler/TLS path, email
delivery, and anything on the hosted Preview. Hosted ledgers are append-only, so synthetic hosted data could never be deleted;
that is why these layers run on disposable local databases only.
