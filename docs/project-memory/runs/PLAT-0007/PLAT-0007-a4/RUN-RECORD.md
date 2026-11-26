# PLAT-0007 — run record, attempt 4 (unified login, personalised header, the public header above both dashboards)

The brief is recorded as HD-0027. It follows attempt 3 ([RUN-RECORD](../PLAT-0007-a3/RUN-RECORD.md): the simplified Orders page, receipts and the three-entry account menu; migration and Preview accepted on DEV). Scope: **navigation and sign-in routing**,
with one additive database function. **Local only: nothing is pushed**, the hosted DEV database was not touched, and there is no change to Production, `main`, `claude-dev`, the workflow default, MFA, any role or permission, any order / payment / loyalty / receipt
record, the deposit tiers, the accounting, or the Instagram files. The design is [UNIFIED_LOGIN_AND_NAVIGATION.md](../../../architecture/UNIFIED_LOGIN_AND_NAVIGATION.md).

## What the owner asked for, and where it lives

| Request | Where it is |
| --- | --- |
| Signed-out header: the profile icon with exactly **Log in** and **Create account** | `src/lib/accounts/shared/header-nav.ts`, `src/components/layout/AccountMenu.tsx`, `HeaderAccount.tsx` |
| Signed in: the person's name and icon open the right dashboard directly, no second menu | `src/components/layout/HeaderAccount.tsx` (`HeaderIdentityLink`), `src/app/auth/header-identity/route.ts`, `src/lib/accounts/server/header-identity.ts`, `src/lib/account-nav.ts` |
| Safe names: staff from the staff table, customers from their linked profile, never typed or matched; neutral label when there is none | `admin.my_staff_profile()` (migration `20261127120000`), `loadCustomerDisplayName`, `headerLabel` / `cleanDisplayName` |
| One universal login with shared server-side routing; staff to MFA then `/admin`, customers to `/account`, new customers keep onboarding; fail safe on a staff-lookup failure | `src/lib/accounts/shared/post-auth.ts` (pure rules), `server/post-auth.ts`, `src/app/auth/continue/page.tsx`, `signInAction`, `/auth/confirm`, the sign-in page, the account page |
| The public header on every staff dashboard page, sticky, with the sidebar beneath it; no overlay, no hiding CSS | `src/components/admin/AdminShell.tsx`, `AdminLoading.tsx`, `src/app/admin/mfa/*`, `src/app/admin/error.tsx`, `src/components/layout/HideOnAdmin.tsx`, `src/app/layout.tsx` |
| The same header on the customer dashboard, with its own navigation | unchanged structure; the header now names the customer |
| Mobile: the existing hamburger, a compact account control, no second hamburger, the 1024px fix kept | `src/components/layout/Header.tsx` |

## What changed, in one paragraph each

* **Routing.** Every way of becoming signed in ends at `/auth/continue`, which asks the server (`getStaffState`) and sends the person on by `routeAfterSignIn`: staff with the second step done to `/admin`, staff without it to `/admin/mfa` (and back to the page they wanted afterwards), everyone else to `/account`; a failed staff lookup goes **nowhere** (a "could not finish signing you in" page with Try again and Sign out) and is never read as "customer". A staff member without a customer profile is redirected from the new-customer set-up to `/admin`.
* **Header.** The root layout stays static. The control asks an uncached route after the page loads and again on a new page, a returning tab, or a page restored from history; the answer is a label, a kind and one of three fixed addresses and is read strictly. Below 640px only the icon is drawn.
* **Admin shell.** Ordinary page content inside the site's `<main>`: sticky sidebar under the sticky header from 1024px, a compact block below; the footer and chat button are left out of `/admin` only (a client component reading the address, no global CSS).
* **Database.** One function, `admin.my_staff_profile()`; forward-only, additive, not applied anywhere hosted.

## Defects found by the tests while building it (all fixed)

