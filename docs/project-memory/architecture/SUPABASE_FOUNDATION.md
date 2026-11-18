# Supabase foundation for the M1 business platform (PLAT-0001, Phase 1)

**Status: implemented locally and tested locally. Not deployed. Not connected to any Supabase project.** Corrected and extended by PLAT-0002: migrations 12 and 13, and the documents `DEPOSIT_POLICY_AUDIT.md` and `ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md`. This document
describes what was built in the `supabase/` directory, why, what was tested and how, what is still a placeholder, and
what must happen next. It extends the recommendations in [ARCHITECTURE.md](ARCHITECTURE.md) (REC-PLAT-001 to
REC-PLAT-014) with a concrete database design. It records no business decision: where a rule belongs to the owner it is
stored as a changeable policy and marked as an unconfirmed default (see section 9).

The practical guide (layout, how to run the tests, how to apply the migrations later) is
`supabase/README.md`.

## 1. Scope

**In this phase:** a PostgreSQL schema, row level security, server-side functions for staff, typed TypeScript
interfaces, a money helper, an environment-variable contract, and local tests that run the SQL on a real PostgreSQL
server.

**Not in this phase, by instruction:** customer sign-in screens, an admin dashboard, loyalty redemption, any live
Supabase project, any credential, any deployment, any change to the public website. The website does not import any of
this code (a test enforces it).

*Update (PLAT-0002):* customer sign-in screens and a customer dashboard now exist, behind a flag that is off by default,
and only the account areas import this code (the test now enforces that instead). See [CUSTOMER_ACCOUNTS.md](CUSTOMER_ACCOUNTS.md).

## 2. The quotation flow is preserved

Today a visitor fills the quote form (`src/components/forms/QuoteForm.tsx`), the page builds a message
(`src/lib/whatsapp.ts`), and the browser opens WhatsApp. There is no server, no account and no database in that path,
and no registration is required.

Phase 1 changes none of it. The database is designed around the same data so a later phase can store a quotation
**behind a flag** while the WhatsApp handoff keeps working unchanged (REC-PLAT-011):

* `public.quote_categories` holds the same 18 categories as `QUOTE_CATEGORIES` in `src/types/quote.ts`. A test compares
  the two lists, so they cannot drift apart.
* `public.quotations` has a nullable `customer_id` and `guest_name`, `guest_phone`, `guest_email` columns. A quotation
  needs **either** a customer **or** a guest contact, so a visitor without an account is a first-class case.
* The category-specific answers go in `requested_specs` (JSON), exactly as the form produces them.
* How a guest quotation is written, and how long it is kept, is undecided (OQ-0017). No guest writer is wired: the
  tests show that the privileged server role can store one and that an anonymous visitor cannot write directly.

## 3. Architecture

Three PostgreSQL schemas, so that what is secret is not merely hidden but unreachable:

| Schema | Holds | API access |
| --- | --- | --- |
| `public` | Customer-safe data only, every table behind row level security | Through RLS. Writes to orders, items, tracking, payments and loyalty are not granted to any API role |
| `private` | Supplier costs, notes, internal payment references, status history with reasons and authors, policies, staff and roles, audit log, claim codes, rate-limit data | None. No table privilege for `anon`, `authenticated` or `service_role` |
| `admin` | Staff functions: create order, transition, record payment, publish tracking, set policy, issue claim code, link account, notes, costs, loyalty | Not exposed (`supabase/config.toml` lists only `public`). Each function checks the caller's permission |

Authentication is Supabase Auth: a customer is a row in `auth.users`. A **customer** (a person the business serves, who
may have come through WhatsApp and have no login) is a separate row in `public.customers`; `public.customer_accounts`
links an auth user to a customer (REC-PLAT-004). Staff are rows in `private.staff_members`.

```
auth.users ──(customer_accounts)── customers ── quotations ── quotation_lines
                                        │
                                        ├── orders ── order_items
                                        │      ├── order_tracking_events      (published by staff, customer-visible)
                                        │      ├── payments                   (append-only ledger, QAR)
                                        │      └── loyalty_ledger (via customer, one award per order)
                                        └── loyalty_ledger ── loyalty_balances (derived view)

private: order_item_costs, order_notes, customer_notes, order_status_history, payment_details,
         loyalty_entry_reasons, tracking_event_authors, quotation_internal, business_policies (+versions),
         order_status_transitions, staff_members/roles/permissions, customer_claim_codes, claim_attempts, audit_log
```

## 4. Data model

