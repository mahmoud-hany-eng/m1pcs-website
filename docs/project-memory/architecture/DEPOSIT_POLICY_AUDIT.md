# Audit of M1's deposit policy (PLAT-0002)

**Status: audit and correction. No deposit schedule is adopted.** Phase 1 seeded `orders.deposit` as a flat 50 % of the
order total. This audit checked whether anything supports that, found nothing, and the seed was withdrawn. The owner
decides the schedule; the platform only holds it as a configurable policy.

## What the repository says about deposits

| Source | What it says | Kind |
| --- | --- | --- |
| Public site, `siteConfig.operations.depositNote`, shown on the policies page, the How It Works page and the ordering guide | "For some orders, a deposit **may** be required depending on the requested products and total order value. The remaining balance is paid upon delivery." | Public statement. **Conditional**, and **value-dependent**; no amount, no percentage, no threshold |
| Public site, How It Works story | "A deposit confirms your order. You receive payment confirmation and your order is officially placed." | Public statement. Reads as **unconditional**: a deposit confirms an order |
| Public site, ordering guide | An order is confirmed "once you have accepted a specific quotation and agreed payment and delivery arrangements with the M1 team" | Public statement. Arrangements are **agreed per order** |
| Instagram video mockups (read only; not part of the website) | A chat bubble "Deposit required"; narration "your deposit confirms the order". The source notes that it holds no real chat, number or payment data | Illustration. No amount |
| Project memory (requirements, open questions, decisions) | Deposits appear only as a possible part of the loyalty earning base (OQ-0007) and of redemption (OQ-0008). **No deposit rule, amount, percentage or tier is recorded** | Gap |
| Git history | The `depositNote` sentence was added once (2026-09-25) and never changed. No earlier wording exists | None |

**There is no tiered schedule, no percentage and no threshold anywhere in the repository.** The statement that earlier
M1 quotation systems used tiered deposit amounts comes from the owner, outside the repository. The schedule itself was
not available to this audit, so it is neither reproduced nor guessed.

## Conflicts and tensions found

1. **"Some orders" against "a deposit confirms your order."** The public policy says a deposit is sometimes required; the
   story and the video say a deposit confirms an order. Both cannot describe the same rule without a threshold: perhaps
   small orders need none, perhaps every order needs one. Only the owner can say which.
2. **The Phase 1 seed matched neither.** A flat 50 % for every order contradicts "some orders", ignores "total order
   value", and appears nowhere in the repository. It was a developer placeholder that was active by default in any
   deployment that applied the migrations. That is an unconfirmed commercial schedule in force, which this audit
   treats as a defect.
3. **"The remaining balance is paid upon delivery."** This bears on a second policy, `orders.full_payment`, and on the
   loyalty award, which the Phase 1 seed makes depend on full payment at `delivered`. Both stay placeholders (OQ-0006).
4. **Refundability and cancellation.** Nothing says whether a deposit is refundable, partly refundable, or lost on
   cancellation. The policies page has a cancellations section; it was not found to state deposit treatment.

## What changed

* **Migration 12 withdrew the flat 50 %.** `orders.deposit` is now `{"mode": "unconfigured"}`. The previous placeholder stays in the policy's version history as version 1, so nothing is
  lost and nothing is hidden.
* **While unconfigured, the system fails closed.** An order cannot be created, and an existing order cannot advance. No
  order is ever priced under a rule nobody has confirmed. A missing policy row behaves the same way.
* **The policy can express what the owner describes.** Modes: `percent`, `fixed`, and `tiered` (tiers by order total,
  each tier a percentage or a fixed amount, ascending thresholds, the last tier open-ended, up to twelve tiers, an
  optional minimum). The Phase 1 shape without a mode still means `percent`.
* **Nothing is activated.** No percentage, amount or tier is set anywhere outside the test fixtures, which use a
  clearly labelled synthetic schedule and say so.

## What the owner needs to provide

A person should open a question for the deposit and answer at least:

