# Unified login, the personalised header and the dashboards under the public header (PLAT-0007-a4)

Status: implemented locally on `claude/plat-0004-order-hardening`; **not pushed, not deployed, no hosted database touched**. The brief is HD-0027. It changes how a person gets to a dashboard and
what the website's header shows; it adds **no new permission** and weakens **no check**: every dashboard still verifies the sign-in, the staff table and the second factor on the server, exactly as before.

## 1. The one universal login

There is one public sign-in page, `/auth/sign-in`, for customers and staff alike. There is no staff login page and no link to one anywhere in the public site (a static test scans every route and the header).

Every way of becoming signed in ends at **one router**, `/auth/continue`, which asks the **server** what kind of person this is and sends them on:

| Way in | What happens |
| --- | --- |
| Password sign-in (`signInAction`) | ends with `redirect(continueUrl(next))` |
| Sign-up when the service returns a session at once | `redirect(continueUrl())` |
| E-mail link (magic link) and e-mail confirmation (`/auth/confirm`) | after the token is verified: `redirect(continueUrl(next))` (a **recovery** link still goes to the new-password page first, and from there to sign-in) |
| Visiting `/auth/sign-in` while already signed in | the page asks the same resolver and redirects (or, if the check could not be made, says so and offers **Sign out**) |
| Coming back from the second step | `/admin/mfa?next=<admin page>`: after a good code the person goes to the page they were heading to, not back to the second-step page |
| Session expired, re-authenticate | `/auth/sign-in?reason=expired&next=...`; the way back is the same-site `next` |

**The decision** is a pure function, `routeAfterSignIn(check, rawNext)` in `src/lib/accounts/shared/post-auth.ts`. Its only input from the person is an optional `next` address that passed the existing same-site
validation (`safeNextPath`); everything else is what the server verified (`getStaffState`):

| What the server verified | Where the person goes |
| --- | --- |
| Active staff, second factor done (`ok`) | `next`, or `/admin` |
| Active staff, second factor still needed (`needs_mfa`) | `/admin/mfa` (with the admin page they were heading to as `next`) |
| Not staff (`not_staff`), or the staff area is switched off (`disabled`) | `next` if it is an `/account` page, else `/account` (a new customer with no linked profile sees the usual set-up and claim-code screens there) |
| The staff check could not be made (`unavailable`: the staff service or database did not answer) | **nowhere**: a page says "We could not finish signing you in", offers **Try again** and **Sign out**. It is never read as "customer" |
| `signed_out` / `expired` | the sign-in page (`required` / `expired`) |

**Fail-safe, and no probing.** A lookup failure is its own outcome, so a staff member is never classified as a customer because a lookup failed, and a customer is never sent toward an admin address (it would only
answer 404). The check is made after sign-in, from the verified session, never from what was typed into the form, so the sign-in form's answer is the same for every address (an entered e-mail address is
never reported as "staff" or "not staff"). A staff member who has no customer profile is **not** sent to the new-customer set-up: `/account` asks the same router when there is no profile and follows a `go` to `/admin`.
Nothing is decided from an e-mail domain, a name, a phone number or a role sent by the browser (static tests pin this).

`/auth/continue` itself: signed out goes to sign-in, signed in is resolved as above. It needs no query other than the optional `next`.

## 2. The header

### 2.1 Signed out
The person icon beside **Get a Quote** opens a small menu with **exactly two entries: Log in (`/auth/sign-in`) and Create account (`/auth/sign-up`)**. "My account", "Track my order", "Admin Login", "Staff Login" and "Staff Dashboard" are not
offered. The disclosure behaviour of PLAT-0007 is unchanged: fade-and-slide opening (none with reduced motion), `aria-expanded` / `aria-controls`, ArrowDown / Up / Home / End, Escape returns focus to the button,
tabbing out or a click elsewhere closes it, any change of page closes it. Where the account routes are switched off (and always on a production deployment) there is no account control and no request at all.

### 2.2 Signed in
The menu is replaced by **the person's name and icon as ONE link** straight to their dashboard: `/admin` for verified staff, `/account` for a customer. No second menu, no Log in, no Create account.

