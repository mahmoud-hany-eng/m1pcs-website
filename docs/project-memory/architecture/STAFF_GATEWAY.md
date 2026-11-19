# The staff gateway: how the admin dashboard reaches the database (PLAT-0003)

**Status: built and tested locally against the official Supabase local stack. Switched off by default. Never enabled on a
production deployment. Not connected to any hosted project.** This document is the review of the design that
`ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md` proposed in PLAT-0002, what was changed after that review, the security analysis
of what was built, and the owner steps for a hosted *development* project.

## 1. What it is, in one paragraph

Staff screens are Next.js pages and Server Actions under `/admin`. They never talk to Supabase's Data API for staff work.
They call a small server-only module (`src/lib/staff/gateway.ts`) that opens a Postgres connection as a dedicated login
role, `m1_staff_gateway`, and runs **one fixed SQL text per operation** from a hard-coded list, with every value as a
bound parameter, inside **one transaction**. The role cannot read or write any table. It can only execute the functions
of the `admin` schema. Those functions decide who may do what, exactly as before, and the database additionally checks
that the sign-in session the server claims really exists in the auth service's own table.

```
browser ── cookie (HttpOnly) ──▶ Next.js server
                                  1. flags on?  (STAFF_ADMIN_ENABLED and CUSTOMER_ACCOUNTS_ENABLED, never in production)
                                  2. auth.getUser()  - the auth service validates the token
                                  3. auth.getClaims() - verified signature: aal, session_id
                                  4. gateway: BEGIN; set_config('request.jwt.claims', {sub, aal, session_id}, local);
                                              one fixed `select admin.<function>($1, $2 ...)`; COMMIT
                                                        │
                                                        ▼
                                  PostgreSQL, as role m1_staff_gateway (no table privilege, EXECUTE on admin.* only)
                                  5. private.via_gateway()  -> true for this login
                                  6. auth.sessions: the session exists, is this user's, unexpired, and aal2
                                  7. private.staff_members: active staff member
                                  8. private.has_permission(...) and the MFA policy (admin.mfa)
                                  9. the function runs; private.audit(...) records who did it
```

## 2. Review of the PLAT-0002 proposal, and what changed

The proposal was reviewed line by line before any privileged connection code was written. It was sound in outline (server
only, dedicated role, one transaction, fixed calls, no exposure of `admin`). The review found five weaknesses, and the
design was changed for each.

| # | What the proposal said | Problem found | What was built instead |
| --- | --- | --- | --- |
| 1 | The role "may only `set role authenticated`" | Membership in `authenticated` hands the gateway everything that role may do on tables (it can insert customers, read through every row level security policy, and so on). That is a general impersonator, far wider than "run the staff functions" | The role is a member of **no** API role (`gateway_audit` checks this). It gets `EXECUTE` on the `admin` functions directly and `USAGE` on the `admin` schema, and nothing else. It cannot `set role` to anything |
| 2 | "The database accepts the claims the server supplies" | If the gateway secret leaked, an attacker needs only a staff member's user id (not secret: it appears in audit entries and URLs) to run any function as them, with a claimed `aal2` | For a gateway connection the **database verifies the claims itself** against `auth.sessions`: the session id must exist (signing out deletes it), belong to the same user, be unexpired, and be second-factor (`aal2`). A leaked secret alone is therefore not enough: the attacker also needs a *live* second-factor session id of that very staff member |
| 3 | Not addressed: sign-out | The REST layer accepts a signed-out access token until it expires (**proven** against the real service: it checks signature and expiry only). A claim-only design would keep a signed-out staff member authorised for up to an hour | The session check in (2) makes sign-out effective immediately for staff operations. Tested with the real sign-out |
| 4 | "Parameterised" | Nothing stopped a later change from building SQL from text | One constant table `CALLS` of complete SQL texts; a static test fails if any query is built from a template string, if a call is not an `admin.*` function, or if any statement writes data directly |
| 5 | Not addressed: pooled connections | Session-level settings can leak between users on a pooled connection | Claims are set with `set_config(..., true)` (transaction-local) in the same transaction as the call, with a 10 second statement timeout. A real test alternates a staff member and a non-staff person on the same pool |

Two smaller points: a superuser connection is **not** treated as the gateway (it can do anything anyway, and the
migration test harness needs it); and an unexpected database error is never shown (it could name a table or a column).

## 3. What the gateway role can and cannot do

Verified by tests that connect as the role itself (`supabase/tests/real/real-stack.staff.test.mjs` and
`supabase/tests/db.plat0003.test.mjs`):

* **Cannot** `select` from any table in `public`, `private` or `auth`; cannot `insert`, `update` or create anything;
  cannot call `private.*` functions; cannot `set role` to `postgres`, `authenticated`, `service_role` or `supabase_admin`.
* **Can** run the functions listed in `CALLS`, and only for an active staff member with a live second-factor session and
  the specific permission the function requires.
* `private.gateway_audit()` returns no rows on the real platform image. It reports any widening (a table privilege, an API
  role membership, an extra executable function, extra power on the role) and is tested not to be vacuous.

## 4. Threat analysis

