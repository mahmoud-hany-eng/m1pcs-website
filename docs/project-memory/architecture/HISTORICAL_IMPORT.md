# Historical orders import and retroactive loyalty (PLAT-0008)

**Status: implemented locally and tested against a real PostgreSQL 16 and a real browser. Not pushed, not deployed, no hosted migration applied, no real record imported anywhere.**
Every figure and every name in the tests is synthetic (`supabase/tests/fixtures/historical/synthetic-historical-orders.csv`, host `attachments.example.test`). The owner's real export is never in the repository,
never in a log and never in the development database.

## 1. What it is for

Before the website existed, M1 sold PCs over WhatsApp and recorded the sales in an Airtable base. The owner wants those sales on the platform: in the Orders list and the financial reports under the month each
sale was **completed**, in each customer's history, and with the loyalty points the sale would have earned. A customer can later claim their record with the existing time-limited, single-use claim code and then sees
their past orders and points. Nobody is emailed, no sign-in account is created for anyone, and nothing that already exists is changed.

The import is a **staff tool for the owner only** (`import.manage`, held by the owner role alone, and the database insists on the second factor). It reads a CSV, shows what it understood, makes the owner decide whatever
is ambiguous, asks for explicit confirmation of what the numbers mean, and then does everything in one database transaction that can be run twice without effect.

## 2. The workflow in the Staff Dashboard

| Step | Where | What happens | Nothing is saved until |
| --- | --- | --- | --- |
| 1. Upload | **Import orders** (`/admin/import`) | The owner picks the CSV (up to 512 KB) and, only if the file cannot say, the date order. The server parses it (`src/lib/staff/historical/parse.ts`) and sends a **proposal** to the database as a *staged batch*. | Step 6 |
| 2. Review | `/admin/import/<batch>` | Totals tiles (orders, customers, revenue, direct costs, profit, points, not-orders, decisions waiting); the **month preview** (each order counted under its completion month, Qatar time); the customers; every purchase with its own problems; what was left out and why. | Step 6 |
| 3. Decide | same page, *Needs your decision* | A possible duplicate, two names on one phone, one name on two phones, an invalid row, an ambiguous date: each is a decision with its own buttons (keep separate / same person / skip / correct). While one is waiting, nothing can be imported. | Step 6 |
| 4. Correct | the row's *Correct…* form | Customer, phone, completion date, revenue, cost. The row is re-checked by the database, not by the page. | Step 6 |
| 5. Attach | *Receipts and files* | Attach the original PDF or PNG for each reference (up to 4 MB); it is checked by its content and stored privately. A missing original never blocks anything. | Step 6 |
| 6. Confirm and import | *Final confirmation* | Three statements must be ticked (the date is the completion date; the revenue is the final amount payable; the orders were paid in full), the costs question answered (complete or provisional), and `IMPORT 25 ORDERS` typed with the real count. **Check without importing** runs the whole commit and rolls it back. **Import** commits. | — |
| 7. Report | same page, after the import | Orders, customers, revenue, cost, profit, points, what was left out, warnings, files still to attach, and each order's reference and points. | — |

Navigation: *Import orders* in the staff menu (owner only); an *Import historical orders* button on the Overview and the Orders page for the owner only. Nobody else sees the entry, the pages or the files route.

## 3. Date handling (exact)