1. Is a deposit required on every order, or only above a threshold or for certain products?
2. How is it calculated: a percentage, a fixed amount, or tiers by order total? If tiers, the exact thresholds and the
   amount or percentage in each. If earlier systems used more than one schedule, which one is current, and are the older
   ones to be honoured for old orders?
3. Is there a minimum deposit?
4. Which stage requires the deposit to be fully paid: before sourcing, before building, or another stage?
5. Is the deposit refundable, and under what conditions? Does it count towards loyalty points?

Until then the correct state is **unconfigured**. The owner sets the schedule with the staff policy function, which
records who changed it, when and why, and keeps the previous value.

## Public wording is not changed here

The website text above is public and unchanged. If the owner's answers differ from it, the site copy needs a separate,
approved change; this phase does not edit it.

## PLAT-0003 update: the schedule is now confirmed by the owner

After this audit the owner **confirmed** a tiered schedule. It is implemented as a versioned, configurable database policy
(`orders.deposit`, version 3, `confirmed_by_owner`) that **replaces the unconfigured placeholder**. The withdrawn flat 50 %
is **not** restored: it stays in the version history as version 1, and no screen, test or demonstration figure implies it
any more (the preview data and the browser tests use the confirmed figures).

| Order total (whole total, never marginal) | Deposit |
| --- | --- |
| up to and including QAR 3,000.00 | 15 % of the whole total |
| above QAR 3,000.00, up to and including QAR 5,000.00 | 25 % of the whole total |
| above QAR 5,000.00 | 35 % of the whole total |

* **Whole total, not slices.** A QAR 6,000.00 order pays 35 % of QAR 6,000.00, not 15 % of the first QAR 3,000.00 plus the
  next slice at 25 % and so on. Tested.
* **Arithmetic.** Integer minor units only. `deposit = floor((total x rate_in_basis_points + 5000) / 10000)`: to the
  nearest minor unit (the dirham, one hundredth of a riyal), a half rounds **up**. For example QAR 3,000.02 at 25 % is
  QAR 750.005, which is QAR 750.01. A total too large for floating point is still exact. Tested at the boundaries
  QAR 3,000.00 (15 %), 3,000.01 (25 %), 5,000.00 (25 %) and 5,000.01 (35 %), and at exact halves.
* **Recorded at confirmation.** The deposit amount, the rate, the policy version, the rule's own words and the gate status
  are written onto the order when it moves from "order received" to "awaiting deposit", and then frozen by a trigger. Before
  that the figure on screen is labelled provisional. A later change to the schedule does not change an order whose deposit
  is fixed (tested through the admin dashboard, in a browser, against the real database).
* **A deposit is recorded as paid only after an authorised staff member records receipt of the payment.** Fixing the amount
  is not receiving the money: the order screen shows "Deposit received (recorded by staff)" only when recorded payments
  cover the fixed deposit (a bug where one field conflated the two was found by the real-stack tests and fixed).
* **Changing the schedule** needs the permission `policies.manage`, a written reason, the tick "the owner has confirmed this
  schedule" and the typed words `CHANGE DEPOSIT SCHEDULE`. It saves a **new version** (who, when, why) and an audit entry.
* **Still undecided, and not inferred anywhere:** whether a deposit is refundable, and which payment methods are eligible
  for a refund. The policies screen says so in words. Refunds do not exist in the staff tools.

**Proposed record (NOT recorded: only a person may edit the decision register).** A person may wish to record, as a human
decision, text along these lines: *"The deposit is 15 % of the whole order total for orders up to and including QAR 3,000.00,
25 % above that up to and including QAR 5,000.00, and 35 % above QAR 5,000.00, rounded to the nearest dirham with a half
rounding up, fixed when the order is confirmed and changed only by an authorised administrator with a reason. A deposit
counts as paid only when an authorised staff member confirms receipt. Refund eligibility is undecided."* The owner's
original wording and date belong in that record; this paragraph is a proposal.
