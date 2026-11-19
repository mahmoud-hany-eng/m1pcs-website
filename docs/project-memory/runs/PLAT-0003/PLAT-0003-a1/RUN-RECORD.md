# PLAT-0003 — run record, attempt 1 (real Supabase integration and the admin dashboard)

**Local only. Nothing was pushed, merged or deployed.** No Supabase project, credential, paid service or live resource was
created or contacted; the "Supabase" used is the official **local** stack (the Supabase CLI's Docker services, with
CLI-generated keys for a disposable database). No existing GitHub branch changed and draft pull request #1 was not touched.
No Instagram file was touched. This is a Markdown run record in the style of the PLAT-0002 record, not a schema-validated
`report.json`: task files and human-decision records are human-controlled, so none was created and no decision or open
question was recorded. One decision text is only *proposed*, in `DEPOSIT_POLICY_AUDIT.md`.

Design and analysis: [STAFF_GATEWAY.md](../../../architecture/STAFF_GATEWAY.md),
[CUSTOMER_ACCOUNTS.md](../../../architecture/CUSTOMER_ACCOUNTS.md) (sections 6, 6a, 9, 10) and
[DEPOSIT_POLICY_AUDIT.md](../../../architecture/DEPOSIT_POLICY_AUDIT.md).

## Baseline and commits

| Role | Commit |
| --- | --- |
| **Baseline: the PLAT-0002 head (`claude/plat-0002-customer-accounts`)** | `e9c53d0` (`e9c53d0ab5f9ba7ff213556b3d28a5254d1993ec`) |
| Confirmed deposit schedule, staff gateway database layer, admin functions (migrations 14 and 15) | `d14f724` |
| Staff gateway server code and the admin dashboard (flag off by default) | `66bac0a` |
| Tests against the official Supabase local stack (API, staff and gateway) | `2535cb3` |
| Customer-account fixes, second-step privacy, real-stack browser journeys | `dfb6661` |
| Gateway review and analysis, documents, mutation-driven tests (**the verified head**) | `18e0aee` |
| This run record (the head of the branch) | the commit that adds this file |

Branch `claude/plat-0003-admin-dashboard`, created locally from the exact baseline. No upstream, no remote ref; the reflog
holds no push. 77 files changed, about 8,100 lines added.

## What was built

* **Real Supabase, not only an emulator.** The Supabase CLI 3.2.0 local stack in Docker (Auth v2.198.0, PostgREST v16.5,
  Kong 2.8.1, supabase/postgres 15.20, Mailpit v1.31.3) runs all 15 migrations in order. 72 official-stack tests run against
  the real services with no emulator involved (below).
* **The owner-confirmed deposit schedule** (15 % up to QAR 3,000.00, 25 % up to 5,000.00, 35 % above, of the whole total),
  as a versioned configurable policy, rounded to the nearest minor unit (a half up), fixed and frozen at order
  confirmation, changed only with a reason, the owner tick and a typed phrase. The withdrawn flat 50 % is not restored.
* **A server-only staff gateway** (`pg`, dedicated `m1_staff_gateway` role, one fixed SQL per call, one transaction, claims
  re-verified by the database against `auth.sessions`) after a reviewed redesign of the PLAT-0002 proposal.
* **The admin dashboard**, premium and responsive: overview, customers (search, profile, order history, claim codes),
  orders (create with items and a price-verified tick, status changes, tracking milestones), payments (cash and Fawran,
  generated unique receipts, reversals), loyalty (read only), policies, audit log, and an authenticator-app second step.
  Desktop side navigation; on a phone, a top bar and tables that turn into cards.
* **Customer-account fixes:** claiming after a profile exists (several linked records, never merged), every order-detail
  route's isolation tested, password recovery, session refresh and cookie handling verified on the real service.

## Verification

Run from a **fresh clone of the committed branch** (head `18e0aee`) with a clean `npm ci`. Node v22.23.4, Next.js 15.5.25,
React 19.3.0, PostgreSQL 16.15 (the local harness) and 15.20 (the official stack), Chromium through Playwright. The run
record's own commit adds documentation only.

| Check | Result |
| --- | --- |
| `npm run ops:validate` | OK, 155 files; one warning, about the OPS-0006 task file, which this work did not touch |
| `npm run ops:test` | **561 of 561** (the same count as the baseline) |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, **56 of 56** static pages (the same as the baseline); `/admin` routes are dynamic |
| `npm run db:test` | **215 of 215** (Phase 1 and 2: 155; PLAT-0003: 60), against real PostgreSQL |
| `npm run db:test:static` | **141 of 141** (static checks, money and environment, account and staff unit tests) |
| `npm run accounts:e2e` (emulator, Phase 2) | **43 of 43** (three expectations updated, see below) |
| `npm run real:test` (official stack) | **50 of 50**: 37 API tests, 13 staff, session and gateway tests |
| `npm run real:e2e` (official stack) | **22 of 22**: 10 customer and 12 staff browser journeys, desktop and phone width |
| Public pages vs the baseline build, same environment | visible HTML of **35 of 35** prerendered public pages identical |
| Mutation test (17 mutants of the new SQL and TypeScript) | all **17** caught (13 at first; four survivors each led to a new test) |

**Emulator tests and official-stack tests are separate** (different folders and scripts) and are never added together.
The three emulator expectations changed because behaviour changed on purpose: the page no longer says that a new profile
"cannot be linked to an older one later"; the demonstration order shows the confirmed 25 % deposit (QAR 1,000.00) instead
of a flat half; and a claim page for an account with a profile now offers another claim.

