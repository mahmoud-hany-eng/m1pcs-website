# Order costs and financial reporting: the owner's acceptance test in the real Admin Dashboard

**Status: NOT PERFORMED.** Nothing in this checklist has been run. The automated tests (real database, rendered pages in a real browser at desktop and phone width, static rules)
do not cover typing into the staff forms, because the staff dashboard needs a real second factor. This checklist closes that gap, by the owner, once.

**Where:** the Vercel Preview of the development project, signed in as the owner with the second factor. **Data:** synthetic only: a customer named `ZZ TEST Finance Customer`
with a made-up phone number and an `@example.test` e-mail. Do not use a real customer. Money below is in QAR.

**Before you start:** the two PLAT-0006 migrations are applied to the DEVELOPMENT database and the Preview is deployed (see `supabase/release/README.md`).

## Part 1: costs at order creation (optional)

| # | Do | Expect | Result |
|---|---|---|---|
| 1.1 | **New order** for the test customer, one item 5,000.00. Leave **Direct order costs** closed. Create it. | The order is created exactly as before. The order page says **No costs recorded** (not zero). | |
| 1.2 | **New order**, one item 5,000.00. Open **Direct order costs (optional, private to the owner)**. Add *Components* "Graphics card" 2,000.00 *Estimated*, then **Add another cost**: *International shipping* "Freight" 150.00 *Estimated*. | "Costs entered" shows 2,150.00. Create the order. The order page shows two entries, direct costs 2,150.00 (estimated), **Costs incomplete**, profit marked provisional. | |
| 1.3 | Sign in as an ordinary staff member (no finance rights) and open the same order and **New order**. | No cost, profit or margin anywhere; the **Direct order costs** section does not exist. | |

## Part 2: costs at every stage

| # | Do | Expect | Result |
|---|---|---|---|
| 2.1 | On the 1.2 order, **Add a cost**: *Customs and import duties* 300.00 *Estimated*. | Saved; total 2,450.00. | |
| 2.2 | Click the same **Add cost** button twice quickly (double click). | One entry only (the same form sent twice saves once). | |
| 2.3 | **Edit** "Graphics card": amount 1,900.00, *Actual*, supplier reference `INV-TEST-1`, reason "invoice arrived". | The entry shows 1,900.00 Actual. Open **Cost history**: it lists the old and new amount, the kind, the reference, your name, the time and the reason. | |
| 2.4 | Open the same order in a second browser tab; in the first tab edit an entry; in the second tab edit the same entry. | The second save is refused with a message that the entry changed; nothing is overwritten. | |
| 2.5 | **Remove** the Customs entry, reason "wrong order". | It leaves the totals, is listed under "1 removed entry", and its history is kept. | |
| 2.6 | Change the two remaining entries to *Actual*, then **Mark costs complete**. | **Costs complete**; profit and margin are no longer provisional. | |
| 2.7 | Edit any entry afterwards. | **Costs complete** is replaced by **Costs incomplete** automatically, and the history says it was reopened. | |
| 2.8 | Move the order through the stages to *Delivered*; add one more cost (*Local delivery* 40.00 *Actual*) **after** it is delivered. | Allowed. The cost is added; the order stays Delivered. | |

## Part 3: the completion date

| # | Do | Expect | Result |
|---|---|---|---|
| 3.1 | On a *paid and delivered* order, read the note under the money figures. | "Completed <date and time> (recorded automatically …). Reports count this order in the month it was completed, not the month it was placed." | |
| 3.2 | Try to change the order's status after it is Delivered. | There is no way to: Delivered / Collected is final. | |
| 3.3 | Find an order that was delivered **before** this release and has no history of the move. | It shows **Needs historical verification** and is not counted in any month. Enter the real date and time from your own records and a reason, then **Record the completion date**. It now counts in that month, and the date cannot be changed again. | |

## Part 4: Orders page, Financial performance

| # | Do | Expect | Result |
|---|---|---|---|
| 4.1 | Open **Orders**. | **Financial performance** is above the order list. The year is the current year; the month is *All months*. | |
| 4.2 | Read the five figures. | Net revenue, Total direct cost, Order profit, Completed orders, Margin. When some completed orders have incomplete or no costs, a yellow note says so, how much revenue has no cost recorded, and that it is left out of the profit and margin. | |
| 4.3 | Read the January to December table. | Twelve rows; the Costs column says *Complete*, or how many orders are incomplete or have none. | |
| 4.4 | Pick a month, or click a month name. | The figures above change to the orders **completed** in that month, by completion date. An order placed last month and completed this month is in this month. There is no separate completed-orders table; the normal **Orders** list below is not filtered by this choice. | |
| 4.5 | Change the year to a past year. | The figures and the table change; nothing else does. | |
| 4.6 | On a phone (or a 390 px wide window), open the same page. | No sideways scroll; the month table is shown as cards with the same figures. | |
| 4.7 | Sign in as ordinary staff. | The Orders list is there; no Financial performance section, cost, profit or margin. | |

