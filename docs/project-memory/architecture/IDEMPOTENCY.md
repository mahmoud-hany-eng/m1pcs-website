# Idempotency of money and ledger operations (PLAT-0004)

Status: implemented on `claude/plat-0004-order-hardening` (local commits; the first version was pushed for review; this corrected version is
**not pushed and not applied to any hosted database**).
Migrations: `20261121120000_transition_order_permission_first.sql`, `20261121120100_idempotency_expand.sql` (the **expand** step).
Operator scripts (not migrations): `supabase/release/` (`README.md` is the runbook).
Tests: `npm run test:db` and `npm run test:browser` (see [Tests](#tests)).

## The problem

Three staff operations create a record that must exist **exactly once per intended action**: recording a payment
(`admin.record_payment`), creating an order (`admin.create_order`) and adjusting loyalty points (`admin.adjust_loyalty`). A
double click, a retry after a network timeout, or a reload after a lost response could repeat the request. Before PLAT-0004
the only protection was a disabled button and, for payments, the order-total cap (found by the workflow tests as GAP-1, GAP-2, GAP-3).

## The design

* The caller sends an **idempotency key**: a value chosen **once per intended action** and reused by every retry of it.
* `private.idempotency_keys` holds one row per `(actor, operation, key)`; the **primary key makes the claim atomic**. Two sessions
  that submit the same key at the same moment cannot both claim it: the second waits for the first to commit or roll back.
* The row stores a **SHA-256 fingerprint of the request** and the id of the record the request created. Every field of the request is in the
  fingerprint (a test changes each one under the same key): for a payment the order, purpose, amount, method, date, receipt number, reference, note
  and the **expected paid amount**; for an order the customer, every item field, the quotation, who placed it, the delivery method and address; for
  a loyalty adjustment the customer, points and reason. The **clock is not** part of it (see "Server clock").
* The claim and the operation are **one transaction**. If the operation fails, or the connection dies, the claim rolls back with it, so a
  failed attempt never uses up a key and the corrected retry works.
* A key belongs to **one authenticated staff member** (`auth.uid()`). The table has **no privileges for any API role or for the staff gateway**,
  row level security is on, and it is **append-only** (triggers refuse update, delete and truncate, even for a superuser).
* **Through the staff gateway a key is required**, and so is the expected paid amount for a payment. A direct database caller (migrations, test
  harnesses, an owner at a SQL prompt) may omit both; it then has no duplicate protection, exactly as before.

## Exact replay and expiry semantics

A key's life, precisely:

| The same key arrives… | Result | Code |
| --- | --- | --- |
| first time (no row), or after a failed first attempt (its claim rolled back) | the operation runs and the key is claimed | — |
| again with the **identical request**, less than **1 hour** after the claim, and the result **still stands** | the **original record id** is returned and **nothing is created**; the website says it was *already recorded* | — |
| again with a **different request** (any fingerprint field), at any time | refused: *"this idempotency key was already used for a different request; nothing was changed"* (names no record) | `M1K01` |
| again with the identical request, but the **payment has since been reversed** | refused: *"…has since been reversed, so it was not recorded again"* | `M1K02` |
| again with the identical request, but the **order has since been cancelled** | refused: *"…has since been cancelled, so it was not created again"* | `M1K02` |
| again with the identical request, **more than 1 hour** after the claim | refused: *"…already processed more than an hour ago and can no longer be confirmed automatically; nothing was changed. Check the record before submitting again"* | `M1K02` |

* **Keys are retained for the life of the database** (the table is append-only and never purged). An old key is therefore **never forgotten**, and can never be accepted
  again as a **new** operation: after the window the same request is refused (`M1K02`) and any other request is a conflict (`M1K01`). Nothing is ever created by an expired key.
  This is deliberate: a time-limited key store (for example 24 hours) would let an old key be forgotten and quietly reused. A retention rule can only be introduced by a separate decision.
* The **one-hour window** is a constant in `private.idempotency_claim`. It bounds how long a repeat is *confirmed as success*; it does not bound how long a key is *remembered*.
* A **payment whose request was fine but whose payment was reversed** never gets a "recorded" answer. The staff member is told to reload and check, and the form takes a new key.
* A **loyalty adjustment** is a ledger fact that has no reversal in this release, so it is answered within the window like any other repeat.
* The checks run in this order inside the function, and **the order is tested**: permission and second factor → input validation → claim/replay → order lock → business rules. A replay is therefore
  never a way around revoked access, and an unpermitted caller learns nothing about whether an order, customer or key exists.

## The expected paid amount (payments)

The payment form carries the amount already paid that the page showed (`expected_paid_minor`). The database compares it with the order's real balance **under the order's row lock, in the
same transaction as the insert**. If someone else paid, or a payment was reversed, in the meantime, the payment is **refused** (`M1K03`: *"…you saw QAR 0.00, it is now QAR 500.00; nothing was recorded. Reload the
page and check the payments before recording again"*) instead of being added to a balance the person never saw. The refused attempt leaves **no claim** behind.

* A **legitimate retry** (same key, same form) is answered **before** the expected amount is compared, so it still works after other payments moved the balance.
* The value is part of the fingerprint, so a reloaded page (a **new** decision) cannot turn a deliberate second payment into a repeat of the first. The browser enforces this too: the saved key is bound to the balance the page showed.
* Two staff members, or two tabs, who both saw `paid = 0` and both submit: exactly one is recorded, the other gets `M1K03`. (A real race test holds the first session open and proves it.)

## Duplicate-order evidence (a warning, never a block)

`admin.similar_orders(customer, items, key)` is read-only. It lists up to five of the same customer's orders from the last 24 hours, not cancelled, with the same items (same kind, description ignoring case
and spaces, quantity and price, in any order). The order **this key** already created is never listed (a retry is answered by the create itself). The website shows the evidence and a checkbox:
*"Nothing was created yet. This customer already has an order with the same items… If they really want another one, tick the box below and create the order again."* Ticking it creates the order.
**The database never rejects a valid second order**; a customer can legitimately buy the same thing twice. If the evidence query cannot run, the order is still created.

## Server clock

A payment sent without a date (the website always does) is dated by the **database clock when the first attempt runs**. A repeat returns the original payment with its original date. The fingerprint holds the *supplied* date, not the clock.

## How the website supplies the key

* The server page generates a first key with `randomUUID()` per render, so the form is complete even before the browser script runs.
* The hook `src/components/admin/use-idempotency-key.ts` (rules in `src/lib/staff/idempotency-client.ts`) keeps the key in `sessionStorage` under `m1-idem:<scope>` together with a **binding** (for a payment, the paid amount
  the page showed). A second click, a retry and a reload after a lost response send the **same** key **while the binding is unchanged**. The key is replaced when the action **succeeded**, when the database **retired** it (`M1K01`/`M1K02`), or when the binding changed. A
  validation error, a business-rule refusal, a refused stale balance (`M1K03`) and an unknown outcome **keep** it. Blocked storage (a private window) falls back to the page's own key.
* After the order form succeeds it is **locked** until the browser opens the new order.
* The server action refuses a form without a valid key (and, for payments, a valid expected amount) before any database call.

## Honest messages

`src/lib/staff/outcomes.ts` holds every sentence. "Nothing was changed" is said **only where it is true**: the database answered with an error (it rolled back), or the connection broke before `COMMIT` was sent. When `COMMIT` was
sent and its answer never arrived, the website says *"may or may not have been saved… If you send the same form again within the hour, it will not be saved twice"* and keeps the key. A real-connection test with a fault-injecting proxy
proves both sides: **COMMIT delivered, answer lost → the payment is saved and the retry is answered with the original**; **COMMIT never delivered → nothing is saved and the retry records exactly once**.
A first save says *"recorded"*; a repeat says *"already recorded earlier, so nothing new was recorded"*.

That test also found and fixed a real defect in the gateway: a connection that died mid-request made the driver emit an `error` event on the checked-out client with no listener, which Node treats as an **uncaught
exception** (it would have taken the server process down). The event is now absorbed; the failure still reaches the screen as a rejected query.

## Release shape: expand, then contract

The first version rewrote the three existing functions as wrappers that delegate with a `NULL` key. That made the **old (PLAT-0003) website fail closed** the moment the migration was applied. It is now two steps:

1. **Expand** (migration `20261121120100`): **additive and rerunnable only**. The three PLAT-0003 write functions are **byte-identical** afterwards (tested by hash); new overloads, the claim helper, the key table and `similar_orders` are added. The deployed website keeps working; the new website works; both can run at the same time on the same order.
2. **Contract** (`supabase/release/idempotency_contract.sql`, operator-run, **guarded**): turns the three old functions into delegations that the gateway refuses, so nothing can bypass the key. It **refuses to run** unless the operator states `set m1.confirm_contract = 'old-website-retired';` in the same session, and says why. See `supabase/release/README.md`.

Undo scripts restore the deployed definitions **byte for byte** and delete no data; the key table is kept. A failed migration applied as one query changes nothing; one applied statement by statement is repaired by running it again (both tested).

## Privileges

New overloads: executable by `authenticated` and the staff gateway only (revoked from PUBLIC, anon and service_role). The claim helper and key table: nobody. The migration ends with checks of the table's shape, these privileges, and the platform's `private.security_audit()` and `private.gateway_audit()`; any violation fails (and so rolls back) the migration.

## What this does not do

* It does not deduplicate a key-less **direct** database call (by design; the gateway is the only production path).
* Two **different** keys with identical data are two intended actions (two QAR 200 instalments). The order-total cap and the expected paid amount limit them.
* It does not cover other operations (a status move, a tracking update, a payment reversal): those already refuse a repeat by their own rules.
* It does **not** implement any compensation of loyalty points when a payment is reversed: that policy is still undecided ([PROPOSAL_PAYMENT_REVERSAL_AND_LOYALTY.md](PROPOSAL_PAYMENT_REVERSAL_AND_LOYALTY.md)).
* `admin.adjust_loyalty` has no staff screen and is not in the gateway's fixed statement list; the rule is in the database, so a future screen inherits it.
* The staff screens cannot be driven in a browser without a real second factor; the hook, the actions' wiring, the gateway and the messages are each tested directly instead.

## Tests

| Suite | Command | What it proves |
| --- | --- | --- |
| `idempotency.db.test.mjs` | `npm run workflow:idempotency:test` | replay, conflict, races, timeouts, killed client, lost response, isolation, privileges (expand state) |
| `idempotency.window.db.test.mjs` | `npm run workflow:window:test` | reversed/cancelled/expired repeats, exact expiry, expected paid amount, two staff and multiple tabs, duplicate evidence, security ordering, fingerprint coverage |
| `release.db.test.mjs` | `npm run release:db:test` | expand on a copy of the deployed structure, old/new coexistence, contract guard, undo scripts, failure and recovery |
| `gateway-outcomes.db.test.mjs` | `npm run gateway:outcomes:test` | the website's own gateway code over a real connection with a fault-injecting proxy: accurate messages, honest unknowns |
| `idempotency.hook.browser.test.mjs` | `npm run workflow:hook:test` | the real hook in a real browser with real `sessionStorage` |
| `supabase/tests/mutation/run-mutations.mjs` | by hand | 27 deliberate breakages of these rules, each caught by a suite |

CI runs `npm run test:db` (disposable local PostgreSQL started by the tests themselves: no hosted database, no service container, no secret) and `npm run test:browser` (a pinned Playwright installed for that job only). A static test fails if a suite is left out of both scripts.
