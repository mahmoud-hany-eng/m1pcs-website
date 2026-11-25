# PLAT-0007 — run record, attempt 1 (final Orders page: paged, filtered, sorted list; account menu in the public header)

**Local only. Nothing was pushed, merged or deployed.** No hosted database was contacted or changed, the one new migration was applied only to disposable local PostgreSQL 16
databases, and Production, `main`, `claude-dev`, the Workflow V2 default, customer, payment, loyalty and cost records, customer sign-in, the staff second-step (MFA) rules and
the Instagram creative files were not touched. The brief is recorded as HD-0024. The design is in [ORDERS_LIST.md](../../../architecture/ORDERS_LIST.md) and
[PUBLIC_HEADER_ACCOUNT_MENU.md](../../../architecture/PUBLIC_HEADER_ACCOUNT_MENU.md); the owner's acceptance steps are Part 8 of
[FINANCIAL_OWNER_ACCEPTANCE_CHECKLIST.md](../../../architecture/FINANCIAL_OWNER_ACCEPTANCE_CHECKLIST.md) (**not performed**: it needs the real staff second factor).

## What was built

| Layer | Files |
| --- | --- |
| Database (forward-only, additive, rerunnable; one new function and nothing else) | `20261125120000_orders_list_paging.sql`: `admin.list_orders_page`. `admin.list_orders` is **not** touched, so every earlier website build keeps working |
| Staff gateway, API, types, pure address rules | `src/lib/staff/{gateway,api,types,orders-list}.ts` |
| Orders screen | `src/app/admin/orders/page.tsx` (completed-orders table removed), `src/components/admin/{orders-controls,finance,ui}.tsx`, the Overview's links in `src/app/admin/page.tsx` |
| Public header | `src/components/layout/{Header,AccountMenu}.tsx`, `src/lib/account-nav.ts`, `src/lib/accounts/shared/header-nav.ts`, `src/app/layout.tsx`, the menu's motion in `src/app/globals.css` |
| Tests | `orders-list.db.test.mjs` (30), `orders-list-lib.test.mjs` (16), `orders.pages.db.test.mjs` (20), `orders.layout.browser.test.mjs` (40), `header.browser.test.mjs` (22), one new rule and one exception in `static.test.mjs`; the existing finance, compatibility and release tests updated for the moved table, the new gateway statement and the new migration |
| Documents | `ORDERS_LIST.md`, `PUBLIC_HEADER_ACCOUNT_MENU.md`, Part 8 of the owner checklist, HD-0024, OQ-0048 and OQ-0049, the PLAT-0007 section of `supabase/release/README.md` |

## Verification (all on the final tree)

| Check | Result |
| --- | --- |
| `npm run test:db` (real PostgreSQL 16, real migrations, rendered pages, static rules) | **1149 tests, all pass** (1082 before this work) |
| `npm run test:browser` (customer journeys, finance layout, the new Orders layout at five widths, the account menu on four builds of the site) | **178 of 178 pass** (116 before) |
| `npm run ops:validate` | OK, 1 warning that predates this work (`OPS-0006-consumer-integrity.md` has no approval reference) |
| `npm run ops:test` | 563 of 563 pass |
| `npm run lint` | no problems |
| `npx tsc --noEmit` | clean |
| `npm run build` | compiles; every public page is still static (`○`), the account, admin and auth routes are dynamic (`ƒ`) as before |
| Mutation checks (24 deliberate breakages, one at a time, each file restored from a backup) | **24 of 24 caught** (below) |

### Mutation checks

