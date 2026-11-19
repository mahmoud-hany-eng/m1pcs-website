# Customer accounts and dashboard (PLAT-0002, Phase 2; updated in PLAT-0003)

> **PLAT-0003 update.** The account code was run against the **official Supabase local stack** (the real Auth service,
> REST layer, Postgres image and mail-testing service) and not only against the project's own emulator: see section 9.
> Three behaviours changed as a result: an account that has a profile can now claim older records (section 6), password
> recovery exists (section 6a), and the sign-up screen no longer relies on the auth service hiding that an address is
> registered (it does not hide it). The staff side is described in `STAFF_GATEWAY.md`.

**Status: implemented locally and tested locally, behind a feature flag that is off by default. Not deployed. Not
connected to any Supabase project. Nothing here has been run against a real Supabase.** The tests that exist run the
real Next.js app, the real `@supabase/ssr` cookie handling and the real database migrations and row level security
together, but the Supabase *services* (sign-in, email, the data API) are imitated by a local emulator that is not
Supabase (section 9). Read section 11 before relying on any of it.

This document describes the code in `src/lib/accounts/`, `src/app/account/`, `src/app/auth/`, `src/components/account/`
and `src/middleware.ts`, and the test tooling in `supabase/emulator/` and `supabase/tests/`. It builds on
[SUPABASE_FOUNDATION.md](SUPABASE_FOUNDATION.md) (the database) and
[ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md](ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md) (how staff functions are reached). It
records no business decision: where a rule belongs to the owner it stays a database policy or an open question.

## 1. What a customer can do

| Need | Where | Notes |
|---|---|---|
| Get a price without an account | the existing quote form and WhatsApp handoff | **Unchanged.** No account is needed and nothing in this feature touches that path. |
| Create an account | `/auth/sign-up` | Email and password. A confirmation email is required. |
| Sign in | `/auth/sign-in` | Password, or a one-time email link for an existing account. |
| Confirm an email address | `/auth/confirm` (a link in the email) | Completes sign-in on the server. |
| See an overview | `/account` | Open orders, balance to pay, loyalty points, latest update. |
| See orders | `/account/orders`, `/account/orders/[ref]` | Status, progress, items, money, tracking timeline. |
| See payments | `/account/payments` | What is owed and every recorded payment. |
| See loyalty | `/account/loyalty` | Balance and the history behind it. |
| Edit their profile | `/account/profile` | Name, phone, language, address, marketing consent. |
| Link earlier WhatsApp orders | `/account/claim` | With a one-time code staff issued. Never by email or phone match. |
| Sign out | a button in the account header | Clears the session cookie. |

## 2. Safety switch: the feature is off by default

* The flag is the server variable `CUSTOMER_ACCOUNTS_ENABLED`. Only the exact value `true` turns it on.
* **It is ignored when `VERCEL_ENV` is `production`.** Public accounts cannot be switched on in production by setting a
  variable; that needs a code change that the owner approves. (`src/lib/accounts/shared/flag.ts`.)
* With the flag off, every account and auth route answers 404, the middleware does nothing, and no Supabase client is
  created. The public pages and the WhatsApp quote journey are unchanged: the middleware matcher is
  `["/account/:path*", "/auth/:path*"]`, so no public page ever passes through it. The browser test suite includes a
  flag-off run that checks this, and the production client bundles of the public pages were compared with the
  baseline (the run record has the result).
* The gate is checked in three places on purpose: first in the middleware, then in the `/account` and `/auth`
  layouts, then again in every page and every server action. A layout does not re-render on client navigation, so the
  layout alone would not be enough.