Check one month by hand: add up the net payable of the orders completed in it (original total less discount less loyalty credit); that is Net revenue. Add up their cost entries: that is Total direct cost.
Order profit is the difference **for the orders that have costs**.

## Part 5: Overview

| # | Do | Expect | Result |
|---|---|---|---|
| 5.1 | Open **Overview**. | Three groups: **Operations** (Active orders, Completed orders of the year), **Financial performance** (Total net revenue, Total order profit), **Needs attention**; then Recent orders. Not a wall of cards. | |
| 5.2 | Change the year. | Completed orders and the financial figures change; **Active orders** does not. | |
| 5.3 | Click **Detailed monthly reports in Orders**. | You land on Financial performance for that year. | |

## Part 6: Customers tab

| # | Do | Expect | Result |
|---|---|---|---|
| 6.1 | Open the test customer. In **Order history**, find an order that has a discount and redeemed points (create one with the Pricing & Rewards section if needed). | The card shows the original total, the discount, the loyalty credit and the **Final net payable** prominently, then Paid so far and Outstanding. It says a payable amount is not money received. | |
| 6.2 | Open **Order details**. | Items with quantity and line price; the discount and credit spread over the lines, and a net per line that adds up exactly to the final net payable; payments with receipt numbers; status and tracking history. The original prices are unchanged. | |
| 6.3 | Look for any cost, supplier, profit, margin or the internal discount reason. | None anywhere on this page. | |

## Part 7: what must NOT have changed

| # | Check | Expect | Result |
|---|---|---|---|
| 7.1 | The existing synthetic order `O-2611-00001`. | Total 4,350.55; deposit 1,087.64; paid 4,350.55; 435 loyalty points; two receipts; four tracking updates. Unchanged. | |
| 7.2 | **Policies**: the deposit schedule and the workflow switch. | Five tiers; the workflow default is still version 1. | |
| 7.3 | The customer's own order page on the website. | The customer sees the same figures as before and **no** cost, supplier, margin or profit. | |

## Part 8: the Orders list (filters, sort, paging) and the account menu (PLAT-0007)

Behaviour and definitions: [ORDERS_LIST.md](ORDERS_LIST.md) and [PUBLIC_HEADER_ACCOUNT_MENU.md](PUBLIC_HEADER_ACCOUNT_MENU.md). Use the DEV Preview, with the synthetic orders only.

