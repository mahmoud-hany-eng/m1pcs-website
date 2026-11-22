# Order workflow v2 (the owner-defined order status and tracking workflow)

Status: implemented and tested locally on the PLAT-0004 branch. **Nothing in this document has been applied to a hosted database,
deployed, or pushed.** The owner's definition replaces the provisional status vocabulary of `20261118120400` (OQ-0005).

## 1. The workflow

```
Order received → Awaiting deposit → Deposit confirmed → Order confirmed → Live tracking
   → Order arrived in Qatar → Carrier delivering order to M1
         ├─ Custom PC build:  M1 is building your PC → Final quality checks ─┐
         └─ Parts only:       Items arrived at M1 → Awaiting scheduling       ├→ Ready for delivery or pickup → Delivered / Collected
                              for pickup or delivery ─────────────────────────┘
On hold and Cancelled are the exceptional states.
```

### Status codes (`public.order_statuses`, data, not code)

| Code | Customer wording | Used by |
| --- | --- | --- |
| `pending_confirmation` | Order received | both workflows |
| `awaiting_deposit` | Awaiting deposit | both |
| `deposit_received` | **Deposit confirmed** (code kept, wording changed) | both |
| `order_confirmed` | Order confirmed | v2 |
| `live_tracking` | Live tracking | v2 |
| `arrived_in_qatar` | Order arrived in Qatar | v2 |
| `carrier_delivering` | Carrier delivering order to M1 | v2 |
| `building` | M1 is building your PC | both (v2: custom build only) |
| `quality_check` | Final quality checks | both (v2: custom build only) |
| `items_arrived` | Items arrived at M1 | v2, parts only |
| `awaiting_scheduling` | Awaiting scheduling for pickup or delivery | v2, parts only |
| `ready_for_delivery` | Ready for delivery or pickup | both |
| `delivered` | Delivered / Collected | both |
| `on_hold`, `cancelled` | On hold, Cancelled | both |
| `sourcing`, `in_transit` | Sourcing your parts, On its way to Qatar | **earlier workflow only** (still flagged provisional) |

No code was removed or renamed. (`items_arrived` has no digit because the code format is letters and underscores.)

### Permitted moves

Version 2 (`private.order_workflow_transitions`, `branch` = `any` or the one fulfilment type the move belongs to):

* the straight path above; `carrier_delivering → building` only for `custom_pc_build`, `carrier_delivering → items_arrived` only for `parts_only`;
* `quality_check → building` (rework after a failed check, as in the earlier workflow);
* `on_hold` from every status from `awaiting_deposit` to `ready_for_delivery`; `cancelled` from every status before `delivered`;
* a held order resumes **only at the status it was held from**, or is cancelled;
* `delivered` and `cancelled` have no further move.

Version 1 keeps `private.order_status_transitions` exactly as it was.

The dropdown and the database cannot disagree: `private.order_next_statuses` builds the list, `private.transition_block_reason` states why a
listed move is not available yet, and `admin.transition_order` enforces the very same rules and raises the very same words.

## 2. Payment and deposit rules (unchanged, and one tightening)

* Tiers are untouched: up to QAR 3,000 → 15 %, above 3,000 up to 5,000 → 25 %, above 5,000 → 35 % of the whole total, fixed when the order is confirmed (`awaiting_deposit`).
* **Deposit confirmed needs the recorded deposit.** A version-2 order is held to "deposit paid" from `deposit_received` onward whatever the
  deposit policy's own gate says (`least(policy gate, deposit_received)`), so no policy value can let Deposit confirmed be reached on a promise.
  Staff record payments only as the owner (`payments.record`); moving the status is a separate staff step; a reversal that drops the paid amount below the
  deposit blocks advancing **and resuming** until the deposit is whole again.
* **Order confirmed is a separate acknowledgment** after Deposit confirmed; it records no payment.
* Ledgers, receipts, idempotency keys, the expected-paid check, owner-only payments, MFA, TLS and RLS are unchanged. Loyalty is still awarded by the existing routine
  (`loyalty.award_trigger`: status `delivered`, full payment required), exactly once, never earlier.

## 3. Fulfilment type

