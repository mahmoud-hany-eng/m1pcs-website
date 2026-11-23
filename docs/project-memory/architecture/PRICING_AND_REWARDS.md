# Order pricing and rewards (PLAT-0005)

Status: implemented and tested locally on the PLAT-0004 branch (`claude/plat-0004-order-hardening`). **Nothing in this document has been applied to a
hosted database, deployed, or pushed.** The owner's brief is recorded in HD-0021.

Three things changed, and they are kept apart on purpose:

1. **The deposit schedule has five tiers** and is worked out from the **original gross** order total.
2. **An order can carry a discount** (owner only), with a record of who authorized it and why.
3. **An order can be paid in part with loyalty points** (owner only): an **order credit**, not a payment. Points are earned on the **net** amount payable.

## 1. The money of an order

Every amount is an integer count of QAR minor units (1 QAR = 100). The database keeps six amounts apart; none of them is ever derived from a figure typed in a browser.

| Amount | Where | Meaning |
| --- | --- | --- |
| Gross order value | `orders.total_minor` | The sum of the item lines. **Never reduced** by a discount or a redemption. The deposit is taken from it. |
| Ordinary discount | `orders.discount_minor` (+ `private.order_discounts`) | Entered by the owner when the order is created; set once. |
| Loyalty credit | `orders.loyalty_points_redeemed`, `orders.loyalty_credit_minor` | Points spent on this order and what they were worth then (1 point = QAR 0.10, policy `loyalty.point_value`). Set once. |
| Net amount payable | `orders.net_payable_minor` (generated) | `total - discount - credit`. What the customer pays in cash or Fawran. |
| Cash received | `orders.amount_paid_minor` (from the payment ledger) | Only money actually received. **A redeemed point is not a payment**: no payment row, no receipt. |
| Outstanding balance | `orders.balance_due_minor` (generated) | `net payable - cash received`. |

The required deposit (`orders.deposit_required_minor`) is a **cash** amount worked out from the gross value by `private.deposit_quote`.

### The five deposit tiers (policy `orders.deposit`, version 4)

| Original gross total | Deposit |
| --- | --- |
| up to QAR 3,000.00 | 15 % |
| QAR 3,000.01 to 5,000.00 | 25 % |
| QAR 5,000.01 to 10,000.00 | 35 % |
| QAR 10,000.01 to 15,000.00 | 50 % |
| above QAR 15,000.00 | 60 % |

The percentage applies to the **whole** total (not to slices), rounded to the nearest QAR 0.01, a half rounding up (`(total * bps + 5000) / 10000`). The upper limit of a tier is inclusive: QAR 3,000.00 is tier 1, QAR 3,000.01 is tier 2.
Discounts and redeemed points never change the tier or the amount (QAR 4,000 with a QAR 500 discount: deposit QAR 1,000; QAR 12,000 with a QAR 1,000 discount: QAR 6,000).

**Existing orders are not touched.** A deposit is fixed when an order is confirmed (`deposit_fixed_at`, `deposit_rule`, `deposit_policy_version`) and a trigger refuses to change it afterwards. An order that was created but not yet confirmed has no fixed deposit; it is worked out again under the policy in force when it is confirmed. The policy is data in `private.business_policies` with its version history (the earlier three tiers are version 3).

### The worked example

| | |
| --- | --- |
| Original order total | QAR 4,350.55 |
| Ordinary discount | QAR 100.00 |
| Points redeemed | 435 points = QAR 43.50 credit |
| **Final amount payable** | **QAR 4,207.05** |
| Required deposit (25 % of the ORIGINAL 4,350.55 = 1,087.6375) | QAR 1,087.64 |
| Cash still to pay after the deposit | QAR 3,119.41 |
| Points earned on completion (`floor(4,207.05 / 10)`) | 420 |

## 2. Where it lives

Migrations (forward-only, additive, rerunnable; read in this order):