| # | Breakage | Caught by |
| --- | --- | --- |
| 1 | price sorts by the gross total instead of the amount payable | 2 tests |
| 2 | the end of a custom range is not inclusive | 6 |
| 3 | the start of a range is exclusive (the first second is lost) | 7 |
| 4 | days are cut in UTC instead of Asia/Qatar | 30 |
| 5 | a month with no year no longer means the current year | 2 |
| 6 | equal values have no id tie-break | 3 |
| 7 | a custom range no longer takes precedence over month and year | 7 |
| 8 | a page past the end is not moved back to the last page | 3 |
| 9 | the page offset is wrong | 15 |
| 10 | the list no longer requires `orders.read` | 1 |
| 11 | the total ignores the date filter | 4 |
| 12 | a start date after the end date is accepted | 1 |
| 13 | a date that is not real is accepted | 1 |
| 14 | the address keeps default values | 1 |
| 15 | the page ignores the sort in the address | 2 (after two tests were added, see below) |
| 16 | the paging links forget the report's choices | 1 |
| 17 | Reset filters keeps the filters | 1 |
| 18 | the filter form carries the page number | 1 |
| 19 | the header offers account links on a production deployment | 2 |
| 20 | the Staff Dashboard entry no longer needs the staff switch | 1 |
| 21 | the menu does not close on a click outside | 1 |
| 22 | Escape closes the menu but does not return focus to the button | 1 |
| 23 | the button does not say whether the menu is open | 2 |
| 24 | the hamburger menu has no Account group | 3 |

The first run **missed** number 15: every page test used the default sort, so a page that ignored the address's sort passed. Two tests were added (the rows follow each of
the four sorts; every other choice also reaches the database) and the mutation was caught on the rerun.

## Defects found and fixed while testing

* Browser checks at 1024 and 768 px showed the Status select squeezed to 88 px and the table wider than its scroll box. The wide arrangements now start at 1280 px, the Sort
  column is wider, and below 1280 px the orders are cards (with the placed date) instead of a table.
* The legend of the date-range group wrapped over its border when "in use" was appended; the legends are short now and the explanation is a line under the fields.
* The first page links carried an unwanted default report year; only the report choices the person made are carried.
* The full regression run found three existing tests that had to learn about this release, each changed for a stated reason: the stub that stands in for the gateway in
  the order-page render test needed the new statement's mapping, and the deployed-statement compatibility test pins the gateway's statements, so the one added statement
  (`list_orders_page`) is listed as its own release group. The ops tests showed that a project-memory document must not link outside the memory tree (the fixture trees do not
  contain `supabase/`); the link is written as plain code text like every other document does.
* Existing tests changed **on purpose** (all in the same direction, never loosened): the finance page tests that looked for the removed completed table now assert it is gone
  and that the report is unchanged; the release test's migration list has one more release (the new migration, pinned by name); the static rule that keeps public files free of account code has one pinned,
  narrow exception (the root layout importing the pure link module) and a new rule that pins what that module may import.

## Known limits

* The staff screens were not driven through a real login (it needs a real second factor). Pages are rendered from real database answers and their markup, with the website's own
  compiled stylesheet, is checked in a real browser at 1280, 1024, 768, 390 and 360 px; screenshots were inspected at desktop and phone widths. The owner's checklist closes the rest.
* The header cannot know whether a visitor is signed in (the sign-in cookies are `HttpOnly`, and reading them would make every public page dynamic): OQ-0048. It hides only entries
  that are plainly redundant on the page being viewed.
* The public pages are built once per deployment, so the header's account button follows the switches of the **build**. On Vercel the build and the running site share one
  environment, so a Preview with the switches on shows it and Production shows nothing. Changing a variable needs a new deployment.
* A person without `finance.read` no longer sees a completion date anywhere on the Orders page: OQ-0049.
* The new function sorts and counts with a plain query. At this business's volume that is trivial; an index on the date placed is the first step if the table ever holds hundreds of thousands of orders.
* Still a **separate Production blocker, deliberately not changed here:** the legacy 6- and 7-argument `admin.create_order` overloads can create an order without the owner's
  discount and redemption rules.
* Reminders carried from the earlier releases: revoke the Vercel project-scoped token; add the Supabase Auth redirect entry for the Preview URL before any customer e-mail flow
  test; clawback after a payment reversal remains unimplemented (OQ-0043); the hosted 11-argument `admin.create_order` carries the one-blank-line M2 deviation.

## Release

The safe DEV plan (migration first, then one normal push, then verification and the owner's Part 8 acceptance) is in `supabase/release/README.md`, section "Orders list paging and the account menu (PLAT-0007)".

## Commits

Local commit on `claude/plat-0004-order-hardening`, not pushed (see `git log`).