`public.orders.fulfillment_type` is `custom_pc_build`, `parts_only`, or NULL (not chosen: every existing order). It is **never inferred** from items or free text.
Staff choose it with `admin.set_order_fulfillment_type` (audited; `orders.transition`). A version-2 order cannot leave `carrier_delivering` without it; the dropdown
shows both branches blocked with the reason. It can be corrected until the order enters its branch, and is then locked by the function **and** by a trigger. A table
check (`orders_branch_consistent`) makes a branch status without the matching type impossible.

## 4. Live tracking: one status, nested updates

* Staff publish with `admin.publish_tracking_update(order, title, message, location, occurred_at)`: where the shipment is and when it happened are typed by staff.
  **Nothing is generated**: entering Live tracking creates no update and no location (a test asserts zero rows).
* Accepted **only while the order is in `live_tracking`** (version 2). Before it starts: refused. While held: refused until resumed. Cancelled: refused.
  `admin.publish_tracking_event` (the earlier signature) applies the same rule on version-2 orders.
* After it ends, history stays readable (customer RLS is unchanged: own order, not withdrawn). A new entry is a **correction**:
  `admin.publish_tracking_correction`, permission `tracking.correct` (**owner only**), a reason of 3–500 characters (private, `private.tracking_event_corrections`),
  optionally pointing at the update it corrects. The customer sees it marked "Correction"; the original is untouched.
* Withdrawing an update (`retract_tracking_event`) is unchanged and available in every phase; the row is never deleted. Authors stay in `private.tracking_event_authors`;
  the staff view now shows who published each update.
* The tracking history is append-only, including the new columns and the corrections table.
* `tracking_phase` (`not_started`, `live`, `paused`, `ended`, `cancelled`; NULL on the earlier workflow) is computed by the database and returned by `get_order`.

### How it is drawn

`src/lib/workflow/timeline.ts` builds one model (stages with `done` / `current` / `upcoming`, the nested updates, the newest marked "Latest"). The staff dashboard
(`/admin/orders/[id]`) and the customer tracker (`/account/orders/[ref]`) both draw it with `src/components/workflow/WorkflowTimeline.tsx`; the staff page hands in the
staff-only controls through slots, the customer page hands in none. Live tracking is a native `<details>` element: it expands and collapses by mouse or keyboard with no
script, is open while the order is in Live tracking, and is collapsed afterwards with a one-line summary ("3 updates · Latest: …"). Updates are ordered by when the event
happened (then when it was published, then id). Which stage owns the nested updates is data (`order_workflow_stages.shows_tracking`), not a status code in the code.

## 5. Existing orders: the compatibility strategy

1. **Expand only.** Migration 1 adds columns/tables/data; migration 2 replaces functions with `create or replace` (same names, signatures, owners, privileges). Nothing is
   dropped, renamed, deleted or re-coded. Every existing order gets `workflow_version = 1` and keeps its status, history, payments, receipts, tracking updates and loyalty.
2. **Release switch.** `orders.workflow` (`default_version`) ships as **1**, so the deployed website keeps creating earlier-workflow orders. The owner switches it to 2 with
   `admin.set_policy` **after** the new website is live; switching back is the same call. An order's own version only ever moves 1 → 2.
3. **Version-1 orders keep working exactly as before** (their transition table, their flat tracking list, their pages). `get_order` still returns every old key.
4. **Deliberate, per-order, owner-only adoption** (`admin.adopt_new_workflow`, permission `orders.adopt`, reason required, audited, one history row added, nothing else touched):

   | Earlier status | Placed at (default) | Other choices | Needs type |
   | --- | --- | --- | --- |
   | `pending_confirmation`, `awaiting_deposit`, `deposit_received` | same | | no |
   | `sourcing` | `order_confirmed` | | no |
   | `in_transit` | `live_tracking` | `arrived_in_qatar`, `carrier_delivering` | no |
   | `building` | `building` (custom build) | `items_arrived` (parts only) | **yes** |
   | `quality_check` | `quality_check` | | **yes** (custom build) |
   | `ready_for_delivery`, `delivered` | same | | no |
   | `on_hold`, `cancelled` | **not moved** (resume first; cancelled stays) | | |

   Adoption applies the version-2 payment rules: nothing at or beyond Deposit confirmed without the recorded deposit. It creates no tracking update, records no payment,
   awards no loyalty. **The synthetic order O-2611-00001** (in transit, fully paid, two payments, four updates, no loyalty) is placed in Live tracking with its four updates
   nested; a test builds that exact shape and compares payments, receipts, updates (ids, authors, times), money and loyalty before and after.