* **How the header learns who is signed in without making public pages dynamic.** The root layout stays static (a static test forbids `next/headers`, `cookies()` and `force-dynamic` there), so public pages are built once and cached and can never contain a
  person's name. The control starts neutral (the signed-out icon, identical on the server and in the browser) and asks an **uncached route handler**, `GET /auth/header-identity`, after the page has loaded.
  It asks again on every new page (sign-in, sign-out and sign-up all end in one), when the tab becomes visible or focused again (at most once per 0.8 s), and when a page is restored from the browser's history; a late answer for an earlier question
  never replaces a newer one (request counter plus abort). If the service cannot be reached the previous view stays (at the very start, the signed-out icon).
* **What the route answers.** `{ state: "signed_out" }`, or `{ state: "signed_in", kind: "staff" | "customer" | "unknown", label, href }`. The only addresses are `/admin`, `/account` and `/auth/continue`. No e-mail, no identifier, no
  role, no permission, no phone. Headers: `Cache-Control: private, no-store, max-age=0`, `Vary: Cookie`, `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.
  Absent (404) while the account switch is off. A browser with no sign-in cookie is answered `signed_out` **without any network call** (a visitor to a public page costs the staff database nothing).
* **The client reads the answer strictly** (`parseHeaderIdentity`): any other address, kind or shape is refused and the signed-out icon stays; the label is cleaned (control, zero-width and bidirectional-override characters removed, whitespace collapsed, at most 60 characters), and rendered as text.
* **Prefetch is off** for the dashboard link, so no public page loads the dashboard (or asks the staff database) in the background.

### 2.3 Where the names come from (never from anything typed)
| Who | Source | Notes |
| --- | --- | --- |
| Verified staff | `private.staff_members.display_name` through the new function `admin.my_staff_profile()` | Same gate as `admin.is_staff_member()`: active staff row, and through the gateway a live, unexpired sign-in session of that user. Returns **only** `{ "display_name": name or null }`; no role, permission or other person. Does not need the second factor (it grants no data and decides only what to show). |
| A customer | the oldest linked customer profile's `full_name`, read **with the customer's own session and row-level security** (`customer_accounts` then `customers`) | Never matched by a name or phone number. |
| No name | the neutral labels **"Staff account"** / **"My account"**; a name is never invented and an e-mail address is never used as a name | |
| The staff lookup failed | `kind: "unknown"`, label "My account", link `/auth/continue` (which retries or offers Sign out) | Never a customer dashboard, never a staff one. |

A staff member who is also a customer is shown as staff and linked to `/admin`.

### 2.4 The bar at each width
| Width | In the bar | The six links |
| --- | --- | --- |
| below 640px | logo, account icon (the name is the link's accessible name and tooltip), menu button | in the menu with Get a Quote |
| 640px to 1023px | logo and "M1 GAMING PCS" wordmark, account control (icon, plus the name once signed in), menu button | in the menu with Get a Quote |
| 1024px to 80em (1280px) | logo, Get a Quote, account control, menu button | in the menu (does not repeat Get a Quote) |
| 80em (1280px) and up | logo, the six links, Get a Quote, account control | in the bar |

The name is cut with an ellipsis (`max-width` 9rem below 80em, 6rem from 80em) and the control may shrink (`min-w-0`) so a long name can never push the links or the logo; the 24px-free-each-side rule of the PLAT-0007 header test holds
in all three font conditions at 1280 and 1440px with a very long name (the header capsule stops growing at 1216px, so there is one rule from 80em). The hamburger menu holds **only the six public links and Get a Quote**; there is no Account group any more (the account control is in the bar at every width).

## 3. The dashboards under the public header

### 3.1 Staff dashboard (`AdminShell`)
Before, the admin shell was a full-screen overlay (`fixed inset-0 z-[60]`) with a `<style>` rule that hid the site's `body > header`, `body > footer` and the chat button. It is now **ordinary page content inside the site's own `<main>`**:

```
<body>
  <header>  (the public header: sticky, top-0, z-50, 4rem / 5rem tall)             one header, on every admin page
  <main>
    <div data-testid="admin-shell" class="mx-auto flex max-w-[96rem] flex-col lg:flex-row">
      <aside data-testid="admin-sidebar" class="lg:sticky lg:top-20 lg:h-[calc(100dvh-5rem)] lg:overflow-y-auto ...">   sidebar
      <div class="min-w-0 flex-1"> preview banner, then the work area
  <HideOnAdmin><footer> + chat button</HideOnAdmin>                               left out of /admin only
