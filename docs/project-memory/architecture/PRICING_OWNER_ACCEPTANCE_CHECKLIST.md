# Pricing & Rewards: the owner's acceptance test in the real Admin Dashboard

**Status: NOT PERFORMED.** Nothing in this checklist has been run. The automated tests (database, rendered pages, customer browser tests) do not cover typing into the staff order form, because the staff dashboard needs a real second factor. This checklist is how that gap is closed, by the owner, once, on the DEVELOPMENT project. Leave every "Result" cell empty until the step has really been done; write PASS or FAIL, and for a FAIL write what the screen showed.

**Where:** the Vercel Preview of the development project, signed in as the owner with the second factor. **Data:** synthetic only. Use a customer named `ZZ TEST Pricing Customer` with a made-up phone number and an `@example.test` e-mail. Do not use a real customer.

**Before you start:** the three pricing migrations are applied to the DEVELOPMENT database and the Preview is deployed (see section 7 of `PRICING_AND_REWARDS.md`). Money below is in QAR.

## Setup

| # | Do | Expect | Result |
|---|---|---|---|
| S1 | Open **Policies**. | The deposit schedule shows five tiers (15 / 25 / 35 / 50 / 60 %, up to 3,000 / 5,000 / 10,000 / 15,000 and above). Loyalty earning counts the net payable amount. | |
| S2 | **Customers**: create `ZZ TEST Pricing Customer`. | The customer exists; loyalty points 0. | |

## Part 1: zero points, then earn some

| # | Do | Expect | Result |
|---|---|---|---|
| 1.1 | **New order** for that customer. One item, 2,000.00. | In **Pricing & Rewards** the **Redeem loyalty points** switch is greyed out and cannot be clicked; a line says the customer has no loyalty points to redeem. | |
| 1.2 | Read the summary (no discount). | Original order total 2,000.00; Final amount payable 2,000.00; Required deposit 300.00; Remaining balance after deposit 1,700.00; points earned when completed and paid in full: 200. | |
| 1.3 | **Create order**. | "Order created". The order page shows the same figures. | |
| 1.4 | Move it to *Awaiting deposit*. Record a **deposit** of 300.00 (Fawran or cash). | Paid 300.00; balance 1,700.00. | |
| 1.5 | Record the **balance** of 1,700.00. Then try to record 1.00 more. | Paid in full, balance 0.00. The extra payment is refused. | |
| 1.6 | Move the order forward to *Delivered*. Open **Loyalty**. | The customer has 200 points ("earned"). | |

## Part 2: discount and redemption on the order form

New order, same customer, one item **4,350.55**.

| # | Do | Expect | Result |
|---|---|---|---|
| 2.1 | Choose **Fixed amount (QAR)**, 100.00. Leave the reason empty. | **Create order** is not available; the form asks for the reason. Enter `Acceptance test`. | |
| 2.2 | Switch **Redeem loyalty points** ON. | Shows 200 points available and what they are worth (QAR 20.00). | |
| 2.3 | Press **Use Maximum**. | 200 points; loyalty credit 20.00; the summary updates immediately. | |
| 2.4 | Type **100** points (partial). | Discount −100.00; Loyalty credit −10.00 (100 points); **Final amount payable 4,240.55**; **Required deposit 1,087.64** (25 % of 4,350.55, not of 4,240.55); Remaining balance after deposit 3,152.91; points earned 424. | |
| 2.5 | Type **201** points. | The form refuses (more than the customer holds); **Create order** is not available. | |
| 2.6 | Change the discount to **Percentage (%)**, 10, with 100 points. | Discount 435.06 (a half rounds up); the **Required deposit is still 1,087.64**. | |
| 2.7 | Switch redemption OFF. | The points and credit disappear; the summary updates. | |
| 2.8 | Back to Fixed 100.00, redemption ON, 100 points. Press **Create order** twice quickly. | **One** order is created. The customer's points are now 100 (not 0). | |

## Part 3: the order, a payment and the customer's statement

| # | Do | Expect | Result |
|---|---|---|---|
| 3.1 | Open the order. | Order total 4,350.55; Discount −100.00 with who authorized it and the reason (staff only); Loyalty credit −10.00, labelled as a credit and not a payment; Final amount payable 4,240.55; Required deposit 1,087.64; Paid 0.00. | |
| 3.2 | Move to *Awaiting deposit*; record the **deposit** 1,087.64 by Fawran. | Paid 1,087.64; balance 3,152.91. The payments list shows only the 1,087.64 payment: no payment or receipt exists for the points. | |
| 3.3 | As the customer (only if a synthetic customer account has been claimed; otherwise write NOT TESTED): open the order. | Order value, discount, loyalty credit ("not a payment"), total payable 4,240.55, paid, balance due, and the deposit rule. The reason for the discount and who authorized it are **not** shown. | |

## Part 4: cancellation returns the points once

| # | Do | Expect | Result |
|---|---|---|---|
| 4.1 | New order, one item 1,000.00, redeem **50** points. Create it. | Points now 50. | |
| 4.2 | Cancel it before any payment, typing the short reason `ok`. | The order is cancelled. **Loyalty** shows 50 points returned; balance 100. | |
| 4.3 | Try to cancel it again. | Not possible; the balance is still 100 (no second return). | |

## Part 5: a staff member (not the owner)

| # | Do | Expect | Result |
|---|---|---|---|
| 5.1 | Sign in as a staff member with the second factor. Open **New order**. | The discount controls and the redemption switch are locked with "owner only" text. An ordinary order can still be created. | |

## When something fails

Stop, do not retry the failing step, and send the step number, what you expected, what the screen showed, and the order reference. Do not use a real customer to investigate.

## Notes

- The staff screens have no loyalty-adjustment form, so points are earned in Part 1 instead of being granted. An operator-run grant on the development project would be a hosted write and needs your approval at that time.
- Part 3.3 needs a customer sign-in, which depends on the Supabase Auth redirect entry for the Preview URL. Without it, record 3.3 as NOT TESTED; the customer pages are covered by the automated browser tests against a local database.
- A cancelled order that had a discount or redeemed points is part of the financial record: after it exists, the database undo script for this release is permanently refused (see section 7).
