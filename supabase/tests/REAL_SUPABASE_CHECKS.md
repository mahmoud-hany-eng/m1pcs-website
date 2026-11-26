# What a local run cannot prove: checks for the first real Supabase project

The local suite runs the migrations on a real PostgreSQL server with a small shim that imitates the Supabase roles and
`auth.uid()` / `auth.jwt()`. That proves the SQL. It cannot prove the parts of Supabase that sit around the database.
This is the list to work through, on a **development** project, before anything real depends on this schema.
None of it has been done **on a hosted project**: no Supabase project exists for M1 yet. Since PLAT-0003 most items have been
run against the **official Supabase local stack** (the CLI's Docker services), which is the real software but not a hosted
project: section 8 says which, and what is left for a hosted project.

Record each result (pass, fail, not applicable) with the date, the project's reference **kept out of the repository**,
and the migration version applied.

## 1. The migrations on the real platform

- [ ] All fifteen migrations apply in order on a fresh project without error. (Local stack: done, PostgreSQL 15.20.)
- [ ] `select count(*) from private.security_audit();` returns `0`.
- [ ] The migrations ran as Supabase's `postgres` role (not a superuser, as in the local run). Confirm every staff
      function in `admin` still works end to end, because they rely on their owner being able to read the `private`
      schema: re-run the scenarios of `tests/db.test.mjs` by hand or through the API.
- [ ] Supabase's own default privileges did not re-grant anything the migrations revoked. The audit in the previous
      item is the check; also confirm `\dp public.payments` shows only `SELECT` for the API roles.
- [ ] `gen_random_uuid()` and the `generated ... stored` columns behave the same on the project's PostgreSQL version
      (the migrations use nothing newer than PostgreSQL 15; the local run used 16).

## 2. The Data API (PostgREST)

- [ ] Dashboard, API settings: **only `public`** is exposed. `private` and `admin` are not listed.
- [ ] With only the anon key: `GET /rest/v1/quote_categories` and `/order_statuses` return rows; `/customers`,
      `/orders`, `/payments`, `/quotations`, `/loyalty_ledger` return nothing or an error.
- [ ] A request for the `private` or `admin` schema (`Accept-Profile: private`) is refused.
- [ ] With two real customer sessions, each sees only their own rows in `orders`, `order_items`,
      `order_tracking_events`, `payments`, `loyalty_ledger`, `loyalty_balances` and `customers`.
- [ ] A customer's `PATCH`, `POST` or `DELETE` on `orders`, `payments`, `loyalty_ledger` fails.
- [ ] `loyalty_balances` (a `security_invoker` view) returns only the caller's balance through PostgREST.
- [ ] Search the full JSON of every customer-facing response for a planted supplier name, internal note and internal
      payment reference. None may appear.

## 3. Auth (GoTrue)

- [ ] A real customer token carries the `sub` that `auth.uid()` reads, and `role = authenticated`.
- [ ] A staff user who has enrolled TOTP and verified it gets `aal = aal2` in the access token; one who has not gets
      `aal1` and is refused by the staff functions while the `admin.mfa` policy requires a second factor.
- [ ] Editing `user_metadata` as a signed-in user (allowed by Supabase) grants nothing. Try setting `role`, `is_admin`,
      `permissions` and confirm `admin.my_permissions()` is unchanged.
- [ ] Email confirmation, rate limits and CAPTCHA are configured as the owner decides (see Phase 2 recommendations).
- [ ] Anonymous sign-ins are disabled (`config.toml` says so for local use; the hosted setting is in the dashboard).

## 4. Claim codes and sign-up

- [ ] A new customer can create their own profile (`create_my_customer_profile`) and sees it, and no other.
- [ ] A staff-issued claim code links exactly one account to exactly one customer, once. A second use, a wrong code
      and an expired code each return null and do not reveal which one it was. Five wrong tries in an hour lock the
      account out for the rest of the hour.
- [ ] A new sign-up with the same email or phone as an existing customer is **not** linked to that customer.

## 5. Realtime

- [ ] The `supabase_realtime` publication contains only customer-safe tables (at most `order_tracking_events`, plus
      `orders` if a live status is wanted). No `private` table is published (the audit checks this too).
- [ ] A customer subscribed to `order_tracking_events` receives only their own orders' updates.
- [ ] The customer page still works with Realtime off, by polling (REC-PLAT-013).

## 6. Operations

- [ ] The service-role key exists only in server-side settings and is not in any client bundle or log.
- [ ] Backups are enabled to the extent the chosen plan allows, and a restore has been tried on the development project.
- [ ] The development and production projects are separate and have different keys.
- [ ] The cost of the chosen plan, and anything that would move a paid feature into use, is approved by the owner first.

## 7. Customer accounts and dashboard (Phase 2)

The browser tests in `accounts.e2e.test.mjs` run the real website against `supabase/emulator/`, which imitates a subset
of GoTrue and PostgREST. Every item below is therefore **unproven until it is run against a real development project**.
Use a project with synthetic data only, set `CUSTOMER_ACCOUNTS_ENABLED=true` in a Preview environment only, and keep
`CUSTOMER_ACCOUNTS_SITE_URL` equal to that preview's address.

- [ ] Sign-up with email and password sends a confirmation email, and the account cannot sign in until it is confirmed.
- [ ] Sign-up for an address that already has an account gives the same screen and the same words as a new address,
      and no second email reveals anything (email confirmation must be ON for the service to answer this way).
- [ ] The confirmation link works in the `token_hash` format (switch the email templates to it) on a different device,
      and works once. The default PKCE link works only in the browser that signed up.
- [ ] There is no sign-in by email link: the sign-in page offers none, and a magic-link email requested straight from the
      Auth API (public key) ends at "That link did not work" on `/auth/confirm` and creates no session. Check what the
      project's "Magic Link" email template says: the repository's reference template carries no link and no token.
- [ ] Forgot password for an unknown address answers the same as for a known one and sends no email; the recovery link
      opens the new-password page on any device, works once, and ends the account's other sessions.
- [ ] Wrong password and unknown address give the same message; the service's rate limits answer with the "wait a few
      minutes" notice; note the actual limits and decide whether to tighten them.
- [ ] The session cookie set by `@supabase/ssr` against the real service is HttpOnly, SameSite=Lax, Secure on HTTPS,
      under 30 days, and fits in the browser's cookie size limit (it may be split in chunks).
- [ ] `getClaims()` in the middleware works with the project's real JWT signing keys (symmetric or asymmetric) and
      refreshes an expired access token; a revoked session is refused on the next page load.
- [ ] Row level security as PostgREST applies it: a customer's token reads only their own orders, items, payments,
      tracking and loyalty rows, and cannot read any `private` table or the cost columns, through the Data API.
- [ ] A retracted tracking update (migration 13) disappears from the customer's timeline.
- [ ] A staff-issued claim code links the right customer once; wrong, used and expired codes look identical; the fifth
      failure in an hour locks the account out for the hour.
- [ ] The service-role key is not set in the website's environment at all (this feature never needs it).
- [ ] The Vercel project builds with Node 22 or newer (`@supabase/supabase-js` 2.x requires it).
- [ ] Re-test the profile-creation and claim flows in a real browser: in the local browser tests a Server Action
      redirect sometimes failed to move the page, and the code ends those two flows with a full page load
      (see CUSTOMER_ACCOUNTS.md section 10).

## 8. Results of the official local stack (PLAT-0003), and what is left for a hosted project

Run on the Supabase CLI 3.2.0 local stack (Auth v2.198.0, PostgREST v16.5, supabase/postgres 15.20, Mailpit v1.31.3).
72 tests; the commands are in `supabase/README.md`. Nothing here is a hosted result.

| Section | Local-stack result | Left for a hosted development project |
| --- | --- | --- |
| 1 migrations | All 15 apply as the platform's `postgres` role; `security_audit()` and `gateway_audit()` return 0 | The same on the hosted project; its default privileges and region |
| 2 Data API | Only `public` exposed (admin, private, auth, extensions give PGRST106); anon sees two reference tables; no staff function or staff table is reachable; two customers are isolated by list and by id; no write to orders, payments, items, tracking or loyalty; only permitted profile columns are editable; quotations cannot be altered by the customer; no private data in any customer response | The dashboard's exposed-schema setting |
| 3 Auth | Claims (`sub`, `role`, `aal`, `session_id`) as the code expects; a real authenticator code gives `aal2` on the same session; a wrong code does not; forged `user_metadata` changes nothing; expired, altered, unsigned and wrong-key tokens are refused; sign-out ends the session in the auth service but **not** at the REST layer until the token expires (a finding) | Hosted rate limits and the built-in mailer; CAPTCHA; the project's JWT signing-key setup |
| 4 claim codes | One-time, expiring, revocable, rate limited at five, identical failures, no automatic link by email or phone, a second record can be added | Same, on the hosted project |
| 5 Realtime | Not used by this phase; excluded from the local stack | Not applicable until used |
| 6 operations | The service-role key appears nowhere in the website code | Backups, separate projects, cost approval |
| 7 customer accounts | All items run in a real browser except those that need real deliverability. **Duplicate sign-up**: the real service answers 422 `user_already_exists` (it does not hide it); the app shows the identical screen anyway. Token-hash links work on a fresh browser and only once. Cookies are HttpOnly, SameSite=Lax, not readable by script; an expired access token is refreshed and new cookies are written; a revoked session is refused on the next page load; a damaged cookie is a sign-out. The session cookie is not Secure on local http (expected) | `Secure` on HTTPS, cookie size with the hosted session, the hosted redirect allow-list, email deliverability |

## 9. The staff gateway and the admin dashboard (hosted development project only)

Do these after section 8, on a development project, with synthetic data, in a Preview environment, following
`docs/project-memory/architecture/STAFF_GATEWAY.md` section 6.

- [ ] The gateway login connects from the hosting provider through the project's **direct or pooled** connection string. If
      the pooled (transaction mode) string is used, a staff call and the claim-setting statement run in one transaction
      and prepared statements are not required: confirm both work and that two staff members' calls on a busy pool never
      see each other's identity (the local test alternates 12 calls; repeat it against the pooler).
- [ ] `select count(*) from private.gateway_audit();` returns `0`, and the role has no login until the owner sets a password.
- [ ] A staff member with a live second-factor session reaches `/admin`; a staff member who has not entered the code is
      sent to the second step; a customer and a signed-out visitor see the site's ordinary not-found page for every admin
      address.
- [ ] Signing out ends admin access at once (replay the old cookie).
- [ ] Rotating the gateway password (`alter role m1_staff_gateway ... password`) locks the dashboard out until the host's
      variable is updated, and nothing else changes.
- [ ] Production: confirm `STAFF_ADMIN_ENABLED` and `CUSTOMER_ACCOUNTS_ENABLED` are **not** set, and that `/admin` and
      `/account` answer the ordinary not-found page.

## Not covered anywhere yet

Storage, Edge Functions, email templates, and any payment provider. None is used by this phase.