* `CUSTOMER_ACCOUNTS_PREVIEW_LABEL` shows a banner (for example "Local preview: demonstration data, not real
  orders") so a demonstration can never be mistaken for the real thing.

## 3. Routes

| Route | Kind | Behaviour |
|---|---|---|
| `/auth/sign-in` | page | Password form, email-link form, notices for expired or signed-out sessions. |
| `/auth/sign-up` | page | Sign-up form. |
| `/auth/check-email` | page | The same screen for a new address and an existing one. |
| `/auth/confirm` | route handler | Verifies the emailed link on the server, then redirects to a checked `/account` path. |
| `/auth/error` | page | One fixed message for any link that does not work. |
| `/account` | page | Overview; or, with no profile yet, the choice between claiming and starting a new profile. |
| `/account/orders`, `/account/orders/[ref]` | pages | List and detail. A malformed or someone else's reference is the same 404. |
| `/account/payments`, `/account/loyalty`, `/account/profile`, `/account/claim` | pages | As in section 1. |
| `/account/loading`, `error`, `not-found` | states | Skeleton while streaming, a calm retry screen that never shows the error, and a plain not-found. |

All account pages are dynamic (never cached or prerendered), `noindex`, and sent with `Cache-Control: private, no-store`.

## 4. Authentication architecture

**Server only.** The browser never holds a Supabase client. There is no Supabase code in any client bundle for these
routes: sign-in, sign-up, sign-out, profile, claim and the email-link request are Server Actions, and the email
confirmation is a route handler. This was a deliberate choice: the session never touches page script, so a script
injection cannot steal it, and there is no key in the browser other than the public anon key that the platform design
already allows (and that is used only on the server here).

* **Packages:** `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.118.0, both pinned exactly. The current
  `@supabase/supabase-js` needs Node 22 or newer; check the hosting project's Node version before the first preview.
* **A new client per request** (`src/lib/accounts/server/client.ts`). Nothing is shared between requests.
* **Cookies.** The session cookie is HttpOnly, `SameSite=Lax`, `Secure` whenever the request is HTTPS (or not a local
  address), path `/`, no `Domain` attribute, and capped at 30 days, whatever the library asks for
  (`src/lib/accounts/shared/cookies.ts`). A deleted cookie is written with a zero lifetime. The hardening is applied in
  both the middleware and the Server Components client.
* **Verifying the session.** Pages call `getUser()`, which asks the auth service. The middleware calls `getClaims()`,
  which verifies the token signature and refreshes an expired access token. The middleware is a first line, not the
  only one: every page re-checks (`src/lib/accounts/server/guard.ts`).
* **Session states** (`src/lib/accounts/server/session.ts`): `signed_in`, `signed_out`, `expired`, `unavailable`,
  `not_configured`. An outage of the auth service is **not** treated as a logout: a signed-in customer sees a "could
  not load, try again" screen and keeps the session, instead of being thrown to the sign-in page.
* **Email confirmation** accepts both link formats: `?token_hash=…&type=…` (recommended; works on any device) and
  `?code=…` (PKCE; works only in the browser that asked). Only `signup`, `email` and `magiclink` are accepted; a
  recovery, invite or address-change link is refused. Email confirmation must stay switched on in the project: that is
  what makes the auth service answer the same for an existing address.
* **No account enumeration.** These pairs give identical responses: sign-up for a new and an existing address; the
  email-link request for an address with and without an account (and `shouldCreateUser` is false, so it never creates
  one); resend-confirmation; every claim failure. A wrong password and an unknown user share one message.
* **No open redirect.** Every `next` value goes through `safeAccountPath` (`shared/redirect.ts`): one leading slash,
  no control characters, backslashes or encoded slashes and dots, same origin, and the path must be `/account` or
  below. Only the *path* is returned, never a query string or a host. Several of these checks overlap on purpose.
* **Passwords:** 10 to 72 bytes (the service hashes at most 72), not equal to the email address. Strength beyond that
  is the auth service's job and its message is passed on as "too easy to guess".
* **Rate limits** are the auth service's own and are reported as a calm "wait a few minutes". The project's limits must
  be reviewed when a real project exists (section 11).

## 5. Data access

* **Everything a customer sees is read as that customer.** Every query runs with the customer's own session, so the
  database's row level security does the isolation (`src/lib/accounts/server/data.ts`). There is **no service-role key**
  anywhere in this feature, no privileged client, and no query that takes a customer id from a form. A forged hidden
  field (`customer_id`, `email`) is ignored; the browser tests submit them.
* **Typed.** `src/lib/platform/supabase-database.ts` types the client against the Phase 1 row types, so a wrong column
  or table name is a compile error.
* **What a customer can read** is decided by the Phase 1 grants and policies, not by this code: the customer view of
  orders, items and payments has no supplier costs, margins, internal notes or internal references, and a retracted
  tracking update is excluded by policy. The browser tests check the rendered pages for those words anyway.
* **View models** (`src/lib/accounts/shared/view-models.ts`) turn rows into what the pages show. They contain **no
  business rules**: the status label, the deposit, the balance and the price all come from database rows; the code only
  formats money (QAR, minor units) and Qatar-time dates and orders the timeline (by time, then by the database's stage
  order, then by id, so it never depends on arrival order). Statuses at or above sort order 900 (on hold, cancelled)
  are shown as off the normal path.
* **Staff functions** (issuing a claim code, recording a payment, changing a status) are **not** part of this feature
  and are not callable from the browser. How they will be reached from Next.js without exposing the `admin` schema is
  in ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md.

## 6. Claiming an older order

Staff issue a single-use code for a customer record (`admin.issue_claim_code`, now reachable from the admin dashboard). It
is stored only as a hash, expires (24 hours, 3 days or 7 days), works once, can be **revoked** by staff with a reason, and
after five wrong tries in an hour every attempt from that account is refused (the code itself is not spent by someone
else's wrong tries). The customer types it at `/account/claim`. `claimAction` calls the database function
`claim_customer_profile`, which does all of the checking.

* Every failure (malformed, wrong, expired, revoked, already used, too many attempts, already linked) is the **same**
  empty answer, and the screen shows the **same** sentence, so it reveals nothing about whether a customer or a code exists
  (**proven** through the real REST layer: the answers are byte-identical).
* An account is **never** linked because an email address or phone number matches. A customer record with the same email
  as a signed-in account stays unlinked (**tested** through the real REST layer and in a browser).
* **Changed in PLAT-0003: the "profile blocks claiming" restriction is gone.** Before, an account that had created a new
  profile could never be linked to its older WhatsApp orders, which locked out exactly the customers who signed up first.
  Now an account may hold up to five linked customer records (primary key `(user_id, customer_id)`), each added by its own
  staff-issued code. Linking **adds** a record to the account; it does **not merge** two records, rewrite either, or move
  an order. Each link is an audited event (`customer.claim_code_used`, with who, which record and how many the account
  already had). The dashboard, payments and loyalty pages show the records together; the overview says so when there is
  more than one; loyalty balances are added up per record.
* **Account merging** (turning two customer records into one) is a different operation and is **not built**. If it is
  ever needed it must have explicit ownership verification and an auditable result, as the owner required; a claim code
  is the only verification that exists today, and it links, it does not merge.
* After success the page is loaded afresh (section 10) and shows the linked orders.

### 6a. Password recovery (new)

`/auth/forgot-password` asks for an email address and always answers the same sentence (an unknown address gets the same
answer and **no email**: tested). The email (template in `supabase/templates/recovery.html`) carries a one-time
`type=recovery` link to `/auth/confirm`, which signs the person in for the reset only and always continues to
`/auth/reset-password`, whatever `next` says. The new password follows the sign-up rules and is typed twice; on success the
account's other sessions are ended, and the old password stops working (all **browser-tested against the real Auth
service**, including that the same link cannot be used twice and that opening the reset page without a session sends the
visitor to start again).

## 7. States the dashboard handles

Signed out, session expired, auth service unavailable, not configured, no profile yet, no orders, no payments, no
loyalty history, an order that is not the customer's, a malformed order reference, a cancelled or on-hold order,
a fully paid order, a deposit outstanding, loading, and an error with retry. Demonstration data identifies itself
through the preview banner. No business figure is hard-coded in a component.

## 8. Security properties and where they are tested

| Property | Control | Evidence |
|---|---|---|
| Public site unchanged with the flag off | matcher, 404 gate | browser tests with the flag off; bundle comparison |
| Cannot be enabled in production | `VERCEL_ENV` check | unit test; mutation killed |
| A customer sees only their own rows | RLS, session-scoped queries | database tests; browser tests with two customers |
| Unauthenticated access refused | middleware and page guards | browser tests |
| Session expiry handled | `getClaims` refresh; expired state | browser tests with a short-lived token and revocation |
| Auth outage is not a logout | `unavailable` state | browser tests (service switched off) |
| Forged token refused | signature check | browser test with a token signed by another key |
| No account enumeration | identical responses | browser tests compare the pages |
| No open redirect | `safeAccountPath` | unit tests; browser tests; mutation killed |
| Claim code misuse | database function; one message | database tests; browser tests (reuse, expiry, rate limit) |
| No private data in customer pages | grants, view models | database tests; browser tests scan the pages |
| Cookie flags | `hardenCookieOptions` | unit tests; browser tests read the real cookie |
| No privileged key or browser client | static rules | static tests scan the source for the service-role key, browser Supabase clients and unguarded account routes |

## 9. The local emulator, and the official Supabase local stack

There are now **two separate kinds of test**, kept apart on purpose.

* **Emulator tests** (`npm run accounts:e2e`, 43 browser tests; and the unit and static tests): `supabase/emulator/`
  answers the auth and data requests in front of a real local PostgreSQL with the real migrations. **It is a mock of Auth
  and PostgREST, not Supabase.** It cannot prove how the real services behave.
* **Official-stack tests** (`npm run real:test`, `npm run real:e2e`): the Supabase CLI's own local stack in Docker (Auth,
  PostgREST behind Kong, the `supabase/postgres` image and Mailpit). Nothing is mocked. 72 tests: 37 API tests, 13 staff
  and gateway tests, 10 customer browser journeys and 12 staff browser journeys. They skip, never pass vacuously, when no
  stack is running. The setup is in `supabase/README.md`.

**What the official stack showed that the emulator did not** (each is a recorded test):

| Finding | Emulator said | The real service does | What was done |
| --- | --- | --- | --- |
| Signing up again with a registered address | Hid it by default (same answer as a new address) | **Refuses with 422 `user_already_exists`**, even with email confirmation on | The app already mapped that code to the same "check your email" screen as a new sign-up; a browser test proves the two screens are identical; a wrong code comment was corrected |
| Sign-out | A signed-out token was rejected everywhere | The **REST layer keeps accepting a signed-out access token until it expires** (it checks signature and expiry only); only `getUser()` and the session table know | The app asks the auth service (`getUser`) on every request, and the staff database function checks `auth.sessions` itself |
| Refresh tokens | Simplified | A retry of a used refresh token returns the same child; a replay once the child has been used is refused (`refresh_token_already_used`) but the **session is not revoked**, the newest token keeps working | Recorded; no change needed |
| Access-token signing | One shared secret | The CLI stack signs with **ES256 keys** (`kid` header) and still accepts the legacy secret at the REST layer | The server verifies through the library (`getClaims`); tests forge expired, altered, unsigned and wrong-key tokens and all are refused |
| User-editable metadata | Not modelled | A user **can** write `is_admin` and `role` into their own `user_metadata` through the auth API and it appears in their token | Authorization never reads metadata (static test); **proven** to change nothing |
| Email links | Not sent | Default links only work in the browser that asked for them | Token-hash templates (`supabase/templates/`) so links work on any device |
| `quotations` / `customers` writes | Mock | Column privileges and row level security as designed: customers cannot change a quotation's status or total, nor a customer's code or source | **Tested** through real PostgREST |
| `loyalty_balances.maybeSingle()` | One customer only | Fails when an account has two linked records | Fixed with the multi-record model (section 6) |

**Still not proven** (needs a hosted development project; the checklist is `supabase/tests/REAL_SUPABASE_CHECKS.md`): the
built-in mailer's rate limits and deliverability, custom SMTP, the hosted dashboard's settings and redirect allow-list, the
hosted JWT signing-key setup, connection pooling for the staff gateway, backups, and the behaviour of a project whose
region and plan are not yet chosen. **Do not claim the hosted integration works until they have been run.**

## 10. A finding about Next.js 15.5: do not rely on an in-app navigation straight after a Server Action

In the PLAT-0002 browser tests, after a Server Action succeeded, the router **sometimes did not move**: with a server-side
`redirect()` and, equally, with a client `router.replace()` right after the action. The database change had been made,
the old form stayed on screen, and the same sequence passed or failed depending on timing (about two attempts in eight
passed). Adding almost any instrumentation made it pass, which is why it was found only by repetition. **The cause was
not isolated in Next.js itself, and still is not.**

The one-time transitions this affects (creating a profile, linking records, changing a password, and creating a customer
or order in the admin dashboard) therefore end with a full page load (`window.location.assign`) to a destination the
server chooses (`AFTER_SUCCESS_PATH` for customers, a checked `/admin/...` path for staff). **Re-checked in PLAT-0003 on the
real stack**, Next 15.5.25 and React 19.3.0: these full loads passed in every run (at least five complete runs of each suite, with no
navigation failure). The dashboard's other forms (status changes, payments, tracking,
policies) update **in place** after the action using `revalidatePath`, and that also never failed in those runs, so the
problem seems limited to navigating immediately after an action. This is a statement about the runs that were made, not a
proof. It should be re-tested before the framework is upgraded or the workaround is simplified.

A second, unrelated finding from the same work: React 19 **clears an uncontrolled form after every submit**, including
after a validation error. A staff member who forgot one tick would have lost everything else they typed. The admin forms
now get the typed text back from the server (never a code, password or confirmation word), and the account forms keep the
email address in controlled inputs.

## 11. Not proven, and what remains before a real customer can sign in

* **Not tested against a hosted Supabase project:** see section 9. Everything in section 9's table was run on the official
  local stack, not on a hosted project.
* **Built since PLAT-0002:** the staff tools (customers, claim codes, orders, tracking, payments, policies, audit; see
  `STAFF_GATEWAY.md`) and password recovery. **Not built:** MFA for customers, account deletion, account merging, the
  quote-to-order path, a notification channel.
* **Owner inputs still needed:** the project's region and plan, a decision on sender address and email templates, approval
  to enable accounts anywhere beyond a preview, and the policy decisions listed in `DEPOSIT_POLICY_AUDIT.md` (the deposit
  schedule is now **confirmed**; refunds are not).
* **A proposed open question (not recorded):** whether customers may create an account before they have an order, or
  only after M1 has issued a claim code or confirmed an order. The code supports both; the sign-up page is currently
  open to anyone while the flag is on.

## 12. Trying it locally (no account, no network)

```
npm run accounts:preview          # starts the emulator and a throwaway PostgreSQL; prints the next command and demo logins
```

Then, in a second terminal, run the website with the three variables the first command prints (`CUSTOMER_ACCOUNTS_ENABLED`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus an optional preview label) using `npm run dev`, and open
`/auth/sign-in`. Emails are not sent; the emulator lists them at `/__outbox`. The demonstration customers are
synthetic and exist only for that run. The browser tests can also write screenshots: set `ACCOUNTS_E2E_SHOTS` to a
directory and run `npm run accounts:e2e`.

## 13. What the owner must do to try this against a real development Supabase project

This is the smallest set of steps. None of it has been done, and none of it is needed for the code to be reviewed.

1. **Create a separate development project** (not the one that will hold real customers). Choose its region, and
   confirm the plan is the free one with no paid add-ons. The region and plan are owner decisions that are not yet
   recorded.
2. **Apply the migrations** in `supabase/migrations/` in filename order (fifteen files), through the SQL editor or the
   Supabase CLI. The last migration runs a security audit and fails loudly if anything is exposed.
3. **Auth settings:** email sign-in on; **Confirm email ON**; anonymous sign-ins off; Site URL set to the preview
   address; that address plus `/auth/confirm` in the redirect allow-list; the Confirm-signup, Magic-link and Recovery
   email templates set to the token-hash form in `supabase/templates/` (they use the request's own redirect address, so
   the redirect allow-list must list the preview address); the rate limits reviewed.
4. **Vercel, Preview environment only** (never Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (the publishable key), `CUSTOMER_ACCOUNTS_ENABLED=true`, `CUSTOMER_ACCOUNTS_SITE_URL` (the preview address) and
   optionally `CUSTOMER_ACCOUNTS_PREVIEW_LABEL`. **Do not set the service-role key** anywhere; this feature never needs it.
5. **Confirm the Vercel project uses Node 22 or newer.**
6. **Run the Phase 2 section of** `supabase/tests/REAL_SUPABASE_CHECKS.md` with synthetic data, and record what differs
   from the emulator.

## 14. Blockers before a real customer can sign in

1. Nothing has been tried against a **hosted** Supabase project (sections 9 and 11). The official local stack agreed with
   the design and disproved two of the emulator's assumptions; a hosted project may differ again.
2. **Refund policy is undecided** (whether deposits are refundable, and which payment methods qualify). Nothing in the code
   assumes either.
3. **Production cannot enable accounts or the admin area** by design (section 2). Going live needs a deliberate, approved
   code change and a production Supabase project, with its own keys, backups and cost approval.
4. **Decisions the owner has not made:** sender address and templates for the emails, whether sign-up is open to
   anyone, and the privacy and terms wording for collecting accounts.
5. **Customer MFA, account deletion and account merging are not built.**