### What the official stack proved, and what it overturned

Everything below is a recorded test. The full table with the emulator's earlier claims is in `CUSTOMER_ACCOUNTS.md` §9.

* Sign-up (an unconfirmed user has no session and cannot sign in), the confirmation email in Mailpit with the project's own
  template, a one-time `token_hash` link that works in a fresh browser and once, sign-in claims (`aal`, `session_id`),
  refresh-token rotation, sign-out, password recovery, expired, altered, unsigned and wrong-key tokens refused.
* **Overturned: the emulator hid that an address is registered. The real service answers `422 user_already_exists`.** The app
  already showed the identical screen for both; a browser test proves it. A source comment that said otherwise was corrected.
* **The REST layer keeps accepting a signed-out access token until it expires.** The app asks the auth service on every
  request, and the staff database function checks `auth.sessions`, so sign-out is effective for both.
* A replayed refresh token is refused once its child was used, but the session is not revoked (the newest token still works).
* A user can write `is_admin`/`role` into their own `user_metadata` and it appears in their token; authorization never reads
  it (proven).
* Row level security as PostgREST applies it: only `public` exposed; two customers isolated by list and by id; no write to
  orders, payments, items, tracking or loyalty; only permitted profile columns editable; no private data in any customer
  response; no staff function or staff table reachable.
* Claim codes: identical empty answer for every failure, five-try rate limit that does not spend the owner's code, revoked
  and expired codes refused, a second record can be linked, no automatic link by matching email or phone.
* Staff: a real authenticator code upgrades the same session to `aal2`; a wrong code does not; the shipped gateway module
  works against the real database; a first-level, made-up, other person's, signed-out or expired session is refused by the
  database even though the gateway always claims `aal2`; a deactivated or non-staff person is refused; the gateway login can
  read no table and `set role` to nothing; claims never leak across pooled calls; a whole staff journey (customer, order,
  deposit at the tier boundaries, Fawran and cash payments, reversal, policy change that does not touch a fixed deposit,
  tracking, audit) runs through it.
* Browser: customers see an identical not-found page for every admin address (including the second-step page); every
  order-detail route returns the same page for another customer's real reference, a malformed one and a missing one.

## Findings made during verification, and what was done

1. **A wrong label, found by a real-stack test.** One field meant "the deposit amount was fixed at confirmation" and the
   order screen used it for "deposit received". Split into `deposit_fixed` and `deposit_received` (staff-recorded payments
   cover it); tested including a part-payment.
2. **React 19 clears an uncontrolled form after every submit**, including after a validation error. Admin forms now take the
   typed text back from the server (never a code, password or confirmation word); account forms keep the email in controlled
   inputs. A select needed to be re-created for its choice to come back.
3. **Duplicate form ids.** The table-and-cards layout drew a form twice. Cells now know which layout they are in.
4. **A privacy leak of existence.** The second-step page and an admin "not found" page would have told a customer that an
   admin area exists. A new `admin.is_staff_member()` (caller only) gates them; admin addresses now give the website's ordinary
   404, with a real 404 status (the admin loading shell was removed because it streamed a 200 first).
5. **Layout defects found by looking at screenshots:** the outstanding-balances figure overflowed its card at 1440 px; the
   status-history table clipped its last column. Fixed; phone width has a no-sideways-scroll test on every admin page.
6. **A stale build hid a change** (deleting a file does not move a file's modification time). The browser-test helper now
   compares directory times too.
7. **The Server Action navigation issue** (PLAT-0002) was re-checked and is still **not isolated**. The full-page-load
   workaround held in every run; in-place updates after `revalidatePath` also never failed. See `CUSTOMER_ACCOUNTS.md` §10.
8. **Mutation testing** left four survivors (claim rate-limit threshold, a part-paid deposit counted as received, the form
   echo of the confirmation word, half-up rounding in tiered mode); tests were added and all 17 mutants are caught. One
   first-pass "survivor" was an artefact of the mutation script changing only the first of two copies of the rounding line.
9. **Two tool slips of mine, for the record:** a mutation run was interrupted by me restoring a file mid-run (that mutant
   was re-run); and a debug script initially needed the CLI path in the environment.

## Not proven

* Nothing was run against a hosted Supabase project: the built-in mailer and its limits, email deliverability, the hosted
  redirect allow-list, JWT signing-key setup, connection pooling for the gateway, `Secure` cookies on HTTPS, backups.
  The checklist is `supabase/tests/REAL_SUPABASE_CHECKS.md` (sections 8 and 9).
* The client JavaScript of the public pages was not compared byte for byte this time (visible HTML only), so the PLAT-0002
  statement about renumbered chunk ids still applies.
* The Server Action navigation cause (finding 7).
* Anything about load, and the staff roles other than `owner` and `staff`.
* Refunds, account merging and customer MFA are not built.

## Preservation checks

* `main` (local `9faf57a`, remote `b180378`), `claude-dev` (local `187e045` with its eight unpublished Reel commits, remote
  `b7348bb`), `claude/ops-staging-integration` (`005196a`) and every other branch are at the commits they were at before.
  A live check of the remote shows no `claude/plat-*` branch and no changed tip.
* Draft pull request #1 is open, still a draft, head `005196a`, last updated before this work.
* The primary checkout still has the same single uncommitted file it had before (an Instagram script under `creative/`),
  which was not touched. Nothing under `public/`, `creative/` or the logo changed; no Instagram asset was uploaded.