| Table | Purpose |
| --- | --- |
| `public.customers` | Profile: name, phone, email, language, delivery address, source, marketing consent, a generated code. A customer may edit only contact fields (column-level grant) |
| `public.customer_accounts` | Auth user to customer link, with how it was made (`self_signup`, `claim_code`, `admin`) |
| `public.quote_categories`, `quotations`, `quotation_lines` | The request and, once staff have quoted, the priced lines. A draft price is invisible to the customer |
| `public.order_statuses` | The status vocabulary and the customer-facing wording. Data, not code (OQ-0005) |
| `public.orders`, `order_items` | The agreed price, the deposit snapshot, the amount paid, a generated balance due, delivery details |
| `public.order_tracking_events` | What staff chose to publish to the customer (REQ-TRK-001). Append-only |
| `public.payments` | Append-only money ledger in QAR: payments, reversals, refunds. Created only when staff record a real receipt |
| `public.loyalty_ledger`, `loyalty_balances` | Append-only points ledger; the balance is derived |
| `private.*` | See section 3 |

Most tables have a surrogate UUID key (the small lookup tables use their natural key). Customers, quotations and orders also
have a short code a person can read aloud, such as `O-2611-00042` (a prefix, year and month in Qatar time, and a
sequence number), generated by the database and never by a client.

## 5. Money

Every amount is an integer count of **minor units** of QAR (1 QAR = 100), in a column whose name ends `_minor`,
with a constraint that the currency is `QAR` (REC-PLAT-008). There are no floats. One shared helper
(`src/lib/platform/money.ts`) formats and parses; it never computes a price, deposit or balance. Supplier costs may be
in QAR or USD, because stock is sourced from the U.S., but **no exchange-rate logic exists**: a margin is returned only
when every cost is in QAR and is otherwise `null` (OQ-0012).

## 6. Orders

**Status vocabulary (provisional).** `pending_confirmation`, `awaiting_deposit`, `deposit_received`, `sourcing`,
`in_transit`, `building`, `quality_check`, `ready_for_delivery`, `delivered` (terminal), `on_hold`, `cancelled`
(terminal). Each row carries a customer-facing label and description, and an `is_provisional` flag. The list is
a placeholder for the owner's real stages (OQ-0005).

**Transitions are data.** `private.order_status_transitions` lists the allowed moves. `admin.transition_order` refuses
any other move, requires the `orders.transition` permission, writes the history row (who, when, why) and keeps the
status and the history in one transaction. A held order can resume only at the status it was held from, or be
cancelled. Terminal statuses allow nothing.

**The deposit rule is a policy, not a constant, and it ships unconfigured.** The snapshot
`orders.deposit_required_minor` is computed once when an order is priced, from the owner's schedule: a percentage
(`ceil(total × basis points ÷ 10 000)`), a fixed amount, or tiers by order total, never below the policy minimum and
never above the total. A later policy change affects new orders only. The status before which the deposit must be fully
paid is part of the policy. **Migration 12 (PLAT-0002) withdrew the Phase 1 flat 50 % placeholder:** nothing in the
repository supports it (see `DEPOSIT_POLICY_AUDIT.md`), so the seeded policy is `unconfigured`, and while it is, an order
cannot be created and an existing order cannot advance. A missing policy row behaves the same way: the system **fails
closed** rather than skipping the gate or inventing a schedule.

**A quotation is not a payment.** Converting a quotation to an order does not create a payment and does not mark a
deposit paid. The order starts at `pending_confirmation` with `amount_paid_minor = 0`. A test asserts it.

**Nobody can write an order directly.** There is no INSERT, UPDATE or DELETE privilege on `orders`, `order_items` or
`order_tracking_events` for any API role, `service_role` included. In addition, a trigger on each table refuses a write
unless a transaction-local flag is set, and only the `admin` functions set it. This is defence in depth: a mistaken
grant alone would still not allow a write.

## 7. Payments

`public.payments` is an append-only ledger. A payment is a positive row; a reversal or refund is a separate negative
row that points at the payment it reverses; one reversal per payment is a unique index. `orders.amount_paid_minor` is
recomputed from the ledger inside the same function, never typed in, and a constraint keeps it between 0 and the order
total. Recording refuses a zero or negative amount, a future date and an overpayment. The customer sees amount,
method, receipt number and date. The **internal reference and internal notes** are in `private.payment_details`.

## 8. Loyalty

