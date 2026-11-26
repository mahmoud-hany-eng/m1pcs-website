# PLAT-0007 — run record, attempt 3 (simplified Orders page, cost and profit, PDF receipts, three-entry account menu)

The brief is recorded as HD-0026. It follows the corrective release (attempt 2: [RUN-RECORD](../PLAT-0007-a2/RUN-RECORD.md); GitHub CI green, Preview Ready). Scope: the
**Orders page** and the **public account menu**, with one additive migration. **Local only: nothing is pushed**, the hosted DEV database was not touched, and there is no change to
Production, `main`, `claude-dev`, the workflow default, sign-in or MFA, or the Instagram files.

## What the owner asked for, and where it lives

| Request | Where it is |
| --- | --- |
| The Orders page shows a search field, a Sort button, a Filter button and the table, nothing else | `src/app/admin/orders/page.tsx`, `src/components/admin/orders-toolbar.tsx`; the Financial performance report moved below the list as a collapsed "Monthly financial report"; a Previous/Next pager stays under the table when there is more than one page (`orders-pager.tsx`) |
| Sort: Newest first, Oldest first, Price low to high / high to low, Profit low to high / high to low | the Sort dropdown; the two profit sorts are offered, and accepted by the database, only to a person with `finance.read` |
| Filter: Status, Month, Year, From/To (a range overrides month and year); no filters = latest 5, newest first | the Filter panel; the same server-side rules as before (`admin.list_orders_page` is unchanged and still serves the older callers) |
| Table: Order (link), Customer, Order price, Cost, Profit, Placed, Receipts | seven columns; order price is `orders.net_payable_minor` (what the customer pays after discounts and loyalty), cost is the internal cost roll-up, profit is price minus cost |
| PDF receipts per order, small modal, drag and drop, list, preview, download, remove, no big drop area in every row | `src/components/admin/receipts.tsx` (a button with a count opens a browser popover), `src/app/admin/receipts/[id]/route.ts` (the file), `src/lib/staff/receipts.ts` (the rules) |
| Account icon next to Get a Quote with exactly Log in, My account, Track my order | `src/lib/accounts/shared/header-nav.ts`, `src/lib/account-nav.ts`, `src/components/layout/AccountMenu.tsx` |

## The migration (additive, forward-only, not applied anywhere)

`supabase/migrations/20261126120000_orders_overview_and_receipts.sql`

* `private.order_receipts`: private table (row level security on, every grant to `anon`, `authenticated` and `service_role` revoked, write guard, identity guard, truncate guard). A row is **never
  deleted**; the only change allowed is active to removed, with who, when and why. Checks: a `.pdf` name, 1 byte to 4 MiB, the bytes start with `%PDF-`, the size matches the bytes. One active row per
  order and file hash.
* `admin.add_order_receipt(order, receipt id, file name, bytes)` (`payments.record`): empty, too large and not-a-PDF are refused; 10 active receipts per order; the same file twice on one order is refused;
  a retry with the same receipt id and the same file answers as a repeat; the same id with another file is a key reuse. Audited as `order.receipt_added` without the file.
* `admin.remove_order_receipt(receipt id, reason)` (`payments.record`): reason of 3 to 300 characters; a repeat is a repeat. Audited as `order.receipt_removed`.
* `admin.get_order_receipt(receipt id)` (`payments.read`): the file, only while it is active.
* `admin.list_orders_overview(...)`: the Orders page in one call (count, page, filters, years, rows). Cost, profit and provisional flag are **keys that exist only when the caller holds `finance.read`**; the receipt
  count and list only when the caller holds `payments.read`. No cost entry means the cost is unknown (null, never zero) and an unknown profit sorts last under both profit sorts.

## Behaviour changes a person will notice

