# Order costs, completion dates and financial reporting (PLAT-0006)

Status: implemented and tested locally on the PLAT-0004 branch (`claude/plat-0004-order-hardening`). **Nothing in this document has been applied to a
hosted database, deployed, or pushed.** The owner's brief is recorded in HD-0023.

Four things were added, and they are kept apart on purpose:

1. **Private direct costs of an order**, editable at any stage, with an immutable revision history (owner only).
2. **A completion date** (`orders.completed_at`) that the database records the first time an order reaches Delivered / Collected. Reports are grouped by it.
3. **Financial reporting in the database**: net revenue, direct cost, order profit, margin, by Qatar month and year, over every order.
4. **Two views for staff**: a simplified Overview and a customer order history that leads with the final net payable.

Nothing existing was replaced. The Pricing & Rewards system, the five deposit tiers, loyalty redemption, payments and receipts, Workflow V1 and V2, the
idempotency ledger, the workflow release switch and every existing order and ledger row are as they were.

## 1. Exact financial definitions

Every amount is an integer count of QAR minor units. No figure is ever worked out in the browser; the website only draws what the database returned.

| Term | Definition | Where it comes from |
| --- | --- | --- |
| Gross order value | The original total: the sum of the item lines. Never reduced. | `orders.total_minor` |
| Net order revenue | Gross order value, less the owner-approved discount, less the redeemed loyalty credit. **Recognized when the order is completed**, as a snapshot. | `private.order_completions.net_revenue_minor` (a snapshot of `total - discount - credit` taken in the transaction that completes the order; never changed) |
| Direct cost of an order | The sum of its **active** cost entries (estimated and actual are summed separately and together). A removed (voided) entry does not count. | `private.order_costs` through `private.order_cost_rollup()` |
| Order profit | Net revenue less direct cost, **only for an order that has at least one cost entry.** Never "revenue minus zero". | database |
| Margin | Order profit / net revenue of the same orders, in basis points (1/100 of a percent), rounded half away from zero; only when that revenue is greater than zero. | database |
| Net payable | What the customer owes after the discount and credit. An amount payable, **not** money received. | `orders.net_payable_minor` |
| Cash and Fawran received | Money actually received, by the **payment date**, net of reversals. A separate figure; it is never added to revenue. | payment ledger |
| Outstanding balance | Net payable less cash received. Shown for completed orders (what is still owed). | `orders.balance_due_minor` |

* **Order profit is not the company's net profit.** Rent, salaries, advertising and other overheads are not included, and the screens say so.
* **A deposit is not revenue.** It is part of the cash received against the order's net payable. The order's revenue is counted once, at completion; a deposit
  never adds to it, so nothing is counted twice. Cash received is a different figure on the same screen.
* **Negative profit is legitimate** and is shown as a loss (red), in full. A negative margin is shown as a negative percentage.
* **Missing is not zero.** An order with no cost entry has an *unknown* cost: no profit and no margin are shown for it. Its revenue is reported as
  "revenue without costs" and is left out of the profit and the margin of the period (the warning on the screen says how much).
* **Estimated vs actual.** Both are summed into the direct cost. An order with an estimated entry is never "costs complete".

### Cost state and profit state

| Order cost state | Meaning |
| --- | --- |
| No costs recorded (`missing`) | No active entry. The cost is unknown. |
| Costs incomplete (`incomplete`) | There are entries, but the owner has not declared them complete, or an estimated entry remains. |
| Costs complete (`complete`) | The owner declared the costs complete and no estimated entry remains. **Any later change to an entry reopens the state automatically** (and records that in the history). |

| Profit state of a period | Meaning |
| --- | --- |
| No completed orders | Nothing to report. |
| Not available | There are completed orders but none has any cost entry. |
| Provisional | Some completed order has incomplete costs or none. The figure is shown with a warning. |
| Verified | Every completed order in the period has complete costs. |

## 2. The completion date

* `orders.completed_at timestamptz` is set **by the database** (trigger `orders_completion`) the first time an order reaches `delivered`, in either workflow
  (V1 or V2: both end in the same status). It is a precise timestamp. It is **never typed in, never changed, never cleared**. The creation date is untouched.
* Reports group by `completed_at` in **Asia/Qatar** local time: the month boundaries are Qatar midnight (UTC+3, no daylight saving). An order created on
  20 November and completed on 3 December is a December order only. 23:30 on 31 December Qatar time is the old year; 00:30 on 1 January is the new one.
