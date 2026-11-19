# Staff access from Next.js, ledger limits, and correction procedures (PLAT-0002)

**Status: section 1 was a design (PLAT-0002) and is now built and reviewed: see `STAFF_GATEWAY.md` for what was built, the
five weaknesses the review found in the proposal below, and the security analysis. Sections 2 to 4 (what the ledger
protection does and does not do, and the reversal and tracking-correction procedures) are unchanged and are now reachable
from the admin dashboard.** It answered four questions the Phase 1 design left open, so the admin phase did not have to
improvise them.

## 1. How staff functions will be called from Next.js (the PLAT-0002 proposal; superseded where `STAFF_GATEWAY.md` says so)

> **Superseded in two places.** Step 3 below said the gateway role "may only `set role authenticated`". It was built
> **without** membership in any API role, with `EXECUTE` on the `admin` functions only, because membership in
> `authenticated` would have made it a general impersonator. And the paragraph "the database accepts the claims the server
> supplies" was strengthened: for a gateway connection the database verifies the claims against the auth service's own
> `auth.sessions` row. See `STAFF_GATEWAY.md`, section 2.

**The constraint.** The staff functions live in the `admin` schema. That schema is deliberately **not** exposed through
the Supabase Data API (`supabase/config.toml` lists only `public`), so a browser holding the public key cannot name them.
That must stay true: the `admin` and `private` schemas are not to be exposed, and no privileged key may reach a browser,
merely to make a remote call work.

**Reads and writes are different problems.**

* **Staff reads of customer-facing data** (orders, payments, quotations, loyalty) can use the ordinary Data API with the
  staff member's own session, because the row level security policies already include staff permissions
  (`orders.read`, `payments.read`, and so on). No new exposure is needed.
* **Staff writes, and reads of private data** (supplier costs, notes, policies) happen only through `admin` functions.
  These are the case that needs a path.

**Recommended path: a server-only database connection that carries the verified staff identity.**

1. A staff screen lives under its own route group, behind its own middleware. A Route Handler or Server Action receives
   the request. Server Actions already check the request origin.
2. The server authenticates the caller with `supabase.auth.getUser()`, which asks the Auth server to validate the token.
   It does **not** use `getSession()` for this, because the cookie alone is not verified there. It then reads the
   authenticator assurance level from the verified token and refuses anything below `aal2`.
3. The server opens a connection with a **dedicated login role** (named for example `m1_staff_gateway`) held in a
   server-only secret. This role is not `service_role` and not `postgres`. It may only `set role authenticated`, and it
   owns nothing.
4. In **one transaction** it runs `set local role authenticated`, then `select set_config('request.jwt.claims', <the
   verified claims as JSON>, true)`, then a **fixed, parameterised** call such as `select admin.transition_order($1, $2,
   $3)`, then commits. `auth.uid()` and the `aal` claim then mean the same thing inside the function as they would
   behind the Data API, so the existing permission and MFA checks run unchanged.
5. The set of callable functions is a hard-coded list in server code. The SQL is never assembled from request text.

**Why this and not the alternatives.**

| Option | Verdict |
| --- | --- |
| Add `admin` to the exposed schemas | **Rejected.** Every signed-in user can then reach every `admin` function with the public key; the only barrier is each function's own check. It widens the attack surface for convenience |
| A new exposed schema of thin wrapper functions | Rejected for the same reason, with a smaller surface. It remains the fallback if a direct server connection is not acceptable |
| Call functions with the service-role key | **Rejected.** The service role has no `auth.uid()`, so the functions' per-person permission checks and audit trail would be lost, and the key bypasses row level security everywhere |
| Supabase Edge Functions | Possible, but each still needs a way to act as the staff member, so it moves the same problem without solving it |

**The trust this design relies on, stated honestly.** The Next.js server becomes the trust boundary: the database accepts
the claims the server supplies. The gateway role can therefore impersonate any user, including any staff member, for the
functions it may call. This is the same trust level as holding the service-role key, but narrower, and it keeps every
action attributed to a named person in the audit log. What protects it:

