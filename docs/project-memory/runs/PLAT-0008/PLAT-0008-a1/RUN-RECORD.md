# PLAT-0008 — run record, attempt 1 (historical orders import and retroactive loyalty)

**Local implementation only.** One local commit on `claude/plat-0004-order-hardening` (base `ce0479d`). **Not pushed, not deployed, no hosted migration applied, no real customer record imported anywhere, no email or message sent, no Supabase account created, no existing order or loyalty balance altered, the Workflow V2 default unchanged, `main`, `claude-dev` and the Instagram files untouched.** Authorization boundary, verbatim from the task: "LOCAL IMPLEMENTATION ONLY. Local commits are authorized."

## What was built

An owner-only **Historical Orders Import** in the Staff Dashboard: upload a CSV → parse and validate → review (customers, purchases, exclusions, month-by-month totals, potential points) → decide every ambiguity → explicit final confirmation → one auditable, idempotent transaction → report. Design and rules: [HISTORICAL_IMPORT.md](../../../architecture/HISTORICAL_IMPORT.md). The owner's test of it in a real browser, on synthetic data in DEV: [HISTORICAL_IMPORT_OWNER_ACCEPTANCE_CHECKLIST.md](../../../architecture/HISTORICAL_IMPORT_OWNER_ACCEPTANCE_CHECKLIST.md). The staged release and production-import plan: `supabase/release/README.md`, section "Historical orders import and retroactive loyalty (PLAT-0008)".

## Defects found by the new tests and fixed here

| Found by | Defect | Fix |
| --- | --- | --- |
| `historical.layout.browser.test.mjs` (first run, phone) | The money tiles ("QAR 106,334.00") were wider than their boxes at 390 px, and four tiles in a row would also be too narrow at 1024–1279 px beside the dashboard sidebar. | One column on a phone, two on a tablet, four from 1280 px. The test fails again if the fix is removed. |
| `historical.db.test.mjs` | `hist_stage_batch('{}')` raised a not-null error (23502) instead of the intended validation error (22023). | The payload checks are written with `is distinct from`, so a missing field is a validation error, not a null violation. |
| `historical.db.test.mjs` | `hist_store_attachment`: "column reference mime is ambiguous". | The local variable was renamed `file_mime`. |
| `historical.static.test.mjs` | A rule that rejected `delete from` inside a function body that purges only a *discarded* batch. | The rule ignores function bodies, and a second test pins the one allowed purge. |

## Mutation check

One rule at a time was broken in a **scratch copy** of the project and the historical database suite was run against it (script outside the repository; the working tree was never changed). Results:

**14 of 14 mutations are caught.** Two of them first **survived** and exposed weak tests, which were then fixed (see below).

| # | The rule that was broken | Caught by (first failing test) |
| --- | --- | --- |
| M01 | a repeated confirmation no longer returns the stored result | "a repeat of the same confirmation answers the same and imports nothing more" (+2) |
| M02 | points rounded **up** instead of down | "the report says what happened: 25 orders, 19 new customers, QAR 106,334, 10,632 points" (+1) |
| M03 | the real import time stored as the completion date | "the file's date is the completion date at noon Qatar time, listed and reported under that day" (+5) |
| M04 | the commit no longer refuses while a decision is waiting | "a customer who already exists with the same phone number is NEVER joined automatically" (+1) |
| M05 | the dry run no longer rolls back | "a dry run exercises everything for real and leaves no trace at all" |
| M06 | `anon` may run the commit function | "every import function exists, only a signed-in session or the gateway can run it" (+1) |
| M07 | a purchase already imported is no longer skipped | "two imports that share a purchase … never create it twice" (+2) |
| M08 | the "paid in full" statement is no longer required | "is refused until the owner has made all three statements …" |
| M09 | the origin of an order may change | "its origin, its status and its completion date never change" (**survived at first**) |
| M10 | a payment may be added to a historical order | "no payment can be recorded and no tracking published on it, by any route" (**survived at first**) |
| M11 | imported customers get marketing consent | "an imported customer has no account, no email, no claim code and no marketing consent" |
| M12 | a wrong confirmation phrase is accepted | "is refused until the owner has made all three statements, answered the costs question, typed the phrase …" |
| M13 | points computed on the **cost** instead of the revenue | 8 tests, including the dry-run and report tests |
| M14 | a supplier invoice may be shown to a customer | "a supplier invoice can never be shown to a customer" |

