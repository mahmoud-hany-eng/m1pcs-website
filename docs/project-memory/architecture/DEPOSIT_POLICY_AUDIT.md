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
