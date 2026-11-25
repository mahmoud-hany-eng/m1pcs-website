# PLAT-0007 — run record, attempt 2 (corrective release: header layout at 1024 px, Orders sort label)

The brief is recorded as HD-0025. It follows the PLAT-0007 DEV staging release (attempt 1: [RUN-RECORD](../PLAT-0007-a1/RUN-RECORD.md); migration and Preview accepted), whose
GitHub CI run #19 failed on one new header test. Scope: **two defects only**, no migration, no change to Production, `main`, `claude-dev`, the workflow default, sign-in or MFA,
or the Instagram files.

## The two defects and their fixes

| # | Defect | Cause | Fix |
| --- | --- | --- | --- |
| 1 | At 1024 px the six navigation links wrapped onto two rows on the CI runner | The account icon and its gap took about 50 px from a bar that had only about 52 px to spare in the site's own font; a wider fallback font removes that | The six links are in the bar only from `80em` (1280 px at the default text size); from 1024 px the bar holds the logo, Get a Quote, the account button and the menu button; below 80em the menu holds the six links. The switch is in em so larger default text also gets the menu earlier. Links do not wrap inside themselves and the group does not shrink. The two menus are never open together; widening the window past 80em closes an open menu |
| 2 | With a non-default sort and no filter, the summary line said "newest first" | The phrase was a constant | The phrase is the chosen sort's label in lower case; the "Sorted:" note already used the label |

Files: `src/components/layout/Header.tsx`, `src/app/admin/orders/page.tsx`, `supabase/tests/header.browser.test.mjs`, `supabase/tests/orders.pages.db.test.mjs`, and the documents
`PUBLIC_HEADER_ACCOUNT_MENU.md`, `ORDERS_LIST.md`, `FINANCIAL_OWNER_ACCEPTANCE_CHECKLIST.md` (rows 8.15 to 8.17), `HUMAN_DECISIONS.md` (HD-0025).

## How the first failure was reproduced and the fix proven

* The failure was reproduced locally before anything was changed: with a wide fallback font (DejaVu Sans) the links wrap to two rows at 1024 px; at 1060 px and up they did not.
* Header tests: the old 1024 px test was **replaced by stricter ones**, not relaxed. Five widths (1024, 1060, 1100, 1280, 1440) times three font conditions (the site's own fonts,
  the web fonts blocked so the browser's own fallback is drawn, and a deliberately wide fallback with a little letter-spacing so it is strict even without that font). Checks: no sideways
  scroll, the header box 80 px tall, Get a Quote and the account button always in the bar, nothing outside the capsule, no neighbour overlapping, and **whenever the six links are inline:
  one row, no label wrapping inside itself, at least 24 px free on each side**; plus the design rule (inline from 1280, in the menu below). Further tests: the menu's contents at tablet widths
  (six links in order, on screen, no Get a Quote or Account group repeated, Tab and Escape), the two menus never open together and widening closes the menu and releases page scrolling,
  and reduced motion at tablet width.
* Orders tests: the existing assertion that encoded the bug was changed; three tests added (every visible label under each of the four sorts; count and page labels under each sort on the
  first, second and last page with the paging links keeping the sort; filters chosen with each sort).
* **Both original defects were put back, one at a time, and caught:** the hardcoded "newest first" is caught by 2 tests; the original header is caught by 4 tests.

## Verification (final tree)

| Check | Result |
| --- | --- |
| `npm run test:db` (real PostgreSQL 16, real migrations, rendered pages, static rules) | **1152 of 1152 pass** (1149 before: three new Orders page tests) |
| `npm run test:browser` | **186 of 186 pass** (178 before: three new header tests net of one replaced, plus five Orders layout checks, one per width) |
| `npm run ops:validate` / `npm run ops:test` | OK (1 warning that predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | no problems / clean / compiles |
| Original defects put back one at a time | the hardcoded sort phrase: caught by 2 tests; the original header: caught by 4 tests |

The GitHub CI result of the one push is in the final report.

## Limits

* Larger default text in the browser moves the em breakpoint by the CSS standard; this could not be driven in the automated browser (the headless profile ignores the preference), so it is reasoned, not tested.
* Pages that need a signed-in staff session were not driven through a login (second factor); the Orders page is rendered from real database answers.
* Reminders carried: revoke the Vercel project-scoped token; Supabase Auth redirect entry for the Preview URL before customer e-mail tests; clawback after payment reversal (OQ-0043); the hosted 11-argument `admin.create_order` one-blank-line deviation; the legacy 6- and 7-argument `create_order` overloads remain a separate Production blocker.