## 6. Security properties

* Customers read `order_workflow_stages` (signed-in only; anonymous visitors cannot) and the workflow/type of **their own** orders only; transitions, the adoption map,
  authors, retractions, corrections and reasons are private. No table is writable by an API role. The security and gateway audits report nothing.
* Four new staff functions (`set_order_fulfillment_type`, `publish_tracking_update`, `publish_tracking_correction`, `adopt_new_workflow`) are executable by signed-in staff
  sessions and the staff gateway only; each checks its permission **first**. Two new permissions, `tracking.correct` and `orders.adopt`, are **owner only**.
* MFA (aal2), staff activity, TLS and RLS are unchanged; a customer, a deactivated staff member, a session without the second factor and forged claims are refused.

## 7. Release sequence (nothing below has been done; every hosted step needs its own owner authorization)

**Why the order matters.** The PLAT-0004 branch is connected to Vercel: **every push to it builds and deploys a new Preview automatically**, and the Preview talks to the
hosted development database. A push therefore publishes website code that calls database functions (`publish_tracking_update`, `set_order_fulfillment_type`, ...). If the
push came first, staff would hit "function does not exist" on those screens until the database caught up. So the database is expanded FIRST, while the earlier website is
still live, and the push comes second. Production is not involved in any step (it deploys from `main` only, and the customer-account and staff features are off there).

| # | Step | Gate | What changes | If it goes wrong |
| --- | --- | --- | --- | --- |
| 0 | Local verification (done): the full suites, the differential compatibility test, the hosted-fingerprint comparison | none | nothing hosted | fix locally |
| 1 | **Pre-flight (read-only)** on the development database: migration list is exactly the 17 expected; the fingerprints in section 9 equal the expected values; `orders.workflow_version` does not exist; O-2611-00001 figures as recorded; `security_audit()` and `gateway_audit()` return nothing | owner authorization **A** covers 1 to 5 | nothing | stop |
| 2 | Apply migration `...120000_order_workflow_v2_schema.sql` (atomic) | A | additive: columns, tables, statuses, stage data, permissions, switch = 1 | it rolled back, nothing applied; or rerun (it is rerunnable) |
| 3 | Apply migration `...120100_order_workflow_v2_functions.sql` (atomic) | A | five functions replaced (same signatures), four added | the earlier website works with only step 2 applied (proved by the differential test, "between the two migrations"); or run the guarded undo script |
| 4 | **Post-flight (read-only)**: the checks in section 9, O-2611-00001 unchanged, `workflow_version <> 1` count = 0, switch = 1, audits clean | A | nothing | undo script (functions + switch); the additive data stays |
| 5 | Open the still-live earlier Preview as the synthetic customer and as staff; look at the order list, the order page and the status dropdown | A | nothing | see "the earlier website's counter" below |
| 6 | **Push the reviewed commit once** (no further pushes until verified): GitHub CI runs, Vercel builds the new Preview | owner authorization **B** | the new website replaces the earlier one at the branch address | redeploy the previous deployment; the database stays expanded and compatible |
| 7 | Verify CI green, Preview READY in `bom1`, then the new Preview with the existing synthetic orders (all still earlier-workflow) | B | nothing | as above |
| 8 | **Adopt O-2611-00001** (owner, through the order page card or an authorized call) and check its figures, updates, history and page | owner authorization **C** | one order | none needed: adoption keeps everything; it cannot be undone per order |
| 9 | **Acceptance testing with the switch still at 1**: create a few synthetic orders (they are earlier-workflow), adopt each, and walk them through the whole new path on the real stack: a custom build, a parts-only order, hold / resume, a correction after Live tracking, a customer view | C | synthetic orders only | cancel the synthetic orders |
| 10 | **Switch to 2** (`admin.set_policy('orders.workflow', {"default_version": 2}, ...)`), create one new order, confirm it is workflow 2 | owner authorization **D** | new orders only | set it back to 1 |