**What the two survivors taught.** M09 and M10 survived because the tests only asserted "it failed", and the same attempt is also refused by another rule (turning the origin back to `platform` breaks the completion-date check; a payment on a delivered, fully paid order is refused too). The tests now assert each guard's **own message** and also try a direct payment insert; both mutations are caught after the change.

## Verification

| Check | Result |
| --- | --- |
| `npm run test:db` | **1496 of 1496 pass**, 0 skipped (1324 before this work: +172) |
| `npm run test:browser` (the CI command) | **322 of 322 pass**, 0 skipped (250 before: +72, the historical layout suite at 1280, 1024, 768 and 390 px) |
| `npm run ops:validate` / `npm run ops:test` | OK (the one warning, an unapproved class-B task, predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | 0 errors (one warning in `email-links.test.mjs`, which predates this work) / clean / compiles (`/admin/import`, `/admin/import/[id]`, `/admin/import/files/[id]` are dynamic; the public pages stay static) |
| The five historical suites, once more after the last test edits | 249 of 249 (lib 48, database 65, pages 26, static 32 and the existing static suite) |
| The release plan's read-only SQL checks | run on a local migrated cluster: 19 functions, 8 tables with row-level security, one owner-only permission, no privilege for `anon` or `service_role`, `private.security_audit()` empty (one query was corrected: it also counted indexes) |

## Existing tests changed (and why)

Only the tests that **pin a contract** the additive migration deliberately extends were updated; none was weakened, none removed: the `orders` column list (`origin`, `order_date`), the owner's permission count (26 → 27), the migration list of the release suite, the lists of statements the compatibility suites run (additive keys only), the Orders overview's pinned key set, and the shared test support (page-render loader and account stubs) that must know the new action module. The first full browser run also showed two failures in `unified-nav.layout.browser.test.mjs`, both caused by the owner's one extra dashboard section ("Import orders"): the pinned list of section links now includes `/admin/import`, and the keyboard test, which judged the focus ring on the 24th Tab key (that key moved one control further on, onto the page itself), now checks the ring on **every** control the keys reach in the header, the navigation and the work area (a stronger check). The compatibility suites still run the recorded statements of every earlier deployed website against a database with the new migrations.

## Limits and what was not done

* **Not run in a real browser by a person**: typing into the staff forms needs a real second factor; the page markup and CSS are checked in a real browser at 1280, 1024, 768 and 390 px, the forms' behaviour is covered by the database and page tests, and the owner's checklist closes the rest.
* The typed-phrase gate on the Import button is client script; the server independently refuses a wrong phrase, a missing statement, a changed total and a waiting decision (database tests).
* No hosted database was read or written; no connector was used for any real data. The real export was never seen: the figures quoted from the brief (25 / 19 / 106,334 / 91,346 / 14,988 / 10,632) are reproduced only by the synthetic fixture, which was designed to have exactly those totals.
* Customers cannot download imported receipts yet (OQ-0066). There is no un-import after a commit (OQ-0067).

## Owner decisions remaining

OQ-0063 (the meaning of the Date column), OQ-0064 (the real file's ambiguities), OQ-0065 (are the costs complete), OQ-0066 (customer receipt download), OQ-0067 (correcting a wrong import; describing items). Then: review, authorize and deploy to DEV with synthetic records (the release plan, stages 1–4), and only after the written acceptance of that rehearsal authorize Production (stages 5–7).