* The CSV's **Date** column is treated as the **completion date** (the day the PC was handed over), never silently as a placement date. The owner has to tick *The date in the file is the date each order was completed and handed over* before an import; the statement is stored with the batch (who, when) as an audited attestation.
* The **file's date order** is decided once for the whole file. ISO dates (`2025-03-14`) and written months are unambiguous. For `03/04/2025`-style dates: a value above 12 in the first or second place settles the order; a file that settles both ways is refused (mixed); a file that settles neither is decided only when the **Month** column agrees with exactly one reading; otherwise the owner chooses on the upload form and the choice is recorded. A date the file cannot decide is never guessed.
* Impossible dates (30 February), dates before 2020, and dates after today (Qatar) are errors; a row whose **Month** names a different month from its date is a warning, and the date is used.
* The stored moment is **12:00 in Qatar (09:00 UTC)** on that day (`qatarNoonOf`), so no time-zone conversion can move an order into another day or month. Reports use Asia/Qatar (UTC+3, no daylight saving).
* `orders.created_at` is the **real import time**; it is never back-dated. `orders.completed_at` is the attested completion moment. A generated column `orders.order_date` is `completed_at` for a historical order and `created_at` for every other order, and the lists sort by it. The constraint `completed_at >= created_at` is relaxed **only** for `origin = 'historical_import'`.
* The order's reference is `H-YYMM-NNNNN` (the completion month; `O-` stays for platform orders), numbered by a running counter that is read under the commit's lock, so it cannot collide with another historical reference.
* The staff and customer pages say **Completed 14 Oct 2026 · Historical WhatsApp order**, never "Placed".

## 4. Financial mapping

| CSV | Platform | Visible to |
| --- | --- | --- |
| Revenue | `orders.total_minor`, `amount_paid_minor`, `private.order_completions.net_revenue_minor` (gross = net, no discount or credit) and the single order line "Historical order (items not recorded)" | staff; the customer (the amount only) |
| Cost | one private direct cost "Historical direct cost (imported total)", kind *actual*, category *other*, through the existing cost editor's own function | owner and staff with finance rights only; never a customer |
| Profit | not stored: always `revenue − cost`, computed by the existing reporting functions | same |
| Month | a check only (warns on a mismatch) | — |
| Receipt | attachment references (§6) | owner |

