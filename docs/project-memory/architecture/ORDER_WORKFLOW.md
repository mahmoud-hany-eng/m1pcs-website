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

## 7. Release sequence (nothing below has been done)

| Step | Action | Who | Effect on the deployed website |
| --- | --- | --- | --- |
| 1 | Merge/push the branch and let CI pass | operator | none |
| 2 | **Expand:** apply migrations `20261122120000` and `20261122120100` to the **development** database | operator | The deployed website keeps working (cosmetic only: the old customer progress bar counts the extra reference rows, e.g. "Stage 9 of 15", until step 3) |
| 3 | **Deploy** the website of this branch to the Preview | operator | Customer pages use each order's own stage list; staff pages show the timeline. Orders are still earlier-workflow |
| 4 | Verify on the Preview with the existing synthetic orders (read-only) | operator | none |
| 5 | **Adopt** the synthetic order O-2611-00001 (owner, one order) and check its page | owner | one order changes |
| 6 | **Cutover:** `admin.set_policy('orders.workflow', {"default_version": 2}, …)` | owner | new orders follow the owner-defined workflow |
| 7 | Later: adopt remaining earlier-workflow orders one by one, then (separate decision) plan retiring `sourcing` / `in_transit` | owner | |
| Undo | Website: redeploy the previous deployment. Policy: set `default_version` back to 1. Functions: `supabase/release/order_workflow_v2_rollback.sql` (refuses while any order is on workflow 2) | | |

The website of this branch writes through the new functions (`publish_tracking_update`, …), so **apply the database step first**. Customer pages degrade gracefully against a
database without the stage table (they log the failing step and show the order as before); staff pages show the flat list.

Production is not involved in any step.

## 8. Tests

`workflow.v2.db.test.mjs` (database: sequence, every move, deposit gate and boundary, branches, hold/resume/cancel, tracking permissions and phases, corrections, RLS, adoption,
loyalty, duplicates, audits, rerunnable migrations, the undo script), `workflow-lib.test.mjs` (timeline model, status view, form validators, the component rendered to HTML),
`workflow.v2.customer.e2e.test.mjs` (production build, real browser at 1280 and 390 px: nesting, expand/collapse by mouse and keyboard, branches, hold/cancel, adoption, who sees what),
plus the updated contract assertions in `db.test.mjs`, `workflow.db.test.mjs`, `release.db.test.mjs` and `static.test.mjs`.
