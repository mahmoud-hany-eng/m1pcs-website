# ADR-0009: The automation uses only the existing Claude subscription

- **Status:** accepted
- **Date:** 2026-11-17
- **Related:** HD-0010, REQ-OPS-005, REQ-OPS-008, REQ-OPS-009, REC-OPS-014, REC-OPS-015, OQ-0021, OQ-0024, OQ-0032

## Context

The Phase 0 automation audit proposed a second, independent reviewer that called an external AI provider's API (OpenAI) with its own prepaid billing, alongside Claude workers. That would have introduced a new paid service, a new credential and a second vendor's terms and data handling.

The owner has decided (HD-0010): use the existing Claude subscription only; no OpenAI API integration; no separate Anthropic Console API billing; no additional paid AI services; routine low-risk development tasks run automatically; sensitive changes and production releases need human approval.

## Decision

- Every AI step in the development system is a Claude session billed to the existing subscription. There is no external AI service, no API-key billing from any provider, and no paid add-on. Metered overage on the subscription ("extra usage") stays off, because it is billed at API rates.
- The policy records this as constants that cannot be switched on by editing a value: `budget.paid_ai_services_allowed` and `budget.api_billing_allowed` are fixed at false in the schema, and `PROHIB-016` makes using a paid or metered AI service a class C operation. The validator checks all of this.
- The machine contracts stay provider-neutral: the validator rejects any mention of an external AI provider in the schemas, the policy, the worker instructions and the active documents. Records of this decision, the human decision log, open-question history and old run reports are exempt, because they must be able to say what was excluded.
- Automated jobs that use the subscription must run where no API key is defined (REC-OPS-015), because a non-interactive Claude session prefers an API key over a subscription token when both are present.
- The reviewer is a separate Claude session. How it is hosted is a separate, still-open decision (ADR-0010, OQ-0031).

## Consequences

- No new monthly bill from the automation, and no second vendor to assess.
- Subscription limits become the only cap. There is no spend limit that stops a runaway loop by itself, so the system must throttle itself through policy limits and stop when a limit is reached (REC-OPS-014). The owner must confirm the plan's real limits and that extra usage is off (OQ-0022).
- The reviewer and the worker are the same model family, so their mistakes can be correlated. This is accepted, and it is why the reviewer is advisory and the decisions are made by deterministic code and, for sensitive work, a human.
- The documentation reviewed does not say whether automated use of a subscription token is otherwise permitted. A small terms-of-use uncertainty remains for the owner to accept or reject (OQ-0032).
- Anything that would need a paid AI service is out of scope, and proposing it requires a new human decision that supersedes this one.