```

* **From 1024px** the sidebar sticks directly under the header (`top-20`) and is exactly as tall as the room that remains (`100dvh - 5rem`); it scrolls inside itself only when the window is shorter than its content (so Sign out stays reachable); the page has the one ordinary scroll.
* **Below 1024px** the dashboard's own navigation is a compact block under the header (brand, Sign out, a horizontally scrolling row of sections). It is separate from the header's one menu button: there is never a second hamburger.
* No `fixed`, no z-index of its own, no `<style>` injection, no CSS that hides the header. `HideOnAdmin` (a small client component using `usePathname`) renders nothing for the footer and the chat button on `/admin` paths, so nothing global can be left behind when the admin area is closed. The same was done for `/admin/mfa`, the admin loading skeleton and the admin error screen.
* The work-area title block is a plain `div` (not a `<header>`), so the page has exactly one `<header>`.
* Page content (the Orders page, the financial report, receipts) is unchanged; the sidebar's items, order and permissions filtering are unchanged.

### 3.2 Customer dashboard
Unchanged in structure: it was always inside the public site. It keeps its own navigation (Overview, My orders, Payments, Loyalty, Profile), the claim-code screens, and now shows the customer's name in the header. A customer has no link into the staff area and every `/admin` address
answers the ordinary 404 for them (staff switch off) or a sign-in.

## 4. Security boundaries kept (and how they are tested)
* No public Admin Login; the admin URL is not secret but is protected by the server (sign-in, staff table, second factor, permissions). `routeAfterSignIn` can only choose a destination; the destination checks for itself.
* The second factor is not bypassed: `ok` requires `aal2` (verified token claims) in `getStaffState`; without it the router sends the person to `/admin/mfa`.
* Role permissions are unchanged; no migration touches a role, a permission, an order, a payment, loyalty, a receipt or the accounting. The Production gates stay closed (`VERCEL_ENV=production` still answers 404 everywhere, including `/auth/continue` and `/auth/header-identity`).
* Customers' identity is never inferred from a matching name or phone number (the name comes from the account's own link under row-level security).

## 5. The one database change
`supabase/migrations/20261127120000_staff_header_profile.sql`: one new function, `admin.my_staff_profile()` (security definer, `search_path = ''`, stable). **Forward-only and additive**: nothing existing is replaced, no table or role changes. Executable by
`authenticated` and `m1_staff_gateway`; never `anon`, PUBLIC or `service_role` (checked inside the migration). **Not applied to any hosted database.** Without it the header would still work for customers; a staff member's header would say "Staff account" (the website treats a failing staff
lookup as `unknown`, linking to the router). See the release plan in `supabase/release/README.md`.

## 6. Tests
| File | What |
| --- | --- |
| `unified-nav.server.test.mjs` (40) | the routing matrix, the resolver, the `/auth/continue` page, the sign-in page, the account overview for every staff state (a staff member with no profile goes to `/admin`; a failed check shows no set-up screen), the header-identity route (no cookie costs no call, staff / customer / neutral labels, `unknown` on a staff-check failure, key set, headers, 404 when the switch is off, one auth call per request), the real staff-name lookup's failure handling |
| `unified-nav.db.test.mjs` (18) | `admin.my_staff_profile()` on a real PostgreSQL: owner / staff / inactive / customer / anonymous / forged claims, the live-session gate through the gateway, agrees with `is_staff_member`, privileges, no side effects |
| `unified-nav.static.test.mjs` (22) | every sign-in entry uses the router, no public staff login, the layout stays static, the identity route and module shape, the admin shell has no overlay / z-index / `<style>`, the header is never wrapped in `HideOnAdmin` |
| `header.browser.test.mjs` (49) | the two-entry menu and its keyboard and animation behaviour, the signed-in link, long and unusual names at 390 / 768 / 1024 / 1280 / 1440 in three font conditions, larger text (the browser's own default text size, set through the DevTools protocol), session changes, a real customer sign-in / sign-out / expiry, no name in another visitor's answer or in a cached page, the phone |
| `unified-nav.layout.browser.test.mjs` (18) | the real header above the real `AdminShell` (sticky header, sticky sidebar under it, one scroll, overlays, banner, 150% text, keyboard order), the customer dashboard (a real sign-in) at five widths, and signed-out access to every dashboard address |
| updated: `static.test.mjs`, `orders-list-lib.test.mjs`, `release.db.test.mjs`, the two `compat.*.deployed-statements.db.test.mjs` | new rules and the new migration / statement |

Browser tests use a **second build** of the same source made with the account switches on at build time (`ensureSwitchedBuild` in `supabase/tests/support/browser.mjs`), because the header's account control on public pages is decided at BUILD time (the root layout is static); that is what a
Vercel Preview is (build and run share their variables). The default test build (switches off) is still used for the "nothing offered" checks.

## 7. Limits (what was not and could not be tested locally)
* The owner's real login with a real authenticator code was **not** driven: no local test can complete a real second factor. The staff header and the router's staff branches are covered by server tests with the verified-staff state controlled, by the database tests of the new function, and by layout tests that give the real header the answer the route gives a verified staff member. **The authenticated owner flow is for the owner to test in the DEV Preview.**
* E-mail confirmation, magic link and password recovery were driven against the local emulator (real cookies, real policies; mocked e-mail delivery). The hosted Supabase Auth redirect list must contain the Preview URL before those e-mails are tested there.
* The staff dashboard layout is verified in a real browser with the real header and real `AdminShell` markup placed in a real page; the live `/admin` pages themselves need a second factor.

## 8. Owner acceptance steps for the DEV Preview (rows 9.x)

Prerequisite: the migration in section 5 has been applied to the DEV database (so a staff member's name can be shown) and the Preview URL is in the Supabase Auth redirect list (for the e-mail steps).

| Row | Do this | Expect | Result |
| --- | --- | --- | --- |
| 9.1 | Signed out, on any public page, look right of **Get a Quote**. | A person icon. A click opens a menu with **exactly Log in and Create account**. No My account, Track my order, Admin Login, Staff Login or Staff Dashboard. | |
| 9.2 | Use **Log in** with the **owner** e-mail and password. | The second-step (authenticator code) page; after a good code you land on **/admin**. | |
| 9.3 | Look at the top right of the page you landed on. | The public M1 header (logo, links, Get a Quote) with **your name and icon** (the name the staff table holds; "Staff account" if none is set). Exactly one header. | |
| 9.4 | Scroll the Orders page a long way. | The header stays at the top; on a desktop the dashboard sidebar stays directly beneath it and never overlaps it; the page has one scrollbar. | |
| 9.5 | Click your **name**, then your **icon**. | Each opens the dashboard (`/admin`) directly. There is no menu to open first. | |
| 9.6 | Open the public header's links (Home, Products ...) from inside the dashboard, then come back with your name. | The public pages open normally, the header still names you, and your name leads back to the dashboard. | |
| 9.7 | Sign out (the dashboard's Sign out). | You are taken to the sign-in page; the header shows the person icon and **Log in / Create account** again. | |
| 9.8 | Already signed in as the owner, open `/auth/sign-in` directly. | You are sent on to the dashboard (or the second step) and are not shown the sign-in form. | |
| 9.9 | Sign in as a **customer** (a test customer). | You land on **/account**; the header shows the customer's name; your name opens `/account`; no staff link anywhere; `/admin` shows "page not found". | |
| 9.10 | Create a **new** account and confirm it by e-mail. | You land on the normal set-up / claim-code screens; the header says "My account" until a profile exists. | |
| 9.11 | On a phone (about 390 px) as the owner. | One hamburger (public links and Get a Quote only); the account icon beside it opens the dashboard; the dashboard's own sections are a compact block under the header; nothing overlaps or scrolls sideways. | |
| 9.12 | Open **the live Production website** header. | **No** account icon and no link to an account, sign-in or staff page (unchanged). | |
