# PLAT-0008 — run record, attempt 2 (the duplicate-import audit before the DEV release)

Requested by the owner as **Phase 1 of the controlled DEV release** of `9bfac82475b2656d8b505e2810be7e455e5e0a13`: before any hosted operation, prove that a **corrected re-upload** of an imported purchase and a purchase that **already exists as a website order** can never be imported and rewarded a second time without the owner's explicit decision, while legitimate separate purchases that merely look alike are preserved.

**Result: both risks were genuine defects in `9bfac82`. They are fixed locally in a new commit. Nothing was pushed, nothing was applied to any hosted database, no preflight was run: the release is stopped for the owner's review of the corrected commit, as instructed.**

## What was proved, on the approved commit, before any change

A scratch run on a real PostgreSQL 16 with the approved migrations (synthetic data only): one purchase imported (500 points), then the same export uploaded again with one value corrected, the owner doing nothing but confirming:

| Re-upload | Decision asked of the owner | Result on `9bfac82` |
| --- | --- | --- |
| corrected **phone** number | none (no flag at all) | **committed**, a second order, loyalty awards 1 → 2, points 500 → 1,000 |
| corrected **revenue** | none (only an information note) | **committed**, a third order, awards 2 → 3, points 1,000 → 1,510 |

A suite of 30 targeted tests (`supabase/tests/historical.duplicates.db.test.mjs`) was written first and run against `9bfac82`: **10 failed**. (Two more tests were added afterwards, see the mutation check; the final suite has 33.)

| Scenario | Failing on `9bfac82` | Why |
| --- | --- | --- |
| A. corrected re-upload: phone, revenue, date by 40 days, revenue and cost together, date and cost together, name **and** phone | **6** | The only check was "a customer whose phone key equals the row's, an order with the same net amount, a date within three days of the order's *creation*". Any correction of the phone, the amount or the date (or of two values) escaped it, and nothing else looks at a row whose fingerprint is new. |
| B. a website order: completed weeks after it was placed; the customer used another phone; the export's date a few days off | **3** | Compared with the order's *creation* day only, and only through the customer's phone. |
| B. a **cancelled** website order | **1** | It blocked an import although a cancelled order is no purchase and earns nothing. |

(Corrected direct cost, corrected spelling with the same phone, and corrections of one day were already caught, by the old check.)

## The fix (in the not-yet-applied `20261128120100_historical_import_functions.sql`; no third migration)

A purchase that is **not** identical to an imported one (identical ones are still skipped by fingerprint) but **resembles** an order that exists is now a **blocking decision for the owner** ("skip: it is the same purchase" or "import anyway: it is a different one", recorded and audited), asked per order it resembles, and **asked again at the moment of confirming**.

