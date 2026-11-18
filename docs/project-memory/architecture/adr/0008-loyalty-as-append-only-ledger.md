# ADR-0008: Loyalty points are an append-only ledger with database-enforced idempotency

- **Status:** proposed
- **Date:** 2026-11-16
- **Related:** REC-PLAT-009, REQ-LOY-001, REQ-LOY-002, REQ-LOY-003, REQ-LOY-004, REQ-LOY-005, OQ-0006, OQ-0007, OQ-0008, OQ-0009, OQ-0010

## Context

The human confirmed that loyalty uses a transaction ledger, that 1 point is earned per QAR 10 spent, that each point is worth QAR 0.10, that points are awarded only after fulfilment, and that duplicate awards must be prevented. Redemption conditions, the earning base, rounding, the definition of fulfilled and the handling of refunds and negative balances are all undecided.

## Decision

This is a design recommendation for the future platform phase; it does not decide the open questions.

- The balance is derived from an append-only ledger. Entries are never updated or deleted, and corrections are new entries (reversals, adjustments) that reference the entry they correct.
- Duplicate prevention is enforced by the database: a unique partial index permits at most one award entry per order, and another permits at most one reversal per awarded entry. Awarding happens in the same transaction as the order's move to fulfilled, with "do nothing on conflict".
- No role has direct write access to the ledger. Only a small set of definer functions writes it, and each checks the caller's authority and writes an audit record. Administrative adjustments require a reason.
- Redemption locks the customer's row to prevent two concurrent spends of the same points.
- Rounding, earning base, redemption limits and refund behaviour are parameters supplied by the answers to the open questions, never assumed.

## Consequences

- Any award can be explained from the ledger, and replays or retries are harmless.
- The rules that are still open must be answered before the loyalty phase starts (PH-7).
