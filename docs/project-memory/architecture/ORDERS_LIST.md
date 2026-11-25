# The Orders page: list, filters, sort and paging (PLAT-0007)

Status: implemented locally on `claude/plat-0004-order-hardening`; **nothing is applied to a hosted database, pushed or deployed** (see the DEV release plan in
`supabase/release/README.md`). The brief is HD-0024. The financial design this builds on is
[FINANCIAL_REPORTING.md](FINANCIAL_REPORTING.md); the staff gateway is [STAFF_GATEWAY.md](STAFF_GATEWAY.md).

## 1. What changed on `/admin/orders`

1. **The separate "Orders completed in <period>" table is gone**, with its anchor (`#completed-orders`), its own pagination (`fp`) and every link that pointed at it.
   The *Financial performance* section above the list is untouched: the year and month selectors, the five figures, the January to December table and its by-
   **completion-date** grouping in Asia/Qatar time. The functions behind it (`admin.financial_report`, `admin.list_completed_orders`) and all financial data are
   unchanged and still tested; only the display of the duplicate table was removed. The Overview's links to the completed orders now go to *Financial
   performance* (or, for staff without `finance.read`, to the delivered orders).
2. **The operational Orders list** is filtered, sorted, counted and paged **in the database** (`admin.list_orders_page`, migration
   `20261125120000_orders_list_paging.sql`). The page never loads the orders to slice them: it asks for one page.

## 2. The list's behaviour

| | |
| --- | --- |
| Default | the **5 newest** orders by date placed, newest first, any status, any date; "Showing 1–5 of N orders"; Previous / Next; "Page 1 of K" |
| Search | order number, customer name or customer code (as before; `%`, `_` and `\` are plain characters) |
| Status | one status, the earlier-workflow codes included (Workflow V1/V2 are both listed and both display) |
| Period | by the date the order was **placed** (never the completion date, never the report's period): **Year** (All years or an available year) and **Month** (All months or January to December), **or** a custom range |
| Custom range | **From** and **To** are Qatar calendar days, **inclusive at both ends**; either may be empty (open-ended); it **takes precedence** over month and year, and the panel shows that (the month and year group is dimmed and says "ignored", the range group is highlighted, and the sentence under the filters says custom dates are used) |
| Month with no year | means that month of the **current Qatar year**; the answer reports the year it applied and the year list shows it selected |
| Invalid dates | not a real date, a date outside 2020 to 2100, or a start after the end: an explained message and **no list** (a different list than the one asked for would mislead); the controls keep what was typed |
| Sort | **Newest first** (default), Oldest first, **Lowest** / **Highest order price first**. Price is what the customer has to **pay**: order total − discount − redeemed loyalty credit (`net_payable_minor`); never a cost or a profit |
| Equal values | ordered by date placed (newest first) and then by the order id, so pages never repeat or skip an order |
| Paging | 5 per page by default; 5, 10 or 25 offered; the page is clamped to the last page; a change of filter or sort starts again at page 1 (the form carries no page number) |
| Shareable | every choice is in the address: `q`, `status`, `year`, `month`, `from`, `to`, `sort`, `size`, `page` (defaults are left out, so the plain page is just `/admin/orders`) |
| Report | the report's own choices (`fy`, `fm`) ride along in every list link and form, and the list's choices ride along in the report's form and month links. Neither changes the other (tested) |

The price column shows the **payable** amount, with "was QAR X" under it when a discount or loyalty credit was taken off (the value sorted and the value shown are the
same). Below 1280 px the orders are one **card** per order (with the placed date); from 1280 px they are a table (eight columns need that width beside the sidebar).

### Layout

One panel, in rows: **row 1** Search and its button; **row 2** Month and Year | From and To; **row 3** Status, Sort by, Rows per page, **Apply filters** and **Reset
filters**; then the count line and the table or cards; then Previous / Next. Search and Apply submit the same form (a phone shows the buttons at both ends of the
panel). Reset goes to the plain list and keeps only the report's own choices. The search field takes the width of its row (the earlier screen's collapsed field is fixed).

## 3. The database function

`admin.list_orders_page(p_search, p_status, p_year, p_month, p_from, p_to, p_sort, p_page, p_page_size) returns jsonb`. `STABLE`, `SECURITY DEFINER`,
`orders.read`, executable by signed-in staff and the staff gateway only. It returns `total`, `page`, `pages`, `page_size`, `first`, `last`, `sort`, the **effective**
`filters` (including whether a range overrode the period), the `years` in which orders were placed, and `rows` with exactly the fields `admin.list_orders` returns
(no cost, margin, profit, supplier or note). Day boundaries are `date::timestamp AT TIME ZONE 'Asia/Qatar'` (Qatar is UTC+3 all year), the end of a range being the
start of the next day, exclusive.

**Backward compatibility.** `admin.list_orders` is **not touched**: every website built so far keeps calling it. The migration adds one function, no table, column,
index, trigger, policy or privilege to an existing object (proved by comparing a database with and without it: exactly one function differs). It is rerunnable and
has no destructive undo, because there is nothing to undo.

**Scale.** The sort is a plain `ORDER BY` over the filtered rows, with a count. At this business's volume that is trivial; if the order table ever holds hundreds of
thousands of rows, add a `created_at` index then. No index was added now because the `CASE`-driven ordering could not use one.

## 4. Tests (all local; real PostgreSQL 16 and the real pages)

| File | What it proves |
| --- | --- |
| `orders-list.db.test.mjs` (30) | the default 5, newest/oldest as exact reverses, price by payable (an order with the biggest gross sorts in the middle), ties across pages, Qatar boundaries to the second (23:59:59 / 00:00:00 at a day, month and year end), year / month / month-only, inclusive ranges and open ends, range precedence, invalid choices, combined filters, **a differential check of 90 combinations against an independent JavaScript model**, 140+ orders paged, no interference with the completion report, permissions and privileges, the shape of a row, and that the migration is additive and rerunnable |
| `orders-list-lib.test.mjs` (16) | the address rules: defaults, fallbacks, real calendar dates (leap years), the start-after-end message, the written-back address, and the header's account-link rules |
| `orders.pages.db.test.mjs` (20) | the real page: the completed table and every reference to it gone, Financial performance intact, the default list, the layout order, choices shown back, range precedence made visible, invalid ranges explained, Reset, paging links, the two forms carrying each other's choices, the report unaffected by any list choice, the rows following each of the four sorts, ordinary staff |
| `orders.layout.browser.test.mjs` (40) | a real browser at 1280, 1024, 768, 390 and 360 px: three rows in order, a full-width search field, controls stacked on a phone, nothing cut off or scrolling sideways, cards or table, the range state visible |
| mutation check | 24 deliberate breakages, one at a time (20 in the migration, the address rules, the page, the controls and the header's link rules; 4 in the header menu's browser behaviour), all caught. One was missed at first (the page ignoring the sort) and two page tests were added for it; see the run record |

## 5. Known limits and open questions

* A person **without `finance.read`** used to see the completed-orders list (without costs) on this page. That table was the one the owner asked to remove, so they
  now see delivered orders in the ordinary list but no completion date. OQ-0049 asks whether the list should show it.
* The list shows the order's gross as "was" only when a discount or credit applies. A later payment reversal changes the paid and balance columns, never the price.