* Orders page: shorter, one table of seven columns, a Sort menu and a Filter menu (each closes on an outside click or Escape and the other closes when one opens; both work without scripting), search
  kept as the first control. Status is no longer a column (still a filter, and on the order's own page). On a phone the table becomes cards with the same fields.
* Receipts: a "Receipts (n)" button per order; for the owner the panel lists the files (preview, download, remove with a reason) and takes a drag-and-drop or a chosen PDF; for ordinary staff the column,
  the cost and the profit are absent (not hidden: they are not in the answer at all).
* Public header: the account button opens Log in, My account, Track my order (Create Account and the Staff Dashboard link are no longer in the public menu); the mobile menu carries the same three.
  "Log in" is left out inside `/account` and `/admin` (the person is already signed in). **The button exists only where the customer-account switch is on** (the same gate that guards the routes, as before this change):
  on a production deployment the gate is closed, so the header draws no account button and no visitor is offered a link that would answer 404. "My account" and "Track my order" send a visitor who is not signed in to the sign-in page and back.
* The upload limit is 4 MiB per PDF (the platform refuses a request body above 4.5 MB); `next.config.ts` raises the server-action body limit to 4.5 MB to match.

## Verification (final tree)

| Check | Result |
| --- | --- |
| `npm run test:db` (real PostgreSQL 16, real migrations, rendered pages, static rules) | **1212 of 1212 pass**, 0 skipped (1152 before; the first full run found 19 failures, all of them old-layout assumptions that this change legitimately replaced, corrected and re-run) |
| `npm run test:browser` | **202 of 202 pass**, 0 skipped (186 before) |
| `npm run ops:validate` / `npm run ops:test` | OK (the same 1 warning that predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | no problems / clean / compiles (`/admin/orders` and `/admin/receipts/[id]` in the route list) |
| Mutation check (`run-orders-overview-mutations.mjs`, 48 mutations on a copy of the tree) | **48 of 48 caught.** The first full run caught 46: one mutation's find-text was wrong (it expected two places where the migration has one; corrected) and one **survived** (the PDF signature's fifth byte, the dash after `%PDF`, was not tested; a `%PDF1.4` and a `%PDFx` case were added to `receipts-lib.test.mjs`, and both mutations now fail a test) |

New and rewritten tests: `orders-overview.db.test.mjs` (29: parity of the new list with `list_orders_page` over 26 filter and sort combinations for owner and staff, the finance keys absent for staff, cost unknown
is not zero, price is the net payable, receipts rules, limits, audit, immutability, privileges), `orders-overview.static.test.mjs` (13: leak scan of `src/`, the client import allowlist, the route's headers, no storage
bucket or new secret), `receipts-lib.test.mjs` (8), `orders.pages.db.test.mjs` (30, rewritten), `orders.layout.browser.test.mjs` (65 at 1280, 1024, 768, 390 and 360 px, including the panels opening, closing,
dropping a file and the keyboard), `header.browser.test.mjs` (26, three entries), `orders-list-lib.test.mjs` (19).

## Leak review (admin-only financial data and receipts)

* The database answer for a person without `finance.read` has no `cost_minor`, `cost_state`, `profit_minor` or `profit_is_provisional`, and without `payments.read` no receipt keys (tested against a real ordinary-staff session).
* The Orders page is rendered from the answer; a rendered staff page is searched for every cost and profit figure of the test data (none).
* Static scan of everything under `src/` that is customer-facing: no reference to `order_costs`, `order_receipts`, `list_orders_overview`, `cost_minor` or `profit_minor`; the customer account pages read only through the customer's own row-level-security views.
* The receipt file route answers 404 (not 403) to anyone who is not signed in as staff with `payments.read`, sends `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy: same-origin`.
* The audit trail records the file name, size and hash, never the file.

## Limits

* Pages that need a signed-in staff session were rendered from real database answers and driven in a real browser against static HTML and the compiled CSS; they were **not** driven through a live sign-in with a second factor.
* The drag-and-drop was tested by putting a file on the real input in a real browser; a native drag from the desktop was not driven.
* Receipt files are stored in the database (no object storage), have no malware scan, and a removed receipt's bytes are kept; see OQ-0050 to OQ-0056.
* The migration has been run only against the local test database (PostgreSQL 16). It has **not** been applied to the hosted DEV project.
* Reminders carried: revoke the Vercel project-scoped token; add a Supabase Auth redirect entry for the Preview URL before customer e-mail tests; clawback after payment reversal (OQ-0043); the hosted 11-argument `admin.create_order` one-blank-line deviation; the legacy 6- and 7-argument `create_order` overloads remain a separate Production blocker.

## Owner decisions remaining

OQ-0050 receipt storage (database bytes now, object storage later?), OQ-0051 malware scanning and who may upload, OQ-0052 how long removed receipts are kept, OQ-0053 where the monthly report should live,
OQ-0054 what ordinary staff should see on the Orders page, OQ-0055 the public menu ("Track my order" target, Create Account), OQ-0056 the pager and the status column.