Steps 6 to 10 should follow steps 2 to 5 without a long pause (see the next paragraph). Acceptance testing (9) is done by adopting, rather than by flipping the switch first, so the
switch is turned on only after the whole workflow has been exercised on the real stack.

**The earlier website's counter (the one visible effect of step 2 to 6).** Rendered for real (the deployed code against the expanded database), a customer of the earlier website sees
**no name of any new stage**, but the progress counter counts every status in the table: an in-transit order that read "Stage 5 of 9" reads "Stage 9 of 15". It corrects itself
the moment the new website is live (step 6), because the new website counts each order's own stage list. Customers are synthetic test accounts and the window is the time between steps 2 and 6, so
it is accepted; keep it short. An optional hardening (hiding the new statuses from customers until the switch is flipped) is in section 10 and is NOT recommended unless the earlier Preview must stay
in use for long. After an order is adopted, the earlier website would show that order's new status name with an inflated counter: the earlier website must be gone (step 6) before step 8.

Undo summary: website, redeploy the previous deployment; switch, set it back to 1; functions, `supabase/release/order_workflow_v2_rollback.sql` (refuses while any order is on workflow 2).

## 8. Tests

`workflow.v2.db.test.mjs` (database: sequence, every move, deposit gate and boundary, branches, hold/resume/cancel, tracking permissions and phases, corrections, RLS, adoption incl. the exact hosted
synthetic-order figures, loyalty, duplicates, audits, rerunnable migrations, the undo script, and the `[OBSERVED]` business-integrity observations), `compat.differential.db.test.mjs` (the migrations change
no earlier write path), `workflow-lib.test.mjs` (timeline model, status view, form validators, the component rendered to HTML), `workflow.v2.customer.e2e.test.mjs` (production build, real browser at 1280 and
390 px: nesting, expand/collapse by mouse and keyboard, branches, hold/cancel, adoption, who sees what), plus the updated contract assertions in `db.test.mjs`, `workflow.db.test.mjs`, `release.db.test.mjs`
and `static.test.mjs`. `supabase/tests/mutation/run-workflow-mutations.mjs` breaks 37 rules one at a time and requires a suite to fail for each (run by hand).

## 9. Release-readiness verification (local; nothing hosted was changed)

* **The control equals the hosted database.** Read-only queries on the development database and the same queries on the local "migrations up to the idempotency expand" database
  return identical fingerprints (md5): the 15 earlier staff functions and their privileges (`transition_order` `ce5fd8fb…`, `publish_tracking_event` `43d3ef4b…`, `get_order` `6e27cf9b…`,
  `list_orders` `01f5bbc4…`, `dashboard_summary` `a3f45d9e…`, `record_payment` (10-arg) `f1133f0f…` and (8-arg) `4ae471f5…`, `create_order` (7-arg) `20f2d1c5…` and (6-arg) `e7e7c703…`,
  `adjust_loyalty` (4-arg) `748ac737…` and (3-arg) `e46441ad…`, `similar_orders` `0c4467d6…`, `retract_tracking_event` `4e53f52d…`, `reverse_payment` `fb22724a…`, `award_loyalty_for_order` `0ff3d2db…`),
  the 11 statuses `01c15f64…`, the 33 transitions `61f0725a…`, the 20 `orders` columns `b951be0f…`, the 6 `order_tracking_events` columns `06a5868f…`, the 8 policies `653d59ff…`, and the 31 role permissions `23f3cd72…`.
  So the differential test below really compares against what is hosted.
* **Differential test (`compat.differential.db.test.mjs`).** One identical script of earlier-workflow operations (keyed and key-less orders and payments, replays, conflicts and stale-balance refusals,
  every status move, the deposit gate, hold / resume / cancel, loyalty awards and adjustments, reversal, tracking publish and withdraw, and every permission refusal) runs on the control, on the
  state between the two migrations, and on the full result. All three transcripts (43 successes and 27 refusals), the resulting rows (orders, payments and receipts, history, tracking, loyalty, audit
  actions, idempotency keys), the earlier fields of the read functions, every function signature and privilege, and the audits are **identical**. The only differences are the documented ones: wording of
  five statuses, a held order's dropdown, additive keys, two owner permissions. Three mutations of an earlier path are all caught.
