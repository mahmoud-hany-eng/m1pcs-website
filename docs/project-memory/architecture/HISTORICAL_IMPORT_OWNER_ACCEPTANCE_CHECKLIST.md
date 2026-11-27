# Historical orders import: the owner's acceptance test in the real Staff Dashboard

**Status: NOT PERFORMED.** Nothing in this checklist has been run. The automated tests (a real database, the real pages in a real browser at four widths, static rules) cannot type into the staff forms,
because the staff dashboard needs a real second factor. This checklist closes that gap, by the owner, once, **on synthetic data**, before any real customer record is imported.

**Where:** the Vercel Preview of the **development** project, signed in as the owner with the second factor. **Data:** the synthetic file `supabase/tests/fixtures/historical/synthetic-historical-orders.csv`
(36 rows, made-up names `… Test`, phones `+974 555xxxxx`, receipt links on `attachments.example.test`). **Do not upload the real export here.** Money is in QAR.

**Before you start:** the two PLAT-0008 migrations are applied to the DEVELOPMENT database and the Preview is deployed (`supabase/release/README.md`, "Historical orders import"). Remember that an
imported order, its points and its cost are permanent financial records (there is no un-import), so use only this file in DEV and import it **once**.

## Part 1: who can see it

| # | Do | Expect | Result |
|---|---|---|---|
| 1.1 | Signed in as the owner (second factor done), open the staff menu. | **Import orders** is listed. The Overview and the Orders page have an **Import historical orders** button. | |
| 1.2 | Sign in as an ordinary staff member (no import right) and look at the menu, the Overview and the Orders page. Then type `/admin/import` into the address bar. | No entry, no button. The address shows "Not available" (the same as a page that does not exist), never the upload form. | |
| 1.3 | Signed out, open `/admin/import`. | You are sent to sign in. | |

## Part 2: upload and review (nothing is saved)

| # | Do | Expect | Result |
|---|---|---|---|
| 2.1 | **Import orders** → choose the synthetic CSV, leave the date order on *Work it out*, **Read the file**. | You land on **Review an import** with "Waiting for your review" and the sentence "Nothing has been imported yet". | |
| 2.2 | Read the tiles. | **25** orders to import from **36** rows; **19** customers; revenue **QAR 106,334.00**; direct costs **QAR 91,346.00**; profit **QAR 14,988.00** with "1 order recorded at a loss"; **10,632** loyalty points ("1 point per QAR 10.00, rounded down per order"); **Not orders: 11** (10 advertising rows QAR 495.00 and 1 invalid summary row). | |
| 2.3 | Open **Orders** and **Customers** in another tab. | **Nothing from the file is there yet.** | |
| 2.4 | Read *Reported under the month each order was completed*. | A month-by-month table (Feb 2024 … ) that matches what you expect for the file's dates. If a month looks wrong, the date meaning is wrong: stop and say so. | |
| 2.5 | Read *Left out on purpose*. | The ten advertising rows and the one summary row, each with its reason; none counts as an order. | |
| 2.6 | Upload the **same file again**. | The message "This exact file was already prepared. Opening it." and the same review opens; no second batch is created. | |

## Part 3: decisions and corrections

| # | Do | Expect | Result |
|---|---|---|---|
| 3.1 | If **Needs your decision** lists items: for each, read the message and choose *keep separate*, *same person* or *skip*. | The item moves to "Decided". While one waits, **Check without importing** and **Import** are switched off, and the page says how many are waiting. | |
| 3.2 | On any purchase, open **Correct…**, change the revenue by 10.00, save. | The tiles and the month table change at once; the row says what was found; a second change is allowed. Put it back. | |
| 3.3 | **Skip** a purchase with a reason, then **Restore** it. | The row is "Skipped" then "Will import" again; the order count follows. | |
| 3.4 | On a phone-width window (about 390 px) open the same page. | The purchases are **cards**, not a table; no amount is cut off; nothing scrolls sideways; the buttons are easy to tap. | |

## Part 4: receipts

| # | Do | Expect | Result |
|---|---|---|---|
| 4.1 | In **Receipts and files**, on one reference choose **Attach the original…**, pick a small **PDF**, set it to *Customer receipt*, store it. | "Stored · size"; **View** opens it in a new tab; **Download** saves it; the page never shows the Airtable-style link. | |
| 4.2 | Attach a **PNG** as a *Supplier invoice (internal)*. | Stored; the badge says internal; there is no "customer may see it" option for it. | |
| 4.3 | Try a `.txt` file renamed to `.pdf`. | Refused: "only PDF and PNG files can be attached" (the content is checked, not the name). | |
| 4.4 | Mark another reference **Original not available** with a reason. | It shows the reason and does **not** block the import. | |