The ledger records every change (REQ-LOY-001). There is no balance column: `public.loyalty_balances` is a
`security_invoker` view over the ledger, so a customer reads only their own balance. Duplicates are prevented by the
database itself (REQ-LOY-005): a unique partial index allows **one award per order**, and another allows **one reversal
per award**. The award is written in the same transaction that moves the order to the awarding status, and, if full
payment is required first, in the transaction that records the final payment. Points are
`floor`, `ceil` or `round` of the base divided by the rate, per policy. The staff reason for an entry is private; the
customer-visible description is a generic sentence the system writes.

**No redemption exists in this phase.** The point value (REQ-LOY-003) is stored as a policy for later; there is no
entry type and no function that spends points.

## 9. Business policies

`private.business_policies` holds the rules the owner may change, with an append-only version history and a validation
function so a malformed value cannot be stored. Each row is marked `confirmed_by_owner` or `unconfirmed_default`
and, where it depends on a decision, names the open question.

| Key | Seeded value | Status | Depends on |
| --- | --- | --- | --- |
| `loyalty.earn_rate` | 1 point per QAR 10 | confirmed (REQ-LOY-002) | |
| `loyalty.point_value` | QAR 0.10 per point | confirmed (REQ-LOY-003) | |
| `orders.deposit` | **`unconfigured`** (the Phase 1 flat 50 % was withdrawn in migration 12; it stays in the version history) | **no schedule adopted** | no deposit rule is recorded; the owner decides (see `DEPOSIT_POLICY_AUDIT.md`) |
| `orders.full_payment` | no status requires it | **placeholder** | OQ-0006 |
| `loyalty.earning_base` | order total, rounded down | **placeholder** | OQ-0007 |
| `loyalty.award_trigger` | on `delivered`, fully paid | **placeholder** | OQ-0006 |
| `loyalty.negative_balance` | not allowed | **placeholder** | OQ-0010 |
| `admin.mfa` | required for staff | recommended | REC-PLAT-003 |

The seeded placeholders exist so the mechanism can be built and tested. They are not M1's rules. The owner sets the real
values through `admin.set_policy`, which records who changed what and why.

## 10. Staff authorization

Staff rights come only from tables (REC-PLAT-003): `private.staff_members` joined to roles and permissions. Nothing
in a JWT's `user_metadata` or `app_metadata` is read (a static test forbids it; a database test forges those claims
and shows they change nothing). A deactivated staff member has no rights. When the `admin.mfa` policy requires it, the
session must carry the `aal2` assurance level, and a missing policy means **required**.

There are 21 permissions. Two roles are seeded as **provisional** (OQ-0011): `owner` (all 21) and `staff` (ten
day-to-day permissions: customers, quotations, orders, tracking and notes; no money, costs, policies or staff
management). The owner may define the real roles.

## 11. Customers and account linking

Linking must never trust an email or a phone number someone typed (REC-PLAT-004, OQ-0003). Three safe paths exist:

1. **Self sign-up** creates a *new* customer for that user (`public.create_my_customer_profile`). It never attaches the
   user to an existing customer, even if the email or phone matches one (tested).
2. **Claim code.** Staff issue a one-time code for an existing customer (`admin.issue_claim_code`). It is 20 random
   characters, shown once, stored only as a SHA-256 hash, expires, works once, and `public.claim_customer_profile`
   returns `null` for any failure so it does not reveal why. Five failures in an hour block further tries.
3. **Explicit admin link** (`admin.link_customer_account`).

## 12. Security and row level security design

**Principles:** deny by default; the server decides prices, payments, statuses and balances; a secret is in an
unreachable schema, not behind a flag; money and points move only through append-only ledgers.

**What a signed-in customer can do:**

| Data | Read | Write |
| --- | --- | --- |
| Own customer profile | yes | contact fields only |
| Other customers' data | **no** | no |
| Own quotations and, once quoted, their lines | yes | no |
| Own orders, items, tracking updates, payments | yes | **no** |
| Own loyalty entries and balance | yes | **no** |
| Status vocabulary, quote categories | yes (also visitors) | no |
| Anything in `private` or `admin` | **no** | no |

**What is never reachable by a customer:** supplier names and costs, margins, internal payment references and notes,
staff notes about an order or a customer, the full status history with reasons and authors, draft quotation prices,
policies, other people's data, staff tables, the audit log.

**Controls, by threat:**