| Threat | Result |
| --- | --- |
| The gateway password leaks | The attacker can run listed functions only if they also hold a live second-factor session id of an active staff member; they cannot read any table or run other SQL. **Rotate the password** (see §6). Residual risk: someone who both has the secret and can read a staff session id (for example from the server's memory) can act as that person until they sign out |
| The Next.js server is compromised | It can act as any staff member who currently has a live second-factor session on it, within the listed functions. This is the same trust level as any server that holds a signed-in user's token. It cannot create a new second-factor session |
| A customer tries to reach `/admin` | They receive the website's ordinary not-found page with a real 404 status, for every admin address including the second-step page (**browser-tested** to be identical to any missing page). The check is `admin.is_staff_member()`, which answers only about the caller |
| A forged form or crafted request | Every Server Action starts with `requireStaff` (static test); input is validated again on the server; ids must be UUIDs; the browser never supplies an identity, a role, a total, a balance or a receipt number (static test) |
| A staff member without a permission | Refused by the database (tested per function) and not offered by the screens |
| A staff member without the second factor | Refused by the database even though the gateway always passes `aal2`: it reads `auth.sessions.aal` |
| Signed-out, expired or deleted session replayed | Refused by the database (tested with the real sign-out, an expired `not_after`, and a made-up session id) |
| A staff member gives themselves a role | There is no gateway call for staff management at all; the database function refuses self-changes anyway (tested) |
| Direct edits of money records | Customers can only `select`; staff change money only through `admin.record_payment` and `admin.reverse_payment`, which append to the ledger; originals are never edited or deleted (existing ledger triggers, tested) |
| Business-rule changes without trace | The deposit schedule changes only with a reason, the owner-confirmed tick and a typed phrase, becomes a new version (who, when, why) and an audit entry; orders whose deposit is fixed keep it (tested) |
| SQL injection | No SQL is built from request data; all values are bound parameters (static and real tests) |
| The service-role key | Not used anywhere in the admin or account code (static test) |

**What this design does not protect against.** The person who owns the database password (the `postgres` role) can do
anything, including disabling triggers; this is stated in `ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md` and not changed here. A
hosted Supabase project's own staff are outside this model. Edge cases of connection pooling in the hosted environment are
**not proven** (see §7).

## 5. Roles, permissions and the second factor

* Staff are rows in `private.staff_members` (role and active flag). Roles grant permissions (`orders.read`,
  `orders.create`, `orders.transition`, `payments.record`, `payments.reverse`, `tracking.publish`, `policies.manage`,
  `customers.manage`, `audit.read`, `staff.manage`, and so on). Nothing is read from JWT metadata (static test); a
  customer who edits their own `user_metadata` to claim to be an owner changes nothing (**proven** against the real Auth
  service).
* The role `staff` can manage customers and orders and publish tracking; it cannot record or reverse payments, change
  policies, read the audit log or manage staff. The role `owner` can do all of it.
* The second factor is an authenticator app (TOTP) through Supabase Auth. The policy `admin.mfa` requires it; the staff
  functions require an `aal2` session. Enrolment and verification run on the server with the person's own session.
* Nobody can change their own role or active flag, and the last active owner cannot be removed (database rules, tested).

## 6. What an owner must do for a hosted development project

None of this has been done. Nothing is created automatically.

1. Use a **development** Supabase project, never production. Apply the 15 migrations with the Supabase CLI.
2. In the SQL editor, as the owner, give the gateway role a long random password: `alter role m1_staff_gateway login
   password '<random>'`. The migration deliberately creates the role without a login and without a password.
3. In the hosting provider's **Preview** environment settings only, set `STAFF_GATEWAY_DATABASE_URL` (the role's connection
   string, with `sslmode=require`), `STAFF_ADMIN_ENABLED=true` and `CUSTOMER_ACCOUNTS_ENABLED=true`, plus the project URL and
   anon key. Never set them for Production (the code ignores the switches when `VERCEL_ENV` is `production`).
4. In the project's Auth settings: email confirmation on; redirect URLs listing the preview address; the email templates
   from `supabase/templates/` (token-hash links); TOTP enrolment and verification on.
5. Create the first owner: sign up through `/auth/sign-up`, confirm the email, then in the SQL editor add the person to
   `private.staff_members` with role `owner`. This is the one place a person is made staff, and it is done by someone who
   already controls the database.
6. Sign in at `/auth/sign-in?next=/admin`, set up the authenticator app, and work through `supabase/tests/REAL_SUPABASE_CHECKS.md`.
7. To rotate or revoke: `alter role m1_staff_gateway nologin password null`, then set a new password and update the host.

## 7. Not proven, and what remains

* The pooled connection of a hosted project (transaction mode, prepared statements) has not been exercised. The gateway
  uses only transaction-scoped settings and unnamed parameterised statements, which is what transaction pooling needs, but
  this must be confirmed on the hosted development project. A direct connection is the fallback.
* The hosted Auth settings (rate limits on the built-in mailer, email deliverability, JWT signing-key configuration).
* The gateway runs in one process pool of at most four connections; load behaviour is untested.
* Row-level behaviour for a staff role that is neither `owner` nor `staff` has no screens yet.