## Part 5: the final confirmation and the import

| # | Do | Expect | Result |
|---|---|---|---|
| 5.1 | With nothing waiting, type the right phrase but tick only two of the three statements and press **Import**. | Refused with "confirm all three statements: the dates are the completion dates, the revenue is the final amount payable, and the orders were fully paid". Nothing is imported. Leave the cost question unanswered and try again: refused, and it says to answer it. | |
| 5.2 | Tick all three, answer the cost question, type `IMPORT 24 ORDERS` (wrong count). | The **Import** button stays switched off while the phrase is wrong; the right phrase is shown in the label above the box. | |
| 5.3 | Type `IMPORT 25 ORDERS` and press **Check without importing**. | "Check passed. Importing now would create 25 orders for 19 customers, record QAR 106,334.00 of revenue and award 10,632 points. Nothing was saved." **Orders** and **Customers** still show nothing from the file. | |
| 5.4 | Press **Import 25 orders** (all three statements ticked, cost question answered). Then go Back and press **Import** again, or double-click it. | "Imported 25 orders. 10,632 loyalty points were awarded, once each. No customer was emailed and no account was created." The second attempt says "This import was already completed earlier, so nothing new was imported"; the order count is still 25. | |

## Part 6: after the import: the numbers

| # | Do | Expect | Result |
|---|---|---|---|
| 6.1 | Read the **Import report**. | Orders 25, customers 19 (new profiles), revenue QAR 106,334.00, costs QAR 91,346.00 (or "provisional"), profit QAR 14,988.00, points 10,632, advertising QAR 495.00 shown apart, files still to attach as expected. | |
| 6.2 | **Orders**: filter by year and by month. | Each historical order is in the month it was **completed** (not today's month); the row says **Completed <date> · Historical WhatsApp order**. | |
| 6.3 | **Orders → Financial performance** (the monthly report). | The revenue, cost and profit per month and per year equal the file's own totals; the QAR −100 order is a **loss** in its month. | |
| 6.4 | Open any imported order. | "Completed <date> · Historical WhatsApp order"; **no** deposit, progress, status control, tracking or "record a payment"; the cost is visible to you; the receipts you attached are listed; the order line says "items not recorded". | |
| 6.5 | Open an imported customer. | Their history lists the order as **Historical WhatsApp order · completed <date>**; the loyalty balance equals the points in the report for their orders. | |
| 6.6 | Open **Loyalty** and the audit log. | One *award* per imported order ("Points earned on historical order H-…"), and audit rows `historical_import.*`. Nothing existing changed. | |
| 6.7 | Check the mailbox of every address you own that is in the file's test data (there should be none). | **No email** was sent to anyone. No new sign-in account exists. | |

## Part 7: the customer's view (use one test customer only)

| # | Do | Expect | Result |
|---|---|---|---|
| 7.1 | On an imported customer's staff page create a **claim code**. In a private window sign up with a new `@example.test` address and claim the profile with the code. | The profile links; the code cannot be used a second time. | |
| 7.2 | In the customer portal open **My orders**. | The imported orders are listed **newest completed first**, each "Completed <date> · Historical WhatsApp order", amount, **Paid in full**, no progress steps and no deposit. | |
| 7.3 | Open one order. | One sentence: "You bought this from M1 on WhatsApp, before our website existed…"; **Paid in full**; the line "no individual payment records"; **no** cost, profit, supplier, invoice, batch or link anywhere (also check *View page source*). | |
| 7.4 | Open **Loyalty**. | The balance equals the points for that customer's orders. | |

## Part 8: what must not have changed

| # | Do | Expect | Result |
|---|---|---|---|
| 8.1 | Place a new order the normal way (staff **New order**) for a test customer; advance it through the stages. | Exactly as before, including the deposit rule and the order progress; the new order's reference starts with `O-`. | |
| 8.2 | Try to record a payment or add a tracking step on an imported order (use a saved link to its page). | Refused with a clear message; nothing changes. | |
| 8.3 | Sign in as an ordinary staff member and open an imported order. | You see the order but **no cost, profit or provenance**. | |
| 8.4 | Open the public website pages, the quotation form, the login page and the customer dashboard. | Unchanged. | |

When every row says what it should, say so in writing and the real import can be authorized (release plan, stage 3). If any row differs, **stop**: do not import the real file.
