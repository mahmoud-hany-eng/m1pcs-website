# What a local run cannot prove: checks for the first real Supabase project

The local suite runs the migrations on a real PostgreSQL server with a small shim that imitates the Supabase roles and
`auth.uid()` / `auth.jwt()`. That proves the SQL. It cannot prove the parts of Supabase that sit around the database.
This is the list to work through, on a **development** project, before anything real depends on this schema.
None of it has been done: no Supabase project exists for M1 yet.

Record each result (pass, fail, not applicable) with the date, the project's reference **kept out of the repository**,
and the migration version applied.

## 1. The migrations on the real platform

- [ ] All eleven migrations apply in order on a fresh project without error.
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

## Not covered anywhere yet

Storage, Edge Functions, email templates, and any payment provider. None is used by this phase.