* Payments keep their own actual dates. Editing a cost later changes the profit of the **completion month** and leaves the completion date alone.
* **Delivered / Collected is final.** A completed order cannot change status (trigger), so recognized revenue cannot be erased by a move.
* **Historical orders.** The backfill in the schema migration sets `completed_at` **only** where the order's own status history records the exact move to
  Delivered (`basis = status_history`, the history row is referenced). An order delivered with no such history stays **NULL**: it is flagged *Needs historical
  verification*, it is **not counted in any month**, and the Orders page and the Overview list it. No date is ever invented.
* **Owner verification.** `admin.verify_historical_completion` (permission `finance.verify`, owner only) records the real date and time for such an order,
  with a reason, once. It is stored with the owner's name (`basis = owner_verified`) and can never be changed. It cannot be in the future or before the order was created.

## 3. Private order costs

* Table `private.order_costs`: category (components / supplier purchases, international shipping, customs and import duties, assembly, local delivery,
  payment processing, other direct expenses), description, amount (`bigint` minor units, zero or more), estimated or actual, optional supplier or reference,
  date (defaults to today in Qatar), optional private note, status (`active` / `voided`), version.
* Entries can be added, corrected or removed **at any stage**: before confirmation, awaiting deposit, sourcing, shipment, assembly, ready, after delivery,
  after completion, on hold, cancelled. Costs may also be entered on the **New order** form (optional), in the same transaction as the order
  (`admin.create_order`, 12-argument form); nothing is required.
* **Nothing is rewritten silently, nothing is deleted.** Every add, edit, removal, "declared complete" and "reopened" writes an append-only revision
  (`private.order_cost_revisions`: old values, new values, who, when, reason). Triggers refuse any update, delete or truncate of the revisions and the completions.
  Removing an entry **voids** it: it stops counting, stays listed, and keeps its history. An edit and a removal require a reason.
* **Concurrency.** Edits and removals carry `expected_version`; a stale screen is refused (`M1K03`) and saves nothing. An exact repeat of the same edit is
  recognized and reported as already saved. A new entry carries an entry id chosen once by the form, so sending the same form twice saves it once.
* **Permissions.** `finance.read` (see), `finance.manage` (enter, edit, void, declare complete) and `finance.verify` (confirm a completion date) are held by the
  **owner role only**. The check is the first statement of each function. The cost tables have row level security and no privilege for any API role.
  Customers, anonymous callers, ordinary staff and every customer-facing API **never receive a cost, supplier, margin or profit** (sentinel values are
  searched for in every response in the tests; a static test forbids the words in any customer-facing source file).
* The older per-item cost table (`admin.set_order_item_cost`) is left exactly as it was and plays no part in the new numbers.

## 4. Reporting

* All grouping, filtering and arithmetic are in the database (`private.financial_report_data`), over **every** completed order, not a page of them. A test
  completes 120 orders in one month and checks the totals and the paging.
* **Orders page.** Above the operational list: *Financial performance*: a year selector (default: the current Qatar year, automatically) and month selector
  (All, January to December); Net revenue, Total direct cost, Order profit, Completed orders, Margin; cash received and outstanding balances as separate
  figures; a January to December table (shown as a table on a desktop and as cards on a phone); incomplete or missing costs are visible in the totals and per
  month and per order; a month filters the **completed orders by completion date** (`list_completed_orders`, 50 per page). The operational list below keeps
  its own filters and is not changed by the period. A person without `finance.read` sees the completed-orders list without any cost, profit or margin column.
* **Overview.** Grouped: *Operations* (Active orders = current workload, independent of the year; Completed orders = selected year by completion date),
  *Financial performance* (Total net revenue, Total order profit with the provisional warning; owner only), a compact *Needs attention*, *Recent orders*, and a
  link to the detailed monthly reports. The year defaults to the current year; older years are in the selector. The earlier `admin.dashboard_summary` is untouched
  (the previous website still uses it); the new page uses `admin.overview_summary`.
