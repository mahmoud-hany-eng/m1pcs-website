# Proposal: loyalty points when a payment is reversed after the points were awarded

**Status: PROPOSAL ONLY. Nothing here is implemented, and no policy has been changed.** It needs the owner's decision before any work.
Written for PLAT-0004 on 2026-11-21. Related open questions: OQ-0006 (what "fulfilled" means), OQ-0007 (what earns points), **OQ-0009**
(points on returns and refunds) and **OQ-0010** (may a balance go negative). Related confirmed rules: REQ-LOY-003 (a point is worth QAR 0.10 when
redeemed) and REQ-LOY-004 (points only after an order is fulfilled).

## 1. What happens today (observed and covered by tests, not changed)

| Situation | Result today |
|---|---|
| The final payment of a **delivered, fully paid** order is reversed | The balance is owed again. The order **stays delivered**. The **points stay** on the customer's account. Nothing prompts anyone to take them back. |
| The owner then reverses the award by hand (`admin.reverse_loyalty_award`, needs `loyalty.adjust`) | A `reversal` entry cancels the award. It is **refused** if the balance would go below zero (OQ-0010 default: not allowed). |
| The customer then pays the balance again | The points are **not re-awarded**: an award already exists for the order (even though it was reversed), and an award is unique per order. The owner would have to add an `adjustment` by hand. |
| The same reversal is attempted twice | Refused (*"this award has already been reversed"*). |

The customer pages read the same ledgers, so after step 1 a customer sees the balance owed **and** the points still counted. Points are not spendable yet (no
redemption feature, OQ-0008), so today the exposure is the value of the points, at QAR 0.10 each: an order of QAR 2,000.00 carries 200 points (QAR 20.00); an order of
QAR 20,000.00 carries 2,000 points (QAR 200.00). It grows once redemption exists, because points could then be **spent before** the payment is reversed.

## 2. Options

**Option 0, status quo (manual, by procedure).** The written procedure already says "decide whether the points are reversed". No code. Risk: it depends on someone remembering; the
re-award gap above stays.

**Option 1, manual with guard rails.** Keep the decision with the owner but make it hard to forget and easy to do correctly: when a payment on a delivered order is reversed, the screen shows
"this order earned N points" and offers "also take back the points" (a checkbox with a reason, audited); allow a **re-award** when an award was reversed and the order is paid in full again. The owner
decides each case. Smallest change; no automatic money-like effects; works with OQ-0010 undecided.

**Option 2, automatic, state-driven.** Points exist exactly while the order is delivered **and** fully paid (the OQ-0006 default). A reversal that leaves the order not fully paid
automatically reverses the award in the same transaction; paying it in full again awards it again. Consistent and no memory needed. Costs: it needs OQ-0010 decided (what if the
points were already spent?), the unique-award rule changed to "one **active** award per order", and a correction (reverse a mistyped payment, then record the right one) would claw back and
re-award, which is correct but noisy.

**Option 3, hold the points for a period.** Award only after a settling period (for example 14 days after full payment and delivery), so most reversals happen first. It changes **when** points are
earned (OQ-0006), which is a business decision about the programme, and it does not remove the problem for late reversals.

**Option 4, proportional points.** Points follow the net amount actually paid. It conflicts with OQ-0007 (the earning base) and is the most complex. Not recommended.

## 3. Recommendation

1. **Now (after approval): Option 1.** It removes the memory risk and the re-award gap without deciding the open policy questions, and it is a small change that fits the current architecture.
2. **Later, once OQ-0010 and redemption are decided: Option 2**, because it makes the rule a property of the data instead of a habit. Do not build it before the owner has decided what happens to points
   that were already spent.
3. Do **not** choose Option 3 or 4 unless the owner wants to change how the programme works.

## 4. What I need from the owner

1. When a payment on a delivered order is reversed and the order is no longer fully paid, should the points be taken back **always**, **only if the owner chooses**, or **never**?
2. If the customer has **already spent** some of those points, should the reversal go ahead and leave a **negative** balance, take back only what remains, or **block** the payment reversal? (This is OQ-0010.)
3. If the customer pays the balance again, should the points come **back automatically**?
4. Should a **refund** (not only a reversal) take points back (OQ-0009)?
5. What should the customer **see** when points are taken back (wording, and whether they are told)?
6. Is a **settling period** before points are awarded wanted at all?

## 5. Conditions any option must keep

Append-only ledgers (a correction is a new entry, never an edit); every change audited with a reason; only people with `loyalty.adjust` (the owner today) may take points back, or the rule is
applied by the database itself in the same transaction; idempotent (the new idempotency keys apply, so a repeated click takes back once); the confirmed earning rate and 15 / 25 / 35 % deposit tiers untouched; the
customer's pages stay consistent with the ledger.

## 6. Tests that would come with the chosen option

Reverse the final payment of a delivered order with the points unspent, partly spent and fully spent; reverse twice; reverse and re-pay (re-award exactly once); correct a mistyped payment; concurrent reversal and re-payment;
the customer's pages after each step at desktop and phone width; the ledger-wide invariants (balance = sum of the ledger, never negative unless OQ-0010 allows it, one active award per order).