| File | What it does |
| --- | --- |
| `20261123120000_pricing_rewards_schema.sql` | New order columns and the two generated amounts; constraints (`orders_net_nonneg`, `orders_paid_within_total`, `orders_confirmed_deposit_within_net`); the append-only `private.order_discounts`; the loyalty ledger learns `redemption` and `redemption_restore` (one of each per order, by unique index) and a balance guard that takes a per-customer lock; the pricing guard trigger; permissions `orders.discount` and `loyalty.redeem` (owner only); `policy_error` accepts `net_payable`. |
| `20261123120100_pricing_rewards_functions.sql` | `private.order_pricing_quote` (the one calculation), `private.redeem_points_for_order`, `private.restore_redeemed_points`; net-aware `award_loyalty_for_order`, `try_award_loyalty`, `transition_block_reason`, both `record_payment`; cancellation restores points in `admin.transition_order`; the new `admin.create_order` (11 arguments) and `admin.order_pricing_context`; `admin.get_order` / `admin.list_orders` gain the pricing keys. |
| `20261123120200_pricing_rewards_policies.sql` | **Data only, and the moment the new rules start for NEW orders:** `orders.deposit` to five tiers, `loyalty.earning_base` to `net_payable`. It stops (changing nothing) if either policy was edited since, instead of overwriting the owner's change. |

Everything older keeps its name, arguments, owner, security-definer setting, empty `search_path` and privileges. The 6- and 7-argument `admin.create_order` and both `admin.record_payment` signatures still work for the website that is live today; for an order with no discount and no credit (every order they can create) the rules are identical. `supabase/tests/compat.pricing.differential.db.test.mjs` proves it by running one script of earlier operations against the database as deployed and against it after each of the three migrations (every intermediate state), and requiring identical transcripts and rows.

