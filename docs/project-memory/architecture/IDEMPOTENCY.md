# Idempotency of money and ledger operations (PLAT-0004)

Status: implemented on `claude/plat-0004-order-hardening` (local branch, not pushed, not applied to any hosted database).
Migrations: `20261121120000_transition_order_permission_first.sql`, `20261121120100_idempotency_keys.sql`.
Tests: `supabase/tests/idempotency.db.test.mjs` (`npm run workflow:idempotency:test`), plus the unit and layer A/B suites named below.

## The problem

Three staff operations create a record that must exist **exactly once per intended action**: recording a payment
(`admin.record_payment`), creating an order (`admin.create_order`) and adjusting loyalty points (`admin.adjust_loyalty`). A
double click, a retry after a network timeout, or a reload after a lost response could repeat the request. Before PLAT-0004
the only protection was a disabled button and, for payments, the order-total cap (found by the workflow tests as GAP-1, GAP-2, GAP-3).

## The design

* The caller sends an **idempotency key**: a value chosen **once per intended action** and reused by every retry of it.
* `private.idempotency_keys` holds one row per `(actor, operation, key)`; the **primary key makes the claim atomic**. Two sessions
  that submit the same key at the same moment cannot both claim it: the second waits for the first to commit or roll back.
* The row stores a **SHA-256 fingerprint of the request's data** and the id of the record the request created.
* **Same key, same data** → the original record id is returned and **nothing is created** (no payment, receipt, order, items,
  history row, ledger entry or audit row).
* **Same key, different data** → refused: *"this idempotency key was already used for a different request; nothing was changed"*.
  The refusal names no record, so it discloses nothing about the original.
* The claim and the operation are **one transaction**. If the operation fails, or the connection dies, the claim rolls back with it, so a
  failed attempt never uses up a key and the corrected retry works.
* The replay check comes **before** the order's or balance's current state is examined, so a retry still succeeds after the order was
  paid in full, put on hold or cancelled, or after the loyalty balance changed. The retry is not a new payment, so those rules do not apply to it.
* A key belongs to **one authenticated staff member** (`auth.uid()`), and the fingerprint includes the customer, order and amounts the request
  is about. A key can never return another person's record: a different staff member's key is a different key; the same key with another
  customer, order or amount is a conflict, not a lookup.
* The table has **no privileges for any API role or for the staff gateway**, row level security is on, and it is **append-only** (triggers refuse
  update, delete and truncate, even for a superuser). Only the `SECURITY DEFINER` staff functions touch it.
* **Through the staff gateway a key is required.** A request without one is refused (*"an idempotency key is required; reload the page and
  try again"*). A direct database caller (migrations, test harnesses, an owner at a SQL prompt) may still omit the key; it then has the same
  behaviour as before and no duplicate protection.

## How the website supplies the key

* The server page (`/admin/orders/new`, `/admin/orders/[id]`) generates a first key with `randomUUID()` and passes it to the form, so the form is
  complete even before the browser script runs.
* The form keeps the key in `sessionStorage` (`m1-idem:<scope>`), so a second click, a retry after a timeout and a reload after a lost response all
  send the **same** key. The key is replaced only when the action **succeeded**, or when the database says the key already belongs to a different
  request. A validation error, a business-rule refusal or a network failure keeps it.
* The server action refuses a form without a valid key before any database call. The key's shape (`^[A-Za-z0-9._:-]{8,100}$`) is the same in the
  website and in the database; a test compares the two.
* The gateway's fixed statements carry the key (`create_order` parameter 5, `record_payment` parameter 7).
* The existing "disabled button while the request runs" stays as the first, cosmetic layer.

## What changed in the database, and why it is forward-only

A static test forbids any `DROP` in a migration, so nothing is dropped. For each operation a **new overload** takes the key as one extra, required,
trailing parameter; the **existing signature keeps its name, parameters, defaults and privileges**, and its body becomes a one-line delegation to the
new overload with a `NULL` key. All the rules live in one implementation. The new overloads have the same privileges as every other `admin`
function (PUBLIC and anon may not execute; `authenticated` and the gateway may; each function checks its own permission and the second-factor rule first),
and the migration fails if that is not so. Business rules, the 15 / 25 / 35 % deposit tiers, the loyalty earning rate, delivery rules, monetary arithmetic and the
append-only ledgers are untouched.

`20261121120000_transition_order_permission_first.sql` replaces `admin.transition_order` so that the permission is checked **first** (DEFECT-2). Before,
a caller who was signed in to the database but had no permission and knew an order id could learn that the order exists and its current status from the error text.

## Deployment order (important)

The website and the database change together. The **migration alone** makes the **old** website fail closed: its payment and order statements carry no key and the gateway
refuses them (a test runs the old statements and proves it). The **new website alone** against the **old** database fails to call the new statements. So both must be
released together, migration first or within the same release window. Neither has been applied to any hosted database; applying a migration needs its own approval.

## What this does not do

* It does not deduplicate a key-less **direct** database call (by design; the gateway is the only production path).
* Two **different** keys with identical data are two intended actions (for example two QAR 200 instalments). The order-total cap still limits payments.
* It does not cover other operations (a status move, a tracking update, a payment reversal): those already refuse a repeat by their own rules
  (a repeated transition is refused; a payment can be reversed only once; an award is unique per order).
* Keys are kept forever (append-only, tiny rows). A retention rule can be added later without changing the guarantees.
* `admin.adjust_loyalty` has no staff screen and is not in the gateway's fixed statement list; the rule is in the database, so a future screen inherits it.