| Threat | Control |
| --- | --- |
| A customer reads another's data | RLS on every table; ownership resolved from `auth.uid()` through `customer_accounts`; tested with two customers, an unlinked user and a visitor |
| A customer reads a cost, margin or note | Those tables are in `private` with no API privilege; customer-facing tables have no such columns; a scan plants sentinel strings in private tables and searches every customer-visible response |
| A client sends its own price, payment or status | No write privilege; the functions take only item descriptions and prices from authorised staff and compute totals, deposits and balances in the database |
| A forged JWT claims to be an admin | Authorization reads tables, never claims |
| A privileged function is hijacked through the search path | Every `security definer` function pins `search_path = ''` (a static test and the in-database audit both check) |
| A new table or grant quietly opens a hole | `private.security_audit()` runs inside the last migration and **fails the migration** on RLS missing, an anonymous privilege, an API privilege on a private table, a writable ledger, an unpinned definer function, an anonymous-executable function, a cost-like column name in `public`, or a private table in a Realtime publication |
| A ledger is edited after the fact | Append-only triggers stop every API role, every staff function and every ordinary SQL statement, a superuser's included, and also block TRUNCATE. They do **not** stop a privileged operator who can disable a trigger or use replica mode; that limit is tested and stated in `ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md`, and the controls against it are organisational |
| A double award or double reversal | Unique partial indexes |
| A guessed claim code | 80 bits of randomness, hashed at rest, expiry, single use, rate limit |
| A staff account without a second factor | `aal2` required by policy; missing policy means required |
| A credential or real personal data committed to the public repository | Static scan of every new file for key patterns, connection strings, real emails and phone numbers; `.env.example` holds names only |

## 13. What was tested, and what was not

**Run locally, for real** (real PostgreSQL, Supabase-compatible roles imitated by a small shim): migrations apply in
order; the security audit passes; constraints; RLS isolation; the privilege model; finance separation; status
transitions and the deposit gate; policies; payments; loyalty idempotency and rounding; claim codes; staff permissions;
the typed interfaces compared with the live schema. Static checks and the TypeScript unit tests run without a database.
Exact counts and the mutation results are in the run record
([PLAT-0001-a1](../runs/PLAT-0001/PLAT-0001-a1/RUN-RECORD.md)).

**Not tested, because it needs a real Supabase project:** GoTrue issuing real tokens and the `aal` claim, PostgREST
exposing the schemas, Realtime, the dashboard settings, the Supabase CLI and `config.toml`, and the migrations run as
Supabase's `postgres` role instead of a superuser. The checklist is
`supabase/tests/REAL_SUPABASE_CHECKS.md`.

## 14. Limitations and decisions needed

1. **Placeholders are not decisions.** Order stages (OQ-0005), the definition of fulfilled (OQ-0006), the earning base
   and rounding (OQ-0007), negative balances (OQ-0010), staff roles (OQ-0011) and financial rules (OQ-0012) need the
   owner. The deposit percentage and whether a deposit is refundable have **no open question recorded yet**; a human
   should open one.
2. **The privileged server role can still write customers and quotations directly.** Orders, items, tracking, payments
   and loyalty are not writable by it, but a guest-quotation writer will need it for `quotations`, so that grant stays
   until the writer exists (OQ-0017). Phase 3 should replace it with a narrower function.
3. **A payment reversal does not roll an order back.** It lowers the amount paid and the deposit gate then applies to
   the next move; a status already reached is not undone. The safe procedure (hold the order, re-record, resume) is in
   `ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md`.
4. **Tracking updates cannot be edited or deleted, but can be retracted** (migration 13, PLAT-0002): a private record
   hides the update from the customer and keeps it for staff and for audit.
5. **The status vocabulary is in the database, but the TypeScript side treats it as plain text** by design, so a change
   of stages needs no deployment.
6. **Not in CI.** `db:test` is not part of the GitHub workflow, because changing the workflow is a protected change that
   needs its own approval.
7. **This task is class B/C work** (protected paths: `supabase/**`, `src/**`, `package.json`, `.env.example`). It needs
   the owner's approval before any merge. No task file or human-decision record was created for it, because those are
   human-controlled.

## 15. Recommendations for Phase 2 (customer authentication)

* Use **email one-time code** sign-in with an optional password, which suits customers who mostly use WhatsApp and
  rarely return (OQ-0002); keep Supabase's built-in rate limits on, and add CAPTCHA only if abuse appears.
* Use `@supabase/ssr` cookie sessions and run middleware only on the private paths (REC-PLAT-002).
* Build the claim-code screen first, because it is how existing WhatsApp customers get their history. Show the code's
  failure as one generic message.
* Require TOTP for staff before any admin screen exists; test with a real `aal2` token (checklist section 3).
* Put everything behind a feature flag so the public site is unchanged until the owner approves.
* Create a **separate development Supabase project** first, with its own keys; do not touch production (REC-PLAT-012).
  Apply the migrations there and complete the real-instance checklist before any customer data is entered.
* Add `db:test` to the CI workflow in its own approved change.