Website: `src/lib/platform/pricing.ts` (the calculation, mirrored in TypeScript so the screen can show figures as they are typed), `src/lib/staff/pricing-form.ts` (the Pricing & Rewards section's state machine), the section itself in `src/components/admin/forms.tsx`, `createOrderPriced` / `orderPricingContext` in the gateway and API, the price breakdown on the staff order page, and the statement on the customer's order page. **The screen is advice; the database is the authority**: `admin.create_order` works the figures out again and refuses the order if its net payable amount or deposit differs from the ones the screen showed (SQLSTATE `M1K03`, "nothing was created"). A grid of 500+ orders is priced by both and must agree to the minor unit (`pricing-lib.test.mjs`).

## 3. Rules the database enforces

- **Owner only.** A discount needs `orders.discount`, a redemption `loyalty.redeem`; both are checked before the idempotency claim and before anything about the customer is described. Staff keep exactly the permissions they had. Both need the second factor like every staff permission. Letting another role discount or redeem later is a data change, not a code change: a row in `private.role_permissions` for that role (the order form's controls and the database both follow the permission). Nothing in the code says "owner".
- **A discount** is fixed (QAR) or a percentage (0.01 % to 100 %, rounded half-up); never more than the gross; it needs a reason (3 to 500 characters); `private.order_discounts` records the mode, the percentage, the amount, the base, the reason, who authorized it and when. It is append-only. A discount **line item** is refused by the new `create_order` (it would lower the gross and so the deposit); the older entry point still accepts it.
- **A redemption** needs a positive whole number of points, never more than the customer's balance, never more than what is left to pay after the discount. It is one entry in the append-only loyalty ledger (`redemption`, negative), written in the same transaction as the order.
- **Atomic.** The order, its items, its discount record, the ledger entry, the audit rows and the idempotency claim commit together or not at all. A failed creation consumes no points (tested with an injected failure at the very last step).
- **No double spend.** Every ledger entry that takes points away takes the same per-customer advisory lock and re-checks the balance *after* getting it (a trigger on the ledger), so two orders, or an order and an adjustment, cannot spend the same points (tested with real parallel sessions: 100 points, eight orders of 30 -> exactly three succeed). A redemption can never overdraw, whatever the negative-balance policy says.
- **No duplicate on retry.** The idempotency fingerprint covers the discount, the points and the figures the screen showed. The same key returns the same order and spends nothing again; a different request under the same key is refused.
- **Set once.** The discount, the points and the credit cannot be changed after the order is created, by anyone, however the update is attempted.
- **Net below the deposit is blocked** (see section 6).
- **A payment can never exceed the net payable amount**; "paid in full" means paid in full of the net payable amount, for the full-payment gate and for the loyalty award.
- **Loyalty is earned on the net payable amount**, rounded down (1 point per QAR 10), once, when the order is completed (the award status in `loyalty.award_trigger`) and the payable amount is fully settled. Nothing is earned on discounted or credited money, and that holds whatever the earning rule is called: even if the owner later sets `loyalty.earning_base` back to the earlier `order_total` placeholder, an order that carries a discount or a credit earns on the amount payable (for an order with nothing taken off the two are the same, so earlier orders earn exactly as before). The only other base is `amount_paid` (cash received). The features are switched off (with a message) while `loyalty.earning_base` is anything but `net_payable` or `amount_paid`, so a mis-ordered rollout cannot produce points on money that was never paid.

## 4. Cancellation, reversals, receipts and statements

- **Cancellation** gives the redeemed points back with a **new compensating ledger entry** (`redemption_restore`, positive) that points at the redemption. Nothing is edited or deleted; one restoration per redemption, by unique index; calling it twice writes nothing. The order keeps the record of what was redeemed; the customer's history shows both lines. Earned points are never clawed back by a cancellation.
- **A payment reversal** changes only the cash: the credit, the discount, the redemption entry and any award stay as they were. Clawing back earned points after a payment reversal is **not implemented** (it remains the owner's decision; see `PROPOSAL_PAYMENT_REVERSAL_AND_LOYALTY.md`), and nothing creates a negative balance by itself.
- **Receipts and customer statements** show these lines, in this order (`orderStatement` in `src/lib/platform/pricing.ts`, rendered on the staff order page and on the customer's order page): *Order value (before discount)*, *Discount* (only if any), *Loyalty credit (N points)* with the note "Points used as a credit on this order. Not a payment." (only if any), *Total payable*, *Paid so far* (cash or Fawran received), *Balance due*; and, beside them, the deposit, with the sentence that it is worked out from the order value before the discount. A **receipt** is still produced only by a recorded payment and shows that payment's amount and method; a redemption produces none. The customer sees amounts, never the reason for a discount or who authorized it (that record is private).

## 5. The order form

The journey: choose the customer -> add items (the original total appears automatically) -> optionally a discount -> redeem points (switch available only if the customer has points) -> read the summary -> tick that prices were checked -> create.

*Pricing & Rewards* shows, live: Original order total; Discount (type, amount or percentage, reason, and the amount taken off); Loyalty points (available points and their QAR value, the **Redeem loyalty points** switch, **Points to redeem**, **Use Maximum**, the credit, the points left); then the summary (Original order total, Discount, Loyalty credit, **Final amount payable**, **Required deposit** with its percentage and tier, **Remaining balance after deposit**, the points the customer will earn). The switch is greyed out and disabled with the reason when the customer has no points, when the person is not the owner, or while the features are switched off. Everything updates as the person types; changing the customer is a different page with that customer's own points. When the net payable amount would be below the deposit, the section shows the block with the "owner decision needed" explanation and the largest number of points that would keep the deposit payable. Delivery method and address stay optional ("Not decided yet"): arranged over WhatsApp, never forced.

## 6. Decisions for the owner (unresolved; nothing was assumed beyond what is stated)

1. **A net payable amount below the cash deposit.** Today: blocked with an explanation, at creation and again at confirmation (a later schedule change can make an existing pending order fall below). This means an order paid entirely by discount and points cannot exist. Options: keep the block; or allow it and fix the deposit at the net amount (a policy that lowers the deposit); or allow a fully-credited order with no cash at all. The rule is one function (`private.order_pricing_quote`) and one constraint (`orders_confirmed_deposit_within_net`).
2. **Legacy "Discount" line items, and the earlier order-creation functions.** The new form no longer offers a discount line, and the new 11-argument `create_order` refuses one (even for the owner). Orders that already carry one are unchanged (their gross is the reduced total, `discount_minor` is 0, and their deposit, tier and earning use that total, exactly as before; nothing is double counted). BUT the two earlier signatures of `create_order` (6 and 7 arguments) remain callable by every staff member with `orders.create` until `supabase/release/pricing_legacy_orders_contract.sql` is run, and through them a staff member can still create a discount line with no owner authorization, which lowers the total and therefore the deposit tier. This was found in the final financial review, reproduced, and is **pre-existing** (the website deployed today offers the discount line). It cannot be closed before the website deployed today is retired, because that website creates orders through those signatures. The script is prepared and tested, **not applied**, and is a required step before Production and before relying on "only the owner may discount" (section 7, step 6). Decide separately whether to retire the item kind and what to do about existing orders that carry one (OQ-0041).
3. **Clawback of earned points** after a payment reversal or a refund (OQ-0009, OQ-0010): not implemented, no negative balances.
4. **Who may see a customer's points** at order creation. Today: the owner (`loyalty.redeem`) and anyone with `loyalty.read`.
6. **Known, not changed (final financial review).** (a) `admin.get_order_financials` (requires `finance.read`; no screen calls it) still reports revenue from the gross order total, so for a discounted order it overstates revenue and margin; use `net_payable_minor` before any screen or report reads it. (b) Between steps 3 and 4 of section 7 the customer's points page already describes redeeming points although the order form still has the feature switched off; the window is short and nothing is created. (c) The manual `admin.adjust_loyalty` can take a balance below zero only if the owner's policy `loyalty.negative_balance` is switched on (it is off by default); a redemption can never do so. (d) The customers page and the dashboard show the order value (before a discount) beside a balance that is net of it; the columns are now labelled "Order value" and "Balance due" so the arithmetic is not misread.
5. **Rules not asked for and therefore not built:** a cap on discount size, a minimum redemption, expiry of points, whether points may pay a deposit (today they reduce the net payable amount only; the deposit stays in cash), and stacking limits (OQ-0008).

## 7. Staged deployment sequence (nothing below has been done)

What the final financial review proved locally (disposable PostgreSQL 16, real migrations) and what it did not:

- **The website live today works after EACH migration.** `compat.deployed-statements.db.test.mjs` pins the 29 fixed SQL statements of the deployed website (commit af498d2) byte for byte, requires every one to still be present unchanged in the new gateway, and runs one scripted staff session through exactly those statements against four databases: as deployed, plus migration 1, plus 1 and 2, plus 1, 2 and 3. Every success, every refusal (and its words) and every resulting row is identical; the answers of the read statements only gain the documented pricing keys; the deposit for QAR 12,000.00 changes only after migration 3 (420,000 minor before, 600,000 after); staff gain no permission, the owner gains exactly the two new ones.
- **The NEW website is safe between migration 2 and migration 3.** `pricing-lib.test.mjs` ("between migration 2 and migration 3") shows: the database reports pricing as not enabled, the earlier earning rule and the three-tier schedule; the screen, given that real answer, locks the discount and redemption controls with the reason and prices ordinary orders with the schedule in force; the real create statement creates, confirms and settles an ordinary order with the three-tier deposit; a stale figure is refused (`M1K03`); a discount or points sent anyway are refused by the database, no order is created and no point is spent. The order of steps 3 and 4 is therefore a choice, not a safety requirement: migration 3 may also be applied before the website is pushed (the live website was proved against that state too).
- **Not proved here:** anything on the hosted project (it still holds the as-deployed state), the staff order form in a real browser (the owner's acceptance test below), and customer sign-in on the Preview.

1. Review the three migrations and this document. Take a snapshot/backup of the development database.
2. Apply migrations 1 and 2 to the **development** project with the website **that is live today** still deployed. They are additive. Verify the structure digest and the existing orders (O-2611-00001 unchanged: total, deposit 108,764 fixed under policy version 3, two payments, four tracking updates, no discount, no credit).
3. Push the website once; verify CI and the Preview. Between this step and the next, the new order form shows the discount and redemption controls locked (the loyalty rule is still `order_total`), the customer's points page already describes redemption, and ordinary orders follow the three tiers.
4. Apply migration 3 (the policies): the five tiers and the net-payable earning rule start for new orders. Existing confirmed orders keep their fixed deposits. This is the moment discounts and redemption become possible.
5. Owner-run acceptance in the real Admin Dashboard: [PRICING_OWNER_ACCEPTANCE_CHECKLIST.md](PRICING_OWNER_ACCEPTANCE_CHECKLIST.md) (synthetic customer and orders only). **It has not been performed.** Note that the first discounted or redeemed order created here closes the database undo script permanently (see Rollback below).
6. **Close the earlier order-creation functions** before Production and before relying on owner-only discounts: when no deployment of the website deployed before the pricing release can reach this database (Production, every Preview, open tabs), run `supabase/release/pricing_legacy_orders_contract.sql` (guarded: `set m1.confirm_legacy_order_contract = 'old-website-retired';`; refuses if the 11-argument function is missing). It only withdraws the right to run the two earlier signatures; nothing is deleted. Then, in a separate website commit, delete the unused `create_order` statement and `createOrder` helper. **Not applied anywhere.**
7. Only then consider Production, as a separate decision. The workflow switch (`orders.workflow`) is not touched by any of this.

**Rollback (limits, stated plainly).** `supabase/release/pricing_rewards_rollback.sql` (an operator script, not a migration) is safe ONLY BEFORE THE FIRST PRICING AND REWARDS TRANSACTION. It puts the replaced functions back to their previous definitions and restores the two policies to their previous versions' values, and it deletes nothing. It refuses (`M1P01`), permanently, as soon as any of these exists: an order with a discount, a loyalty credit or redeemed points; a discount record; a redemption or redemption-restore entry in the points ledger (a cancelled redemption counts). Before checking, it locks the orders table, the points ledger and the discount table against writers (10 second limit), so an order being created at that moment either commits first and the undo refuses, or waits until the undo is finished. Without the confirmation `set m1.confirm_pricing_rollback = 'new-website-retired';` it refuses (`M1P02`).

**After the first discount or redemption there is no database undo, and none is promised.** Discounts, redemptions, payments, ledger entries and receipts are never removed or invalidated by any script here. The recovery in that situation is (a) redeploy the previous website (the new database functions are additive and the previous website keeps working against them) or (b) a forward fix as a new migration. The undo does not change a deposit already fixed on an order, and it does not undo the five-tier policy for orders already confirmed under it.

## 8. Tests

`supabase/tests/pricing.db.test.mjs` (tiers and every boundary, discounts, redemption, atomicity, idempotency, real parallel sessions, earning on the net amount, cancellation and reversal, the blocked case, existing orders and both workflows, security), `compat.pricing.differential.db.test.mjs` (every earlier path unchanged in every intermediate state), `pricing-lib.test.mjs` (the screen's logic and the 500-order differential against the database), `pricing.pages.db.test.mjs` (the real pages rendered with the real functions), `gateway-outcomes.db.test.mjs` (the action bodies against the real gateway), and the existing suites, updated where they asserted the earlier three tiers.

**Mutation check.** `supabase/tests/mutation/run-pricing-mutations.mjs` (run by hand, not in CI) breaks one rule at a time in a copy of the tree: the deposit taken from the net amount, a discount or redemption allowed for staff, no per-customer lock, points earned on the gross, a payment above the net, a cancellation that keeps the points, a double restoration, a blocked order accepted, stale figures accepted, a moved tier boundary, an editable discount record, an open grant, and the matching screen rules. All 35 were caught by at least one suite (33 in the main run; after the final review's two corrections, the earning-base and cancellation-reason rules were added as P34 and P35 and P05 was re-run; every mutation was re-checked to still apply to the edited files).

**What is not covered.** The staff order form's clicks and typing were not driven in a real browser, because the staff dashboard needs a real second factor. Its logic is tested as a library (including a 500-order comparison with the database), its server side is rendered with real data, and the customer's side is tested in a real browser at desktop and phone widths. The first hosted run of the form is the owner's acceptance check (section 7).