* the secret is server-only: never `NEXT_PUBLIC_`, never in a client bundle, never in a log, never committed;
* the role has no table privileges of its own, only the right to run the listed functions as `authenticated`;
* the call list is fixed and the SQL is parameterised;
* the database still enforces the staff tables, the MFA policy and the ledger rules, so a forged browser request fails
  at the server's own `getUser()` and `aal2` check, and a wrong claim cannot create a permission the staff table does
  not grant;
* every action is audited with the acting user.

**What was not done in the PLAT-0002 phase, and is now.** (Kept for the record; in PLAT-0003 the role is created by migration
15 **without a login or a password**, the only role the static checks allow a migration to create, and `pg` was added as an
exact-pinned dependency.) The role needs a password to log in, so that step cannot be in a migration (and the static
checks forbid role creation in migrations other than this one). It is a manual, owner-approved step in the Supabase dashboard's SQL editor on
a **development** project first. Using it also needs a Postgres client library, which is a new dependency and a separate
approval. Connection-pooler details (session or transaction mode, prepared statements) must be checked against Supabase's
current documentation when the admin phase starts. Nothing in `src/` opens a database connection today.

## 2. What the ledger protection does and does not do

The append-only and write-guard triggers stop every API role, every staff function and every ordinary SQL statement,
**including a superuser's**. A test asserts each of those.

They are **not** a defence against a privileged database operator. Someone who owns the table, or holds a superuser or
the platform's database-owner role, can disable a trigger, drop it, or run a session in replica mode; the data is then
editable. Two tests state this limit explicitly, and the same tests show that no API role, however privileged its token,
can do either.

The controls against a privileged operator are therefore organisational, not technical:

* few people hold database ownership, and the dashboard SQL editor is restricted to them;
* the owner reviews the audit log and the policy version history;
* backups and point-in-time recovery are enabled, so a tampered ledger can be compared with an earlier copy;
* migrations are reviewed before they are applied, since a migration runs as the owner.

Wording in earlier documents that read as "a superuser cannot change the ledger" is corrected: triggers fire for every
role's ordinary statements, and that is all the claim ever covered.

## 3. A payment is reversed

A reversal is a new negative row; the original payment stays. A reversal lowers `amount_paid_minor`. It does **not** move
the order's status back: a status already reached stays, and the deposit gate applies to the **next** move.

Safe procedure:

1. A person with `payments.reverse` reverses the entry and records the reason. The customer sees the reversal in their
   payments list, with the new balance.
2. If the order has already passed the deposit gate and the paid amount is now below the deposit, **put the order on hold**
   (`admin.transition_order(..., 'on_hold', reason)`) so it cannot advance. A held order can resume only at the status it
   was held from, and only if the gate is satisfied again.
3. Re-record the correct payment, then resume.
4. If points were already awarded for the order, decide whether they are reversed (`admin.reverse_loyalty_award`). A
   reversal that would make a balance negative is refused unless the owner's policy allows it (OQ-0010).
5. A refund is a different entry type and follows the owner's refund rule, which does not exist yet.

For the admin phase, an overview of "orders past the deposit gate with less than the deposit paid" should be a staff
screen, so step 2 is not left to memory. The condition is a simple comparison of two columns already on the order.

## 4. A tracking update was published by mistake

Updates are append-only, so the database offers **retraction**, not editing or deleting
(`admin.retract_tracking_event`, migration 13):

* the update stays in the database; a private record keeps who withdrew it, when and why;
* the customer's read access excludes a retracted update, so it disappears from their timeline;
* staff still see every update, so the history of what was shown is never lost;
* retracting needs the same permission as publishing and is audited; an update can be retracted once.

Safe procedure: retract the wrong update immediately, then publish the correct one. If the wrong update was published on
the wrong customer's order, the customer who could see it is that order's owner only (row level security limits every
update to its order's owner), so the exposure is one customer. Tell the owner, who decides whether that customer needs to
be informed. A retraction hides an update from the customer-facing API; it is not a data-protection erasure. A request to
erase personal data is a separate, owner-led procedure.