| # | Found by | Defect | Fix |
| --- | --- | --- | --- |
| 1 | header browser test, 1440px, wide fallback font, long name | the 24px-free-each-side rule failed (16px): the header capsule stops growing at 1216px, so the extra name width allowed from 1440px only squeezed the links | one cap from 1280px (6rem); the 9rem cap below |
| 2 | header browser test | public pages carry the control only if the switches were on at BUILD time (the root layout is static); the default test build has them off | a second build with the switches on (`ensureSwitchedBuild`), which is what a Vercel Preview is |
| 3 | layout test design | the work-area title block of the admin shell was a second `<header>` | a plain `div`; the page has one `<header>` |
| 4 | "larger text" test | setting the root font size does not move the **em** breakpoints, so it tested nothing real | the browser's own default text size is set through the DevTools protocol (`Page.setFontSizes`); this also **retires the earlier limit** "larger default text could not be driven" |

## Verification (final tree)

| Check | Result |
| --- | --- |
| `npm run test:db` (real PostgreSQL 16, real migrations, rendered pages, static rules) | **1295 of 1295 pass**, 0 skipped (1212 before: +40 server, +18 database, +22 static for this change, and the existing header / library / compatibility tests updated). The first full run found 1 failure: the attempt-3 "migration is additive" comparison saw the newer function; it now leaves later migrations out of the comparison (that file: 29 of 29) |
| `npm run test:browser` | **248 of 248 pass**, 0 skipped (202 before: the header file grew from 26 to 49, one new file of 18 layout tests). The first full run found 1 failure: a customer 404 comparison read the page's header text, which now names the signed-in person; it compares the page content area instead (that file: 16 of 16). `accounts.e2e.test.mjs` (43 tests, every sign-in, sign-up, magic-link, confirmation, recovery and claim journey) passed **unchanged** against the new routing |
| `npm run ops:validate` / `npm run ops:test` | OK (the same 1 warning that predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | no problems / clean / compiles (`/auth/continue` and `/auth/header-identity` in the route list; the public pages stay static) |
| Mutation check (`run-unified-nav-mutations.mjs`, 35 mutations on a copy of the tree) | **35 of 35 caught.** The first full run caught 33; two **survived** and were real gaps: (R10) the account page showing the new-customer set-up to a verified staff member, and (H13) the staff-name lookup reading a database error as "not staff" (a customer name). Tests were added (the account overview is now rendered for every staff state; the real lookup's failure handling is pinned) and both are caught |

New and rewritten tests: `unified-nav.server.test.mjs` (40: the routing matrix, the resolver, the `/auth/continue` page, the sign-in page, the account overview for every staff state, the header route, the real staff-name lookup's failure handling), `unified-nav.db.test.mjs` (18: `admin.my_staff_profile()` on a real PostgreSQL with forged claims, ended and foreign sessions, blank names, privileges), `unified-nav.static.test.mjs` (22), `header.browser.test.mjs` (49), `unified-nav.layout.browser.test.mjs` (18). Screenshots at 390, 768, 1024, 1280 and 1440 px were produced and reviewed (staff dashboard under the header, the customer dashboard, the signed-in header with a long name in three font conditions, the phone menus, 150% text).

## Limits

* The owner's real login with a real authenticator code was not driven (no local test can complete a second factor). Covered instead: the routing matrix with the verified-staff state controlled, the new database function on a real PostgreSQL with forged claims and ended sessions, the header and layout in a real browser with the answer the route gives a verified staff member, and a real customer sign-in / sign-out / expiry against the emulator. **The authenticated owner flow is for the owner to test on the DEV Preview.**
* E-mail confirmation, magic link and recovery were driven against the emulator (mocked delivery); the hosted Supabase Auth redirect list must contain the Preview URL first.
* The staff dashboard layout was verified with the real header and the real `AdminShell` markup placed in a real page (the live `/admin` pages need a second factor).
* Reminders carried: revoke the Vercel project-scoped token; add the Supabase Auth redirect entry for the Preview URL before customer e-mail tests; clawback after payment reversal is not implemented (OQ-0043); the hosted 11-argument `admin.create_order` one-blank-line deviation; the legacy 6- and 7-argument `create_order` overloads remain a Production blocker; the historical-order importer and retroactive loyalty are not started (to be designed separately).

## Owner decisions remaining

OQ-0057 (where a staff display name is set), OQ-0058 (one identity request per page view), OQ-0059 (several linked profiles; staff who are also customers), OQ-0060 (the retry screen when the staff check cannot be made).