* **The deployed code on the expanded database.** The earlier website's own database, gateway and customer-browser suites (281 tests) pass against the new migrations; the single failure is the owner
  permission count (21, now 23).
* **O-2611-00001 on the hosted database (read-only)**: `in_transit`; total QAR 4,350.55 (435055), one item summing to it; deposit QAR 1,087.64 (108764, 25 %, tier 2 of 3, gate `deposit_received`); paid in full;
  two payments, 108764 (deposit, Fawran, receipt R-2611-00001) and 326291 (balance, Fawran, receipt R-2611-00002), two distinct receipts, summing to the total; four tracking updates; five history rows, every
  one with its actor recorded; no loyalty entry; delivery method not decided. The same figures are rebuilt locally from scratch, adopted, and compared field by field (payments with receipt and date, updates with
  author and time, money, history) before and after; adoption changes only the status, the workflow and adds one history row, awards nothing, and loyalty is later awarded once (435 points) at Delivered / Collected.
* **Nothing is migrated silently.** No migration updates an order (a static test), the differential test shows every order unchanged, and adoption is a per-order, owner-only, reasoned, audited call.

### Findings from the business-integrity review (recorded as `[OBSERVED]` tests; deliberately NOT changed in this release)

* **Delivery method.** An order whose delivery method is still "Not decided" can reach Ready for delivery and Delivered / Collected: nothing checks it, and no staff function can set the method after the
  order is created (it is given only at creation; O-2611-00001 itself is "Not decided"). See proposal P2.
* **The dashes in "By" and "Recorded by".** Not an attribution defect. The actor of every status move, payment and audit entry IS recorded (the user id; confirmed on all five history rows and both payments
  of O-2611-00001). The screens show the staff member's *display name*, and that staff row has none, so the screen shows a dash. Setting the name with the existing owner function `admin.set_staff_member` makes the unchanged
  history show it (tested); no audit data is rewritten. See proposal P3.

## 10. Proposals (NOT implemented; each needs the owner's decision)

* **P1. Choose Custom PC build / Parts only when the order is created (recommended).** Today the type is chosen on the order page after creation (the page shows "Not chosen yet" and the dropdown blocks both branches
  until it is set). To choose it at creation atomically, `admin.create_order` needs the type in its idempotency fingerprint, and it is called by the deployed website with a fixed seven-argument signature, so this means
  a new **eight-argument overload** (required type, no default, so no ambiguity with the seven-argument one), a copy of the keyed create path with the type stored in the same transaction, one new read (`admin.workflow_default`)
  so the form shows the field only when new orders are workflow 2, the form field with no default selection, validation, gateway call, and tests (replay, conflict on a different type, permission, the differential test extended).
  That touches the idempotent order-creation path, so it is a significant migration change and was not done. A two-call shortcut (create, then set the type) was rejected: it has a partial-failure state.
  Legacy orders stay compatible (type NULL) and nothing is inferred from item descriptions.
* **P2. Delivery method.** Add an owner/staff function to set the method (and address) after creation, and require a decided method before **Ready for delivery** on workflow 2 (shown in the dropdown with the reason like the
  deposit rule). Adoption of an earlier order would be unaffected until it moves again. Needs the owner's decision on *where* the method is required (before "Awaiting scheduling" is left, before Ready, or before Delivered).
* **P3. Staff names on screens.** (a) Set `display_name` for each staff member with the existing `admin.set_staff_member` (a data change). (b) Optionally show a fallback such as "Staff member ·8f3a" when a name is blank, in
  `get_order`, `list_payments`, `list_audit` and `list_policy_versions`.
* **P4. Earlier website's counter (optional hardening).** Hide the six new statuses from customers' reads (row level security) until the release switch is 2 or a workflow-2 order exists, so the earlier website shows exactly what it
  showed before. It adds a policy and a helper function to a public reference table and needs security-audit exceptions; not recommended for the short window described in section 7.