* **Costs recorded on orders that are not completed** (open, cancelled, delivered-but-unverified) are reported separately as a memo ("no revenue recognized
  yet"), never as profit.

## 5. Customers tab: order history

`admin.customer_orders` (needs `customers.read` and `orders.read`; payments need `payments.read`) returns, for each order: number, status, order type,
original total, discount, redeemed loyalty credit, **final net payable** (prominent), amount paid, outstanding balance, created date and completion date; and,
expandable: items (names, quantities, original line prices), the discount and credit spread over the lines, final net per line, payments with receipt references,
the status history and the tracking and fulfilment history. It says that a net payable is an amount payable, not money received. It never carries a cost, margin,
profit, supplier or the owner's internal discount reason.

**Item-level net prices** use a deterministic largest-remainder allocation (`private.allocate_reduction`): the discount is spread first over the line totals in
proportion, then the credit over the remaining capacity; the shares are whole minor units that add up **exactly** to the order's discount and credit, so the line
nets add up exactly to the net payable. Ties go to the earlier line. The original prices are never changed and no line goes negative.

## 6. Edge cases (explicit decisions)

| Case | What the system does |
| --- | --- |
| Cancellation after completion | **Not possible**: Delivered / Collected is final (trigger). Recognized revenue cannot be erased by cancelling. |
| Cancellation before completion, with costs recorded | The order never completes: no revenue. Its costs are reported in the memo "costs on cancelled orders", not as profit. |
| Reopened order | Not possible after completion (same rule). A mistake is corrected with the owner's costs edits or, for the date, only the one-time verification when the date was unproven. |
| Payment reversal on a completed order | Allowed (ledger). The revenue snapshot is **not** changed; the outstanding balance reappears. Revenue is recognized at completion on the net payable, not on cash. Points already earned are not clawed back (OQ-0043, unchanged). |
| Refund to the customer after completion | **Not modelled** (there is no refund function in the system today). A refund would need its own decision on whether it reduces recognized revenue. See OQ-0044. |
| Customer edit of discount or credit after completion | Impossible: the order's money is guarded after creation; the snapshot is also immutable. |
| Cost edited after completion | Allowed (owner), keeps a revision, reopens "costs complete", and moves the profit of the **completion month** only. |
| An order with an unproven delivery date | Needs historical verification; counted nowhere until the owner confirms the date. |
| A delivered order with a cost but no revenue date | Costs appear in the memo "delivered orders awaiting verification". |

## 7. What was deliberately not done

* No complete accounting or inventory system: no overheads, no payroll, no supplier ledger, no stock, no tax. Only per-order direct costs, completed-order reporting
  and the two views.
* The legacy `create_order` overloads (the 6- and 7-argument forms that bypass the owner's discount and redemption rules) are **not** changed. They remain a
  separate Production blocker (see `supabase/release/pricing_legacy_orders_contract.sql` and HD-0022).
* The workflow default switch, `main`, `claude-dev`, hosted databases, existing hosted synthetic orders and the Instagram creative files are untouched.
* Authorization to see costs is owner-only for now. A finance role can be added later by granting the three permissions; nothing else changes.

## 8. Compatibility

* Two **forward-only, additive, re-runnable** migrations: `20261124120000_order_costs_and_completion_schema.sql` and
  `20261124120100_financial_reporting_functions.sql`. They add one permission, one column (`orders.completed_at`), four private tables, triggers, and new
  `admin.*` functions. No existing function, table row, ledger, policy or status is changed. The only existing function with a new form is
  `admin.create_order`: the 11-argument form stays exactly as it was; a 12-argument form is added.
* The website that is live today (and the Pricing & Rewards website) never calls any new function. A differential test replays 31 statements pinned from
  the deployed website (commit 4916867) against a database before the migrations, after the schema migration, and after both, and checks that the transcripts and
  reads are identical.
* The one existing test contract that changed on purpose: the owner now holds 26 permissions (was 25), and `orders` has one more column.

## 9. Migration plan

1. Apply `20261124120000` (schema) then `20261124120100` (functions) to **DEV** only, with the owner's approval. Both are rerunnable and wrapped so that a failure
   changes nothing. Verify with the read-only checks in the owner checklist (table list, permission counts, an existing order's amounts unchanged, backfill count).
2. Review the **backfill result** before anything else: how many delivered orders got a completion date from their status history and how many are flagged
   *needs historical verification*. The owner then confirms those dates (or leaves them).
3. Deploy the website that has the new screens to a **Preview** and run the owner acceptance checklist.
4. Production: the same two steps, database first, then the website. The previous website keeps working throughout (differential test).

## 10. Rollback

There is no destructive undo, by design: the new tables hold the owner's cost records and immutable history, which must not be dropped. If the new screens must
be withdrawn, deploy the previous website: it never calls the new functions and is proven to behave identically. If the 12-argument `create_order` must be
withdrawn, the 11-argument form is unchanged and is what the previous website calls.

## 11. Unresolved accounting questions

See OQ-0044 (refunds after completion), OQ-0045 (who besides the owner may see costs and profit), OQ-0046 (whether a completed order with a large balance still
owed should count in the month it was completed, as it does now), OQ-0047 (verification of the completion dates of orders delivered before this release).
