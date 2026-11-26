# PLAT-0007 — run record, attempt 6 (the sign-up and resend confirmation link)

A defect found while reviewing the attempt-5 release and fixed here: **the sign-up and resend confirmation emails could carry a link that does not exist.** It follows attempt 5 ([RUN-RECORD](../PLAT-0007-a5/RUN-RECORD.md): the one email-and-password login). Scope: **one line of application code, the tests that should have seen it, and records.** No database migration, no hosted change (database, templates, redirect list or any Auth setting), no change to MFA, the staff or customer routing rules, orders, payments, loyalty, receipts, the accounting, or the Instagram files.

## Root cause

The repository's email templates (`supabase/templates/confirmation.html`, `recovery.html`) build the emailed link as `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=...`. `{{ .RedirectTo }}` is the address the app hands the Auth service (`confirmUrl`, `src/lib/accounts/shared/site-url.ts`), and `&` only continues a query string that already exists. Until the unified-login commit **2cd3424** (26 Nov, deployed to DEV 20:26 UTC) sign-up and resend sent `…/auth/confirm?next=%2Faccount`. 2cd3424 stopped sending a `next` (the router decides the destination), so the address became `…/auth/confirm` and the template produced `…/auth/confirm&token_hash=…&type=email`: a path that does not exist, and no `token_hash` parameter. Password recovery always sent `next` and was never affected.

**Why no test saw it:** the local emulator composed its own links (`/auth/confirm?token_hash=…`) and never filled in a template, so every browser journey passed whatever the app sent.

## The fix

`confirmUrl` always sets `next` (to `/account` when no page is given). Nothing else in the application changed: `/account` is the usual landing place, not a request, so `routeAfterSignIn` / `continueUrl` drop it and the destination is still decided by verified staff membership (staff with the second step to `/admin`, staff without it to `/admin/mfa`, customers to `/account`, a failed staff check nowhere). It restores exactly the address shape that sign-up sent before 2cd3424 and that DEV demonstrably handled (below).

## Tests that fail when the bug returns

| Test | What it does |
| --- | --- |
| `supabase/tests/email-links.test.mjs` (new, in `test:db`, 21 tests) | Runs the **real** sign-up, resend and forgot-password actions against a stand-in Auth client and captures the address each hands to the service; fills in the **real** files in `supabase/templates` the way the service does; requires `/auth/confirm`, `token_hash` as a real query parameter, the right `type` (email, recovery), the page to return to, and no other parameter. Also: resend; HTML-escaped form; each template's type is one the confirmation route accepts and `magiclink` is not; the default Supabase template (`{{ .ConfirmationURL }}`: the service returns to the same address with `?code=`); a hostile Host / forwarded host and hostile `next` values (`//evil`, `https://evil`, backslashes, encoded slashes, `javascript:`, `/admin//evil`) never leave the site; the real confirmation route hands a verified link to the sign-in router, which sends staff by verified membership, customers to `/account`, and a failed check nowhere; a recovery link always ends at the new-password page; a sign-in (magic) link or any other type is refused without asking the Auth service. One test reproduces the original malformed link and requires the check to refuse it. |
| `supabase/emulator/gotrue.mjs` | For the two emails the site depends on (confirmation, recovery) the emulator now builds the recorded link by filling in the repository's template files; every browser journey that opens an emailed link therefore breaks on a malformed address. The sign-in-link email is still composed by the emulator as the worst case the site must refuse. |
| `accounts.e2e.test.mjs` | A new browser test for "Send the link again" (resend through the real template, link opened on another device); the unsafe-`next` test now rewrites the first query parameter. |
| `accounts-lib.test.mjs` | `confirmUrl` always has a query string. |
| Mutation rules E01 to E08 | E01 puts the 2cd3424 behaviour back (13 tests fail). Seven neighbours: template joined with `?`, a refused type in the recovery template, no type, the host taken from the request, no address sent at all, `magiclink` accepted again, a recovery link ending at the dashboard. **8 of 8 caught.** |
| Browser-level proof | The three sign-up journeys (confirmation works on another device, works once, resend) were run in a scratch copy with the old `confirmUrl`: **3 of 3 fail**, with the path `/auth/confirm&token_hash=…&type=email`. |

## What DEV shows (read-only, counts and timestamps only; no personal data)

| Fact | Result |
| --- | --- |
| Accounts / email-confirmed | 3 / 2 |
| The two confirmed accounts | both signed up through the website on 21 Nov and were confirmed **through this site's token-hash path** (no PKCE code was ever issued for them: 319 s and 26 s after sign-up), when the app sent an address **with** `?next=`. One of them is the owner's staff account. So a template of the repository's kind worked then. |
| The third account | signed up 26 Nov 18:24 UTC (before 2cd3424 was deployed) and was never confirmed |

This does **not** verify what the hosted templates contain today (OQ-0062): the connectors cannot read them.

## Verification

| Check | Result |
| --- | --- |
| `npm run test:db` | **1324 of 1324 pass**, 0 skipped (1302 before: +21 email-links, +1 `confirmUrl`) |
| `npm run test:browser` (the CI command) | **250 of 250 pass**, 0 skipped (249 before: +1, the resend journey) |
| `npm run ops:validate` / `npm run ops:test` | OK (the same 1 warning that predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | no problems / clean / compiles (the public pages stay static) |

## Limits

* The hosted Confirm-signup, Reset-password and Magic Link templates, the redirect list and the provider settings were **not read** (no connector exposes them) and **not changed**. Whether DEV's emails work is unverified until the owner reads them and runs the real-browser steps (OQ-0062).
* The emulator and these tests prove the app's address and the repository's templates; they say nothing about a dashboard that has been edited since.
* Reminders carried: revoke the Vercel project-scoped token; the staff display name is unset; clawback after payment reversal (OQ-0043); the hosted 11-argument `admin.create_order` one-blank-line deviation; the legacy 6- and 7-argument `create_order` overloads remain a Production blocker; the historical-order importer is not started.

## Owner decisions remaining

OQ-0061 (the hosted Magic Link template) and OQ-0062 (read the hosted templates and redirect list; run the real-browser sign-up and password-reset steps).