| # | Do | Expect | Result |
|---|---|---|---|
| 8.1 | Open **Orders** with no choices. | Above the table there are only a **search field**, a **Sort** button and a **Filter** button. The table has seven columns: **Order, Customer, Order price, Cost, Profit, Placed, Receipts**. Under the buttons: **Latest 5 of N orders**, newest first (the newest is first); **Previous** is greyed and **Next** goes to page 2. There is **no** "Orders completed in ..." table, no always-visible filter form and no rows-per-page control. A **Monthly financial report** button sits below the list (closed). | |
| 8.2 | Click **Filter**. | A compact panel opens over the table with **Status**, **Month**, **Year**, **From**, **To**, **Apply** and **Clear filters**. A press elsewhere or Escape closes it; opening **Sort** closes it. After a choice the button shows how many filters are in use. | |
| 8.3 | Choose **November** and a year, then Apply. | The list shows orders **placed** in that month ("placed in November ..."). The Financial performance figures above do **not** change. | |
| 8.4 | Open **Filter**, enter a **From** and a **To** date (for example 10 Nov to 25 Nov) and Apply. | Orders placed on those days, both days included. The summary line says "placed from ... to ..." and that **dates are used instead of the month and year**. | |
| 8.5 | Enter only a From date, then only a To date. | An open-ended range each time. | |
| 8.6 | Enter a From date **after** the To date. | A message names both dates; no list is shown; the dates are still in the fields. | |
| 8.7 | Click **Sort** and choose **Price: high to low**, then **Price: low to high**. | The menu opens over the table (the table does not move). Ordered by what the customer has to **pay** (an order with a discount and credit is placed by its payable amount; no "was" figure). Equal prices keep a steady order from page to page. The Sort button names the sort in force. | |
| 8.8 | Combine a month, a status, a search and a sort; use **Next**. | Every choice is kept on every page; the address in the browser holds them, so the page can be bookmarked. Changing any filter returns to page 1. | |
| 8.9 | Go past the last page by editing `page=` in the address. | Counts and pages are right; the last page is shown. There is no rows-per-page control (the latest 5 per page is the default). | |
| 8.10 | Open the Orders page on a phone (390 px). | The search field has its own row, **Sort** and **Filter** share the row under it, nothing scrolls sideways, and each order is a card showing Customer, Order price, Cost, Profit, Placed and a Receipts button. Both menus open full width under the buttons. | |
| 8.11 | On the **website** header (a Preview with accounts on), look right of **Get a Quote**. | A small circular account icon. A click opens a dark menu with **exactly three entries: Log in, My account, Track my order** (no Create Account, no Staff Dashboard). It closes on a click elsewhere, on Escape (focus returns to the icon) and when you use an entry. | |
| 8.12 | While signed out, click **My account**, then **Track my order**. | Each takes you to sign in first and, after signing in, back to the account page or the orders page. Nothing about an account or an order is shown before sign-in. | |
| 8.13 | On a phone, open the header's hamburger menu. | The same three entries in an **Account** group below the page links; the menu still fits the screen. | |
| 8.14 | Open the **live Production website** header. | **No** account icon and no link to an account, sign-in or staff page. | |
| 8.15 | Make the browser window about **1024 to 1270 px** wide and look at the header. | The bar shows the logo, **Get a Quote**, the account icon and a menu button; the six page links are **not** squeezed in. Click the menu button: a list of the six links hangs under it (it does not repeat Get a Quote or the Account group). Pressing the account icon closes it and the other way round. | |
| 8.16 | Widen the window to **1280 px or more** (with the menu open at 1100 px, then widen). | The six links appear between the logo and Get a Quote on **one row**; the menu button is gone; an open menu closed by itself and the page scrolls normally. | |
| 8.17 | On the Orders page choose each of the six sorts in turn (Newest first, Oldest first, Price: low to high, Price: high to low, Profit: low to high, Profit: high to low). | The **Sort** button names the sort you chose each time and the rows follow it. Orders whose cost is not entered (profit shown as a dash) come **last** under both profit sorts. | |
| 8.18 | Look at the **Cost** and **Profit** columns on the newest orders. | An order with **no cost entered** shows a dash in both (never zero). An order with costs shows the cost and **order price minus cost**; a loss is red and negative; **provisional** appears under a profit until every cost is actual and the costs were declared complete. The numbers equal the ones on the order's own cost page. | |
| 8.19 | Sort by **Profit: high to low**, then **low to high**. | The best (or worst) profit is first; orders with no cost entered are always last. | |
| 8.20 | Look at the **Order price** of an order that had a discount or redeemed loyalty credit. | It is what the customer pays (total − discount − credit), not the original total. | |
| 8.21 | Click an **order number**. | The order's own page opens (status, items, payments, costs live there; they are no longer columns here). | |
| 8.22 | In a row, click the **paperclip button** (a number, or **Add**). | A small panel opens in the middle of the screen for that order: its receipts (name, size, date, **View**, **Download**, **Remove…**) and a drop area with **Upload PDF**. No drop area is visible anywhere in the table itself. A press outside, Escape or the Close button closes it. | |
| 8.23 | Drag a PDF onto the drop area (or click it and choose one), then **Upload PDF**. | "Receipt attached." The count on the row's button goes up. Sending the same upload twice (double click) attaches it once. | |
| 8.24 | Try a file that is **not a PDF** (a renamed picture or text file), an empty file, and one over **4 MB**. | Each is refused with a clear sentence and nothing is attached. Try attaching the **same PDF twice** to one order: refused ("already attached"). | |
| 8.25 | Click **View** and **Download** on a receipt. | View opens the PDF in the browser; Download saves it with its name (Arabic names work). While **signed out**, the same address answers "Not found". | |
| 8.26 | Click **Remove…** on a receipt, leave the reason empty, then give one. | An empty or very short reason is refused; with a reason the receipt disappears from the list. It is **kept** in the record (who, when, why) and is not served any more. | |
| 8.27 | Sign in as an **ordinary staff member** (no finance or payments permission) and open Orders. | Four columns only (Order, Customer, Order price, Placed); the Sort menu has four sorts; no Cost, Profit, Receipts, paperclip or monthly report anywhere. | |
| 8.28 | Open **Monthly financial report** below the list and pick a month. | The figures are unchanged from before; choosing a month or filtering the list never changes the other. | |
| 8.29 | On a customer account (a customer you created for testing), look at **every** customer page. | No cost, profit, margin, supplier or PDF receipt appears anywhere. | |
| 8.30 | Make the browser window about **768 px** and about **1100 px** wide and open Sort, Filter and a receipts panel in turn. | Each opens inside the screen over the table, is readable (opaque), nothing scrolls sideways, and only one menu is open at a time. | |

Record a result next to every row. Anything that does not match is a defect to report, not a step to skip.
