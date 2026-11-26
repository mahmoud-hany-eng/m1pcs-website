# The simplified Orders page, cost and profit, and PDF receipts (PLAT-0007-a3)

Status: implemented locally on `claude/plat-0004-order-hardening`; **not pushed, not applied to any hosted database, not deployed**. The brief is HD-0026. It builds on the paged,
filtered list in [ORDERS_LIST.md](ORDERS_LIST.md) (`admin.list_orders_page`, still in place for every website built before this one) and on the private cost records in
[FINANCIAL_REPORTING.md](FINANCIAL_REPORTING.md). The public header's account menu that was part of the same brief is in [PUBLIC_HEADER_ACCOUNT_MENU.md](PUBLIC_HEADER_ACCOUNT_MENU.md).

## 1. What the owner asked for, in one paragraph

The Orders page showed too much at once. It should show only a **search field, a Sort button, a Filter button and the table**; the table has **seven columns** (Order, Customer, Order
price, Cost, Profit, Placed, Receipts); the default is the **latest 5 orders, newest first**; Sort and Filter are compact menus that appear only when clicked; and **receipts are PDFs
attached to an order**, through a small panel opened from the row, never a drop area in every row.

## 2. The screen

| Part | Behaviour |
| --- | --- |
| Search | One field and a magnifier button (Enter also submits). Matches the order number, the customer's name or code. |
| **Sort** | A compact button that says the sort in force ("Sort · Newest first"). Click: a short menu **over** the table (the table does not move): Newest first, Oldest first, Price: low to high, Price: high to low, Profit: low to high, Profit: high to low. The current one is marked. The two profit sorts are offered only to a person who may see costs. |
| **Filter** | A compact button with a count of the filters in use. Click: a panel with **Status**, **Month**, **Year**, **From**, **To**, **Apply** and **Clear filters**. A date range replaces the month and year (the panel says so, and so does the summary). Filters narrow by the date the order was **placed** (Qatar time), never by the completion date the monthly report uses. |
| Table | Order (the order number, a link to the order's page), Customer, **Order price**, **Cost**, **Profit**, Placed, **Receipts**. Below 1280 px: one card per order with the same fields. |
| Receipts | A small button in the row: a paperclip and the number attached, or "Add". It opens a panel for that order (section 5). |
| Summary | "Latest 5 of N orders" by default; "Showing 6–10 of N orders · placed in March 2025 · status: Awaiting deposit" when narrowed; "Clear search and filters" when something is narrowed. |
| Pager | Previous / Next and "Page x of y" under the table, only when there is more than one page (OQ-0056). |
| Monthly report | The earlier *Financial performance* section is one click below the list ("Monthly financial report", collapsed; open by itself once a period was chosen in it). It is unchanged and independent of the list in both directions (tested). |

Everything that was on the page and is not in the list above is gone from it: the always-visible filter form, rows per page, the "Sorted:" note, and the Status, Type, Paid and Balance
columns (the order's own page shows them). The Sort and Filter menus are plain `<details>` elements, so they open and close without any script; a small script (`src/lib/menu-dismiss.ts`) only
adds a press outside and Escape, and makes sure one is open at a time.

## 3. The figures (one definition each, the same everywhere)

* **Order price** = what the customer has to **pay**: the order total less the discount and the redeemed loyalty credit (`orders.net_payable_minor`). Never the original total. A price sort sorts by this.
* **Cost** = the sum of the order's **active** private cost entries, actual and estimated, exactly as the order's own cost page adds them. **No entry at all means the cost is unknown: the cell is a dash, never zero.**
* **Profit** = order price − cost. Unknown cost means unknown profit (a dash), never "price minus zero". A loss is shown negative, in red. "Provisional" appears under a profit until every cost is
  actual and the costs were declared complete. The order's own cost page shows the same cost, profit and provisional flag (tested, order by order).
* A **profit sort** puts the orders whose profit is unknown last, in both directions, so they never pass for the best or the worst; ties fall back to the newest order, so paging never repeats or skips one.

## 4. Who sees what (decided in the database, mirrored by the screen)

| Person | Sees |
| --- | --- |
| Owner (holds `finance.read`, `payments.read`, `payments.record`) | all seven columns; the profit sorts; the receipts panel with upload and remove |
| Ordinary staff (none of those) | four columns (Order, Customer, Order price, Placed) and four sorts; **the answer does not even contain the cost, profit or receipt keys**, so there is nothing to hide or to leak |
| A customer, an anonymous caller | nothing: the new functions refuse them, and the new table is closed to the customer and public API |

`admin.list_orders_overview` builds each row from a small base (`id`, `order_ref`, `customer_name`, `net_payable_minor`, `created_at`) and **adds** `cost_minor`, `cost_state`, `profit_minor`,
`profit_is_provisional` only for `finance.read`, and `receipt_count`, `receipts` only for `payments.read`. A profit sort from a person without `finance.read` is refused (42501): sorting would
reveal the order of the costs. The answer also says `can_see_finance`, `can_see_receipts` and `can_manage_receipts`, and the page draws exactly what the database said.

## 5. Receipts

**What a receipt is.** A PDF attached to one order. Rules (enforced by the website's server action **and again by the database**): the file starts with `%PDF-` (a renamed file is refused), 1 byte to
**4 MB**, at most **10** active receipts per order, the same file is not attached twice to one order, the name is cleaned (no folder, no control or direction-changing character, no quote, always ends in
`.pdf`; Arabic names are kept). The upload is **keyed**: the form chooses a receipt id once, so a double click or a retry stores the file once and says so; the same id for a different file is refused.

**Where it is stored.** In the database, in `private.order_receipts` (bytes, size, SHA-256, who, when): row-level security on, **no privilege for `anon`, `authenticated` or `service_role`**, writable
only inside the staff functions, never deleted, never edited. This needs no new secret, no storage bucket and no public URL. See OQ-0050 for the alternative.

**Removing.** A receipt is **removed, not deleted**: it needs a reason (3 to 300 characters), the record keeps the file, who removed it, when and why, and it is no longer listed or served. The same file may be attached again afterwards. Repeating a removal changes nothing.

**Reading.** `GET /admin/receipts/<id>` (`?download=1` to save instead of open) answers only a verified staff session with `payments.read`; everyone else, including a customer, gets the same plain 404 as for
an address that does not exist. The answer is `application/pdf`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `noindex`, `Referrer-Policy: no-referrer`, and a `Content-Disposition` with the exact
name encoded safely. The admin middleware already keeps every `/admin` answer out of caches and search results.

**The panel.** The row's button opens the browser's own **popover** (no script needed to open or close; a press outside, Escape or Close shuts it; focus returns to the button): the order number, each receipt
(name, size, date, **View**, **Download**, **Remove…** which asks why), and a drop area with an Upload button. The drop area is the browser's own file field stretched over the zone, so dropping a file works natively;
the script only shows the chosen name, answers early about a wrong type or a file over 4 MB, and shows progress. On a phone the panel is centred and 32 px narrower than the screen.

**Audit.** Every add and removal is in the audit log (who, which order, which receipt, name, size, SHA-256, the removal reason). **The file itself is never in the log.**

## 6. Database objects (migration `20261126120000_orders_overview_and_receipts.sql`, additive, rerunnable)

| Object | Purpose | Permission |
| --- | --- | --- |
| `admin.list_orders_overview(...)` | the page's one query (nine arguments, same as `list_orders_page`, plus the two profit sorts) | `orders.read`; keys by `finance.read` / `payments.read` |
| `admin.add_order_receipt(order, receipt id, name, bytes)` | attach (keyed) | `payments.record` |
| `admin.remove_order_receipt(receipt id, reason)` | remove | `payments.record` |
| `admin.get_order_receipt(receipt id)` | the file, for the download route | `payments.read` |
| `private.order_receipts`, `private.receipt_file_name`, `private.guard_order_receipt_identity` | the table, the name cleaner, the "never delete or edit" guard | not reachable from the API |

No existing function, table, column, index, constraint, trigger or policy changes (proved by comparing a database with and without it: exactly these six functions and this one table differ). `admin.list_orders` and
`admin.list_orders_page` are untouched, so every earlier website keeps working. **Order of release: the database first, then the website** (an Orders page pushed before the migration would show an error in its list until the
migration is applied; nothing is lost). Nothing in this task was applied to DEV.

## 7. Leak review (what was checked)

* No source file outside the staff code and screens mentions a receipt, cost or profit identifier or the new staff functions (static test over every file in `src/`); the customer's own pages have no cost, profit, margin or supplier word and no PDF receipt.
* The new table and functions are in schemas `private` and `admin`; nothing is created in `public` and nothing is granted to `anon`, `PUBLIC` or `service_role` (migration self-check, database test and static test).
* An ordinary staff member's answer has no cost, profit, margin, supplier or receipt key anywhere, and their page has none of those words (rendered and searched).
* Customers, anonymous callers, forged claims and a first-factor-only owner session are refused by every new function; the receipt route answers 404.
* The audit trail holds no file content. Removed receipts are not served.

## 8. Tests

| File | What it proves |
| --- | --- |
| `orders-overview.db.test.mjs` (29) | real PostgreSQL 16 through the website's own gateway statements: the row shape per permission, price = payable, cost/profit rules and agreement with the order's cost page, profit sorts (unknown last, ties, paging), **answers identical to `list_orders_page` for 26 combinations of choices**, every receipt rule (PDF only, 4 MiB boundary, 10 per order, duplicates, names, keyed retry, id reuse), byte-for-byte read-back, removal with reason, permissions, audit without the file, immutability, closed to customers, additive migration, rerunnable |
| `orders.pages.db.test.mjs` (30) | the real page from the real answers: only search, Sort and Filter above the table; the columns; the default; both menus; filters and ranges against the database; cost, profit and receipts drawn from the database; the staff page with no trace of them; the report collapsed and independent |
| `orders.layout.browser.test.mjs` (65) | a real browser at 1280, 1024, 768, 390 and 360 px: no sideways scroll in any state or with any menu open, tappable controls, menus over the table without moving it and opaque, one open at a time, press-outside and Escape (the real script), the receipts panel centred, opening and closing three ways, the drop area's file field covering the zone, the staff view |
| `orders-overview.static.test.mjs` (13) | the leak rules, the route, the actions' permission, the gateway's bound `bytea`, the 4.5 MB request limit, the client files' imports, the popover and `<details>` markup, the page's seven columns |
| `receipts-lib.test.mjs` (8), `orders-list-lib.test.mjs` (19) | the pure rules: PDF signature, size, names' header encoding, the sorts, the filter count, the account links |
| `header.browser.test.mjs` (26) | the public menu: exactly three entries, the sign-in page marks "Log in" current, no staff or Create Account entry, the hamburger group |

## 9. Limits and what the owner still decides

OQ-0050 (where the PDFs live), OQ-0051 (no malware scan; who may upload), OQ-0052 (retention of removed receipts), OQ-0053 (the monthly report's place), OQ-0054 (what staff see), OQ-0055 ("Track my order" and the public
menu), OQ-0056 (the pager and the status column). Also: a receipt is checked by its first five bytes, not scanned; a file is limited to 4 MB by the hosting platform's request limit; the interactive upload and the
download were exercised through the database and the rendered markup, **not** driven through a real signed-in browser session with a second factor (see WORKFLOW_TESTS.md).