* Every purchase is compared with every order that is not cancelled (a website order, or one imported earlier) on **five independent signals**: phone, name (loosely folded: case, spacing, punctuation), the amount actually paid (net of discount and credit), the date (within three days of the order's own days: for a website order from the day it was placed to the day it was completed; for an imported order its completion day) and the direct cost (imported orders only).
* It is raised when **the phone or the name matches and at least three signals agree** (so one corrected value, or two, still leaves three), **or** when no customer detail matches but the **amount, the day and the direct cost are all identical**: that is what a customer whose name *and* phone were both corrected looks like, and it cannot be told from a different customer who bought the same build the same day, so it is asked, never guessed. One click keeps such a purchase as its own purchase with its own points.
* Two identical rows **inside one file** stay two purchases, each with its own points, with a non-blocking note.
* The message names the order, its customer code and the signals that agree, and says what skipping and importing mean.
* Also fixed on the way, by the new tests: a null in one signal made the whole sum null (so a website order with a different phone was missed), and a pair of tests that only checked "it failed".

Files: the functions migration (`hist_flags` rewritten; new private helper `hist_name_fold`), `types.ts` and `historical-review.tsx` (the title of the decision and of the note), the new test file, `package.json` (the suite joins `test:db`), the architecture doc, the release plan (a function count in it was also corrected: 41 function definitions differ, not 23), and this record.

## Proof after the fix: the 33 targeted tests, all passing

| Requirement | Test |
| --- | --- |
| **A.** corrected direct cost, spelling, phone, revenue, date by 1 and by 40 days, two values together, **name and phone together**: not imported silently, the decision names the earlier order, the commit is refused (55000, "still need your decision"), nothing created, **no points added** | 9 tests |
| the same row written differently (spacing, case, `+974`, no country code) is the same purchase: skipped, nothing awarded | 1 |
| skipping answers the question: nothing imported; "import anyway" is explicit, recorded in the audit log, imports once, a retry does **not** award twice (`replayed`) | 2 |
| a repeated row plus a new one imports only the new one, once | 1 |
| **concurrency:** the original and a corrected upload, both staged first and confirmed at the same moment (two sessions): **exactly one commit succeeds**, the other is refused, one order and one award | 1 |
| two different corrections of one imported purchase, each reviewed and answered "different" before either was imported: the second import finds the first and is refused | 1 |
| **B.** website order: same customer/amount/day; completed weeks after it was placed; another phone; another spelling; name in capitals with other spacing and another phone; a discounted order (net amount); the export's date off by two weeks; the amount changed but the customer and the completion date the same; an order still being built: each **flagged**, the commit refused, **no points** | 9 (with the plain same-day case) |
| an order that appears on the website **after** the export was reviewed stops the import at the moment of confirming | 1 |
| skip leaves the website order's points as they were; import anyway is a recorded owner decision | 1 |
| a **cancelled** website order does not block | 1 |
| **C.** two different customers with identical amount, cost and date in one export: **both imported, each with its own points**; a different customer's website order with the same amount and day does not hold anything back; one customer's two identical rows import as two purchases, and the same export again imports nothing; a third identical row in a later export is held, not guessed; **the same customer's later purchase** (another amount and cost, months afterwards) is a different purchase and nothing is asked | 5 |
| a different customer with identical amount, cost and day as an imported order is **asked about, and one click keeps it** as its own customer with its own points | (counted in the five above) |

## Mutation check of the new rule

**13 of 13 mutations are caught** by the duplicate suite (a scratch copy of the project, the working tree never touched). Two first **survived** and led to two stronger tests.

| # | The rule that was broken | Caught by (first failing test) |
| --- | --- | --- |
| D01 | the phone no longer counts as a signal | "corrected the revenue and the cost together …" (+3) |
| D02 | the name no longer counts | the same (+4) |
| D03 | the amount no longer counts | "corrected the date and the cost together …" (+6) |
| D04 | the date no longer counts | "corrected the revenue and the cost together …" (+3) |
| D05 | the direct cost no longer counts | "corrected both the customer's name and the phone number …" (+1) |
| D06 | the "nothing matches but amount, day and cost" rule is removed | "corrected both the customer's name and the phone number …" (+1) |
| D07 | four signals needed instead of three | "corrected the revenue and the cost together …" (+5) |
| D08 | a cancelled website order counts | "a website order that was cancelled is no purchase …" |
| D09 | an imported order is dated by its import day instead of its completion day | "the SAME customer's later purchase … is a different purchase: nothing is asked" (**survived at first**) |
| D10 | a website order is dated by its placement only, not through its completion | "the amount differs … and the order was completed weeks after it was placed" (**survived at first**) |
| D11 | the check is not repeated at the moment of confirming | 24 tests, the race and the "order that appears after the review" among them |
| D12 | identical rows in one file block instead of noting | "one customer buying two identical things on one day …" |
| D13 | the name comparison matches everything | "the name is the same but written in capitals with other spacing …" (+4) |

**What the two survivors taught.** In D10 the existing "completed weeks later" test also matched on phone, name and amount, so the date window was never what decided it; in D09 nothing checked that an imported order is not dated by the day it was imported (a wider window would only show as extra questions). Each now has a test in which the date is the deciding signal.

## Verification

| Check | Result |
| --- | --- |
| The duplicate suite on the approved commit `9bfac82` | 30 tests, **10 failed** (the defects above) |
| The duplicate suite on the fix | **33 of 33 pass** |
| `npm run test:db` | **1529 of 1529 pass**, 0 skipped (1496 on `9bfac82`: +33) |
| `npm run test:browser` (the CI command) | **322 of 322 pass**, 0 skipped |
| `npm run ops:validate` / `npm run ops:test` | OK (the one warning predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | 0 errors (one warning in `email-links.test.mjs`, which predates this work) / clean / compiles (`/admin/import`, `/admin/import/[id]`, `/admin/import/files/[id]` dynamic; the public pages stay static) |
| Mutation check of the new rule | 13 of 13 caught |

## What the rule cannot know (OQ-0068)

A corrected row whose name **and** phone were both changed, with an amount or a date or a cost changed as well, shares too little with the original to be recognised; the same holds when the file has no cost for it. That is inherent (it is indistinguishable from a different purchase), so it is stated rather than hidden. The mitigations are the ones the owner already has: the month table, the customer list and the totals shown before any import, and the one-time rehearsal on synthetic data.

## Stopped here

No preflight, no hosted read or write, no migration applied, no push. Phases 2 to 6 of the release wait for the owner's review of the corrected commit.