* **Revenue is the final amount the customer paid** (after any discount). The owner attests this; the importer never recomputes or adds tax, deposit or discount.
* **Costs**: the owner says whether the costs in the file are complete. *Yes* → each order is marked "costs complete" (profit is verified). *Not sure* → the costs stay *provisional*, which the existing reports already show as such. A row with **no cost** gets no cost record at all (an unknown cost is never counted as zero), and the report says how many orders have none.
* A **negative profit** is kept exactly as recorded (the fixture's QAR −100 order is imported and shows as a loss in every report).
* **Paid status** comes from the owner's attestation, recorded once on the batch. The importer does **not** invent payment ledger rows, deposit steps, tracking events, a payment method or a receipt: `amount_paid_minor` equals the total, `deposit_required_minor` is 0, and the customer sees "Paid in full" with the sentence "this purchase was settled before the website existed, so there are no individual payment records to list here".
* The financial report counts an order in the month of `completed_at` (unchanged), so a historical order lands in its completion month by itself. The four listing functions are restated to use `order_date` and carry `origin`; their results for every non-historical order are unchanged (proved by the existing suites, §10).
* **Advertising** rows (the ten "Instagram AD" rows, QAR 495 in the source) are **not orders**: no revenue, no order count, no points. They are reported separately in the review ("Not orders") and in the report. The `#ERROR!` row is an *invalid summary row*, excluded and reported.

## 5. Customers and duplicate prevention

* The CSV gives a name and a phone. **They are a hint, not ownership.** Rows are grouped in the batch by a normalised name key and phone key (case, accents, Arabic letter forms and marks, spacing, punctuation; phone digits with the Qatar country code folded) — the **same function in TypeScript and SQL** (`private.hist_phone_key`, `normalizePhone`; a parity test runs both on the same inputs).
* **Nothing is merged silently.** One phone under two different names, one name under two different phones, and every pair the matcher is unsure about become *decisions*. The owner can keep them separate, merge two groups (and undo it), or link a group to an **existing** customer. An existing customer is used only by that explicit choice; the default is a new profile.
* A new customer is a `customers` row only (`source = whatsapp`, `marketing_consent = false`) with no `customer_accounts` link and **no `auth.users` row**: no password, no sign-in, no email. The import never calls the email service and the tests assert that no mail or auth row is created.
* The customer claims the record the existing way: the owner issues a **claim code** (time-limited, single use) from the customer's staff page; after the customer claims it, the orders and points appear in their portal. They see the date, the amount, "Paid in full", the one-sentence explanation and their points. They never see costs, profit, suppliers, source rows, batch identifiers, attestations or Airtable links (a test scans the rendered HTML and the customer-visible rows' columns).
* **Duplicates are never imported silently.** (1) The same file (content hash) opens the same batch. (2) The same purchase written the same way (a SHA-256 *fingerprint* of `v1|name|phone|date|revenue|cost|occurrence`, unique among imported orders; the occurrence counter keeps two genuinely identical sales on one day) is skipped as already imported. (3) A purchase that is **not** identical but **looks like** an order that already exists is a **decision for the owner**: the fingerprint includes the values, so a corrected re-upload (one value changed) has a new fingerprint and would otherwise import, and be rewarded, a second time. Each purchase is compared with every order that is not cancelled (a website order, or one imported earlier) on five independent signals: the **phone**, the **name**, the **amount actually paid** (net of any discount or credit), the **date** (within three days of the order's own days: for a website order from the day it was placed to the day it was completed; for an imported order its completion day) and the **direct cost** (imported orders only). It is raised when the phone or the name matches and **at least three** of the five agree (so one corrected value, or two, is still caught), or when no customer detail matches but the amount, the day and the direct cost are all identical (which is exactly what a customer whose name **and** phone were both corrected looks like). The owner skips it (it is the same purchase) or confirms it is a different one; the question is asked again at the moment of confirming, so an order that appeared after the review (another import, a website order) is a new question, never an answer already given. Two identical rows inside one file stay two purchases (with a note, never a block). The audit and its proof are in `docs/project-memory/runs/PLAT-0008/PLAT-0008-a2/RUN-RECORD.md`.

## 6. Attachments (receipts)

* The export holds Airtable attachment URLs. They **expire** (an expired link is not proof that the file never existed), so the importer **never fetches them** and never links to them. The URL (it must be `https://`) is kept only as private provenance in the owner-only attachments table, to tell the owner which reference a file belongs to and that the link is temporary; it is never rendered on any page, never sent to a customer, and never opened by the server. A reference whose link has expired is shown as "not attached yet", not as "never existed".
* The owner attaches the original PDF or PNG in the review page. The database accepts a file only by its **content** (PDF header and trailer, PNG signature and chunk structure) up to 4 MB, whatever its name or declared type, stores it in a private table (no privilege for `anon`, `authenticated` or `service_role`; read only through a staff function), and keeps its SHA-256.
* Each file is **classified**: *customer receipt*, *supplier invoice (internal)*, or *not decided yet* (the default, private). Only a stored customer receipt can be flagged "customer may see it", and only by the owner; a supplier invoice can never be customer-visible (a table constraint, `hist_att_visible_needs_customer_receipt`). **This release stores the flag but does not add a customer download route**: customers do not see or download files yet (OQ-0066).
* The owner serves a file at `/admin/import/files/<id>` (GET only, `import.manage`, an allow-list of `application/pdf` and `image/png`, `no-store`, `nosniff`, a download or inline disposition).
* A reference with no file stays *Not attached yet*, or is marked *Original not available* with a reason. It never blocks the import and can be attached after the import.

## 7. Retroactive loyalty and the exactly-once guarantee

* Points per order = `floor(revenue_minor / qar_per_point_minor)` using the **current** earning policy at the moment the batch was prepared (today QAR 10 per point). The rate is stored with the batch; if the policy changes before the import, the commit refuses and asks for a fresh review. The reward rate, redemption rules and every existing balance are untouched.
* Per order, not on the batch total: the fixture's 25 orders give 10,632 points (the sum of the revenue divided by 10 would be 10,633; the difference is the per-order rounding).
* Each award is one `loyalty_ledger` row (`entry_type = 'award'`, `order_id` set) plus a `loyalty_entry_reasons` row naming the batch. The existing ledger already allows **one award per order** and is **immutable**; the import adds the batch/fingerprint uniqueness on top. Nothing updates or deletes a ledger row.
* **Exactly once**: (1) a committed batch returns its stored result with `replayed: true` on every later call (a double click, a retry, a second tab); (2) a global advisory lock serialises commits, so two commits of overlapping data cannot interleave; (3) fingerprints are unique among imported orders; (4) the whole commit is one transaction, so a failure anywhere leaves **nothing** (no half an import, no orphan customer, no point); (5) the ledger's own one-award-per-order rule is the last line. The tests run two concurrent commits, a replay, a forced failure at the last order, and a dry run, and check customers, orders, ledger rows and balances after each.
* The dry run (**Check without importing**) executes the real commit inside a sub-transaction and rolls it back with a dedicated SQLSTATE (`M1D01`), so every constraint and trigger is exercised and nothing remains.

## 8. Database design (two additive migrations)

`20261128120000_historical_import_schema.sql` (tables, columns, guards) and `20261128120100_historical_import_functions.sql` (functions). Both are **additive, forward-only and rerunnable**; neither drops or rewrites anything that exists.

* `public.orders`: `origin text not null default 'platform'` (`platform` | `historical_import`), generated `order_date`, an index on it, and the relaxed completion constraint described above. Every existing row becomes `platform`; nothing about it changes.
* Private tables (row-level security on, no privilege for `anon`, `authenticated` or `service_role`): `historical_import_batches`, `…_groups`, `…_rows`, `…_resolutions`, `…_attachments`, `historical_orders` (provenance: batch, source row, fingerprint, the attested date meaning), `historical_customers`, `historical_item_revisions`.
* **Guards** (triggers): an order can only be created already completed by the commit (the completion guard accepts it only when the transaction named that exact order, it is Delivered and its origin says `historical_import`; everything else is refused exactly as before); `origin` cannot be changed afterwards; a committed batch's rows are append-only; attachments are validated at the table, not only by the function; only a *discarded* batch can be purged; `refuse_on_historical_order` refuses any payment row or tracking event on a historical order (so a ledger that was never kept cannot be invented later), and the existing rule that a completed order never changes status already makes Delivered / Collected final for it.
* **Functions** (all `security definer`, `search_path = ''`, executable by `authenticated` and `m1_staff_gateway` only, each opens with `private.require_permission('import.manage')`): `admin.hist_stage_batch`, `hist_get_batch`, `hist_list_batches`, `hist_update_row`, `hist_set_row_decision`, `hist_merge_groups`, `hist_unmerge_group`, `hist_set_group_customer`, `hist_resolve_flag`, `hist_discard_batch`, `hist_commit_batch`, `hist_store_attachment`, `hist_add_attachment`, `hist_set_attachment_class`, `hist_mark_attachment_unavailable`, `hist_get_attachment`, `hist_order_info`, `hist_set_order_items`, and `admin.order_origin` (any staff member; returns the origin so pages can adapt). Four existing staff functions (`list_orders_overview`, `overview_summary`, `customer_orders`, `get_customer`) are re-stated to order by `order_date` and carry `origin`; `financial_report` needed no change, because it already counts an order in the month of `completed_at`.
* Every state change writes an audit row (`historical_import.*`). Staging is not an order; discarding leaves the audit trail.
* **Concurrency**: one global advisory lock (727001) around commits; batch rows are locked `for update`.

## 9. Website design

* `src/lib/staff/historical/` — pure library (CSV reader with limits and formula-injection neutralisation, normalisation, parsing, payload building), `forms.ts` (server-side form parsing), `actions.ts` (server actions, one permission check each), `choices.ts`/`types.ts` (client-safe).
* The staff gateway gains 19 fixed SQL statements (no string building; every value bound), listed as write calls; none is *keyed* (the database's own replay handling is the guard).
* `src/components/admin/historical-forms.tsx` (client forms) and `historical-review.tsx` (server sections); pages under `src/app/admin/import/`.
* Staff order page for a historical order: shows the completion date, the "Historical WhatsApp order" panel, the provenance (owner only) and the receipts; **hides** the deposit tile, progress, status control, tracking, status history and payment actions, which do not apply.
* Customer portal (`src/lib/accounts/shared/view-models.ts`, `components/account/dashboard.tsx`, `app/account/orders/[ref]`): the "Completed …" line, no progress steps, "Paid in full", newest-first by `order_date`.

## 10. Tests

| Suite | Tests | What it proves |
| --- | --- | --- |
| `historical-lib.test.mjs` | 48 | CSV, dates (incl. ambiguity), money, phones (Arabic digits), names, formula injection, fingerprints, points, payload |
| `historical.db.test.mjs` (real PostgreSQL) | 65 | who can do what (owner at aal2 only), staging totals, gating, atomic commit, replay, concurrency, loyalty, dates and months, the financial report, customer claim flow, files, order invariants, review actions, TypeScript↔SQL parity, the gateway's SQL text |
| `historical.pages.db.test.mjs` (real pages on real data) | 26 | upload page, review page, pending decisions, report, staff order page, lists, customer portal |
| `historical.static.test.mjs` | 32 | no raw SQL string building, no secrets or Airtable hosts in the client, owner-only routes, no destructive statements, RLS and grants on every new table, client-import boundary |
| `historical.layout.browser.test.mjs` (real Chromium) | 72 | the screens at 1280, 1024, 768 and 390 px: nothing scrolls sideways, tables become cards, amounts stay in their boxes, forms are labelled, buttons are tappable |

The browser test found a real defect on the first run (the money tiles spilled out of their boxes at 390 px) and it was fixed (one column on a phone, two on a tablet, four from 1280 px); it fails again if the fix is removed. Existing suites that pin contracts were updated **only** to add the new columns, functions and the owner's extra dashboard section (`origin`, `order_date`, the new permission, the migration list, `/admin/import` in the pinned navigation); nothing was weakened (the keyboard focus-ring check is now stricter).

## 11. Safety properties (what cannot happen)

* An import cannot be started or seen by anyone but the owner with the second factor (database-enforced, not only hidden in the menu).
* An import cannot create an auth user, a customer account link, an invitation, an email or a message.
* An import cannot change or delete an existing order, a payment, a ledger row or a balance, or change the Workflow V2 default (the migration touches no policy; `workflow_version = 1` is written for the historical order only, as the legacy shape that needs no tracking).
* The CSV is data: every cell that starts like a formula is neutralised before it is shown, stored or exported; names and phones are validated; the file is limited in size, rows and columns.
* Nothing in the customer's browser or HTML contains a cost, profit, supplier, Airtable URL, source row, batch identifier or attestation (asserted on the rendered markup and on the columns the customer's own query returns).

## 12. Known limits

* **No one-click undo after an import.** A committed historical order, its ledger award and its cost are financial records and are immutable by design. Before the commit a batch can be discarded and purged; after it, a mistake is corrected with the existing compensating tools (cost revisions, ledger adjustments). This is why the first import must be a rehearsal on synthetic data in DEV (release plan in `supabase/release/README.md`).
* Customers cannot yet download a receipt (OQ-0066). The order's items are one line "items not recorded" until the owner describes them with `hist_set_order_items` (revisions are kept).
* The real file's ambiguities (duplicate or shared phones, the Month/Date mismatches, which receipts survive) can only be seen when the owner uploads it; the tool is built to show them, not to guess (OQ-0063 to OQ-0067).
