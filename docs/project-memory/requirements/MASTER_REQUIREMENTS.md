# M1 Gaming PCs — Master Requirements

Only **confirmed** requirements live here. A requirement is confirmed when the human operator stated it in an instruction; the source is recorded as a human decision (see [HUMAN_DECISIONS.md](../decisions/HUMAN_DECISIONS.md)).

| Kind | Where it lives | Id format |
|---|---|---|
| Confirmed requirement | this file | `REQ-<AREA>-<NNN>` |
| Technical recommendation (not approved as a decision) | [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) | `REC-<AREA>-<NNN>` |
| Unresolved business or technical decision | [OPEN_QUESTIONS.md](../decisions/OPEN_QUESTIONS.md) | `OQ-<NNNN>` |

Nothing may be added to this file unless a human said it. A worker or model that needs a rule that is not listed here must raise a question, never invent the rule.

## 1. Confirmed requirements

### 1.1 Preserving the existing website

- **REQ-PRES-001** (confirmed) — The existing public website (https://monepcs.qa) must be preserved: its design, animations, quotation flows, completed builds and WhatsApp integrations. Extending the site must not redesign it. _Source: HD-0001._
- **REQ-PRES-002** (confirmed) — The original build photographs under `public/builds/` and `public/logo.png` are never altered. _Source: HD-0006._

### 1.2 Platform

- **REQ-PLAT-001** (confirmed) — The business platform uses Supabase for its database, authentication, authorization and real-time capabilities. _Source: HD-0001._

### 1.3 Customers

- **REQ-ACCT-001** (confirmed) — Customers can create accounts and authenticate. _Source: HD-0001._
- **REQ-ACCT-002** (confirmed) — Customers have profiles. _Source: HD-0001, HD-0004._
- **REQ-ORD-001** (confirmed) — A customer dashboard shows the customer's order history. _Source: HD-0001._

### 1.4 Orders and tracking

- **REQ-ORD-002** (confirmed) — Administrators can create orders manually for customers who order through WhatsApp. _Source: HD-0001, HD-0004._
- **REQ-ORD-003** (confirmed) — Administrators can manage orders manually for both website customers and WhatsApp customers. _Source: HD-0001._
- **REQ-TRK-001** (confirmed) — Customers can track their orders, and order updates are published manually by the business. _Source: HD-0001, HD-0004._
- **REQ-TRK-002** (confirmed) — Order progress updates are visible to the customer in real time. _Source: HD-0001._

### 1.5 Administration and finance

- **REQ-ADM-001** (confirmed) — A private administrative dashboard exists for M1. It is not available to customers or the public. _Source: HD-0001._
- **REQ-FIN-001** (confirmed) — Financial records (costs, revenue and profit) are kept in the platform. _Source: HD-0001._
- **REQ-FIN-002** (confirmed) — Financial records are separated between customers and administrators: customers never see costs, profit or other private financial data. _Source: HD-0001, HD-0004._

### 1.6 Loyalty rewards

- **REQ-LOY-001** (confirmed) — A loyalty rewards system exists, and every change to a customer's points is recorded in a transaction ledger. _Source: HD-0001, HD-0003, HD-0004._
- **REQ-LOY-002** (confirmed) — Customers earn 1 point per QAR 10 spent. _Source: HD-0003._
- **REQ-LOY-003** (confirmed) — Each point has a redemption value of QAR 0.10. _Source: HD-0003._
- **REQ-LOY-004** (confirmed) — Points are awarded only after an order is fulfilled. What counts as fulfilled is not yet decided (OQ-0006). _Source: HD-0003._
- **REQ-LOY-005** (confirmed) — The system must prevent duplicate point awards. _Source: HD-0003._

### 1.7 How the automated development system must behave

- **REQ-OPS-001** (confirmed) — Production deployments, destructive operations, billing changes and sensitive infrastructure changes remain gated by explicit human approval. _Source: HD-0009._
- **REQ-OPS-002** (confirmed) — Outside those gates, development aims for minimal human intervention. _Source: HD-0009._
- **REQ-OPS-003** (confirmed) — Credentials are never exposed in conversation, output, logs, commits or documentation, and the human is never asked to paste credentials into a conversation. _Source: HD-0009._
- **REQ-OPS-004** (confirmed) — The system must not depend on remembering the text of earlier Claude conversations; shared knowledge lives in this repository. _Source: HD-0009._
- **REQ-OPS-005** (confirmed) — Paid infrastructure is introduced only when justified (see OQ-0001). _Source: HD-0009._
- **REQ-OPS-006** (confirmed) — Development work is done on a dedicated development branch and checked on preview environments before anything reaches production. _Source: HD-0009._
- **REQ-OPS-007** (confirmed) — This repository is public: no business-sensitive information (secrets, customer data, supplier costs, margins) is committed to it. _Source: HD-0007._
- **REQ-OPS-008** (confirmed) — AI assistance in development uses only the existing Claude subscription: no OpenAI API integration, no separate Anthropic Console API billing, and no additional paid AI services. The machine contracts stay provider-neutral, and the reviewer is a separate Claude session. _Source: HD-0010._
- **REQ-OPS-009** (confirmed) — Routine, low-risk development tasks execute automatically; sensitive changes and production releases require human approval. _Source: HD-0010._

## 2. Deliberately not decided here

The following were discussed but **never confirmed**. They must not be treated as requirements, and no task may assume an answer:

- Redemption conditions: minimums, caps, expiry, stacking, what points can pay for (OQ-0008).
- How a guest quote or a WhatsApp customer is linked to an account (OQ-0003).
- What counts as "fulfilled", and whether full payment is required first (OQ-0006).
- What spending earns points (delivery, discounts, deposits) and how amounts are rounded (OQ-0007).
- What happens to points on returns and refunds (OQ-0009) and whether a balance may go negative (OQ-0010).
- Profit, revenue recognition, cost allocation and tax treatment (OQ-0012).
- Staff roles and who may see costs (OQ-0011).
- Customer login method (OQ-0002), notification channel (OQ-0013), Arabic support (OQ-0004), data retention and consent (OQ-0014).

Each of these is tracked in [OPEN_QUESTIONS.md](../decisions/OPEN_QUESTIONS.md).
