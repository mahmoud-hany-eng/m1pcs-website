# PLAT-0002 — run record, attempt 1 (Phase 1 corrections, customer accounts and dashboard, Phase 2)

**Local only. Nothing was pushed, merged or deployed.** No Supabase project, credential, paid service or live resource
was created or contacted. No existing GitHub branch was changed and draft pull request #1 was not touched. This is a
Markdown run record in the style of the PLAT-0001 record, not a schema-validated `report.json`: no task file exists for
PLAT-0002 and task files and human-decision records are human-controlled, so none was created. No open question or
decision was recorded; one is only *proposed* in the architecture document.

The design is in [CUSTOMER_ACCOUNTS.md](../../../architecture/CUSTOMER_ACCOUNTS.md). The Phase 1 corrections are in
[DEPOSIT_POLICY_AUDIT.md](../../../architecture/DEPOSIT_POLICY_AUDIT.md) and
[ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md](../../../architecture/ADMIN_ACCESS_AND_LEDGER_PROCEDURES.md).

## Baseline and commits

| Role | Commit |
|---|---|
| **Baseline: the completed PLAT-0001 head (`claude/plat-0001-supabase-foundation`)** | `7840a79` (`7840a792b41295b1cc49c570415a7efbd5ce2612`) |
| Phase 1 corrections: deposit policy, tracking retraction, honest ledger limits, documents | `296828c` |
| Customer accounts: auth, dashboard, claim, flag (default off) | `7516ecf` |
| Local emulator, unit, static and browser tests | `61e2600` |
| Tests strengthened after mutation testing; claim failure path unified | `44ecb90` |
| Architecture document, README, real-project checklist | `7e106c6` |
| Order items readable on phones; `accounts:preview` script; phone-width test | `2472e27` |
| This run record (the head of the branch) | the commit that adds this file |

Branch `claude/plat-0002-customer-accounts`, created locally on 2026-11-18 from the exact baseline above after checking
that its tree was clean. It has no upstream and no remote ref; the reflog contains no push.

## What was built

* **Phase 1 corrections** (tightly scoped; see the two documents above). The seeded flat 50 percent deposit was an
  unconfirmed commercial schedule in force by default and nothing in the repository supports it, so migration 12
  withdraws it (it stays in the policy's version history) and ships the policy as `unconfigured`: no order can be
  created or advanced until the owner sets a schedule, which may be a percentage, a fixed amount or tiers by order
  total. Migration 13 lets staff retract a wrongly published tracking update without deleting it. The documents state
  how staff functions will be reached from Next.js without exposing the `admin` schema (a server-only gateway; not
  built), what the ledger protection does *not* stop (a privileged operator can disable triggers; tested and stated),
  and the reversal and correction procedures.
* **Server-side customer authentication** with `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.118.0 (both pinned):
  sign-up, password and email-link sign-in, email confirmation (both link formats), sign-out, protected routes,
  session refresh in the middleware, and loading, expired-session, unavailable and error states. No Supabase client
  exists in the browser and no service-role key exists anywhere in the feature.
* **A premium M1-branded dashboard:** overview, orders and order detail with a tracking timeline, payments and remaining
  balance, loyalty points and history, profile, and empty states. Typed against the database rows; no business figure is
  hard-coded.
* **A claim screen** that links an older WhatsApp-managed customer with a staff-issued single-use code. Every failure
  shows one sentence; nothing is ever linked by email or phone match.
* **A feature flag, off by default** (`CUSTOMER_ACCOUNTS_ENABLED`), ignored when `VERCEL_ENV` is `production`. With it
  off every account and auth address is the site's ordinary 404, the middleware does nothing and the public pages and
  the WhatsApp quote journey are unchanged.
* **A local emulator** (`supabase/emulator/`): a mock auth and data API in front of a real local PostgreSQL with the real
  migrations and RLS. **It is not Supabase.** `npm run accounts:preview` starts it with synthetic data for a browser.

## Verification

Run from a **fresh clone of the committed branch** (head `2472e27`) with a fresh `npm ci`. Node v22.23.4, PostgreSQL
16.15, Next.js 15.5.25, React 19.3.0, Chromium through Playwright. The run record's own commit adds documentation only.

| Check | Result |
|---|---|
| `npm run ops:validate` | OK, 153 files; one warning, about the OPS-0006 task file, which this work did not touch |
| `npm run ops:test` | **561 of 561** (the same count as the baseline) |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, **56 of 56** static pages (the same as the baseline); the account and auth routes are dynamic |
| `npm run db:test` | **153 of 153** (Phase 1's 135, plus 18 for the corrections), against a real PostgreSQL server |
| `npm run db:test:static` | **100 of 100**: 31 static checks, 15 money and environment tests, 54 account-module tests |
| `npm run accounts:e2e` | **43 of 43** browser tests (44 with `ACCOUNTS_E2E_SHOTS` set, which also writes the screenshots) |
| Mutation test, shared account modules | 36 single and 3 combined mutants; every real survivor fixed (see below) |
| Mutation test, server code | **16 of 16** caught |
| Mutation test, migrations 12 and 13 | **24 of 25** caught; the one survivor is an equivalent mutant (see below) |
| Flag-off comparison with the baseline build | visible HTML of all **35 of 35** pre-rendered public pages identical (see below) |

**Locally executed:** everything in the table. The browser tests drive the real production build (`next start`) in
Chromium against the emulator: sign-up and confirmation, sign-in and sign-out, the cookie flags, expiry, revocation,
tampering, an outage and recovery, two customers' isolation, the claim flow and its misuse, redirects, and the public
site with the flag off and on, including the WhatsApp quote journey.

**Needs a real Supabase development project, and was not run:** the real auth service, email delivery and templates,
rate limits, the Data API and column grants as PostgREST applies them, JWT signing keys with `getClaims()`, cookie size
with a real session, and the migrations as Supabase's `postgres` role. The checklist is Phase 2 of
`supabase/tests/REAL_SUPABASE_CHECKS.md`. **The integration is not claimed to work.**

### The mutation results in detail

* **Shared modules (redirects, flag, cookies, validation, claim codes, auth errors, site URL, view models):** 29 of 36
  mutants were caught at first. Three real survivors showed tests that did not bite and now do: the password minimum
  (no test at nine and ten characters), the claim-code length cap (a valid code buried in padding), and the timeline
  tie-break (the ids in my own test happened to sort the same way as the stages). Four others are not defects: two
  redirect layers that overlap on purpose (removing all three layers together, or the encoded-character guard and the
  path-prefix check together, is caught; removing the `//` check and the origin check together is equivalent because
  the function only ever returns a path), and a case-pattern mutant that is equivalent after upper-casing.
* **Server code (16 mutants):** nine were caught by the browser tests and two by static checks. Five survived and led to
  work: the claim failure path had two return sites (now one, so an unexpected error cannot look different from a wrong
  code); sign-up for a registered address was only tested against a project that hides it (the emulator can now behave
  like a project that reveals it, and a test requires the same screen); the email-link request was only compared by
  its answer (the emulator now creates an account on a request without `shouldCreateUser: false`, as the real service
  does, and a test requires no account and no email); the sign-in form's `next` field was only exercised through its
  safe default (a test now forges it); and the page guard's sign-out reason was a redundant layer behind the middleware
  (a static check now pins it). All 16 are now caught.
* **Migrations 12 and 13 (25 mutants):** tier validation, rounding, tier boundaries, the cap and minimum, the
  fail-closed unconfigured policy, the seed, the retraction exclusion in the customer policy, its permission, reason,
  one-time and append-only rules, its privacy, and its audit entry. 24 are caught by a failing test. The survivor
  (`on delete restrict` changed to `cascade` on the retraction key) is equivalent: deleting a tracking update is also
  blocked by the foreign key from the author record and by the append-only triggers, so the retraction key never
  decides it.
* **A caution about the method.** Surviving mutants can be false when a build is stale (one was, and it was caught on
  re-run); a kill is never false. The runner scripts restore only the file they mutated. An early version ran
  `git checkout -- src` at the end and reverted one uncommitted edit of mine, which the next pattern check noticed; the
  edit was re-applied and committed before any further run.

## Findings made during verification, and what was done

1. **A Next.js 15.5 navigation problem, and a decision.** After a Server Action succeeded, the router sometimes did not
   move: with a server `redirect()` and equally with a client `router.replace()`. The change had been made, the old
   form stayed, and about two attempts in eight passed. Any instrumentation made it pass, so it was found only by
   repetition and its cause was not isolated. Profile creation and claiming (each happens once in an account's life)
   now end with a full page load to one of a fixed list of destinations. Ten of ten clean attempts passed. Sign-in,
   sign-up and sign-out were reliable throughout. It should be re-tested before the framework is upgraded or the
   workaround is simplified.
2. **A test that could never fail.** The emulator helper that issues a claim code rolled its transaction back, so a code
   never existed and a rate-limit test passed vacuously. The helper now commits, and the claim tests link a real
   customer.
3. **A seed bug that looked like an application bug.** The preview data backdated tracking updates in one transaction,
   so they shared a timestamp and arrived in random id order. The seed now orders them by stage, and the view model
   has a total order (time, then the database's stage order, then id) so the timeline never depends on arrival order.
4. **A real mobile defect, found by looking at the screenshots.** At 390px the order's items table was wider than the
   screen and hid the unit price and the line total. Phones now get stacked rows. A browser test (no sideways scroll
   on any account page, and nothing pushed off the right edge) fails on the old layout and passes on the new one.
5. **Outage handling.** An outage of the auth service was first treated as a sign-out by the middleware. It now lets the
   page show its own "could not load" state, the error page's retry refetches, and a test switches the service off and
   back on.
6. **The credential scan and the personal-data scan caught my own test strings** (a multi-line pattern, an address that
   was not on a reserved domain). The scans were not relaxed: the pattern was made line-based and the address changed.
7. **Memory documents cannot link outside `docs/project-memory`**, because the project's test harness copies only
   `CLAUDE.md`, `docs/project-memory`, `ops` and `.github`. Paths elsewhere are code spans. The ops harness was not
   modified.

## The flag-off comparison with the baseline

Built from the **same directory** (webpack's numbers depend on the path): the baseline `7840a79` and the branch head,
with the flag off. Public pages are not touched by the middleware (its matcher is `/account` and `/auth` only).

* **All 35 pre-rendered public pages have identical visible HTML** once the build id is normalised (scripts and asset
  links removed).
* **The client files are not byte-identical, and this is stated plainly.** Adding routes renumbers webpack's chunk and
  module ids and changes the minifier's variable names. Of the 19 JavaScript files the public pages load, 1 is
  byte-identical and 15 are identical apart from those renumbered ids and renamed variables; 3 (the build-my-pc page
  chunk, the root layout chunk and webpack's runtime) did not match a mechanical normalisation, and the first two,
  inspected by hand, differ in the same ways. They were not exhaustively proven equal.
* **CSS:** every rule of the baseline stylesheet is still present (a few are grouped differently); 70 rules were added
  for the account screens.
* Functionally, the browser tests run the quote form and the `wa.me` hand-off with the flag both off and on.

## Preservation checks

* `main` (local `9faf57a`; remote `b180378`), `claude-dev` (local `187e045`, eight unpublished Reel commits; remote
  `b7348bb`), `claude/ops-staging-integration` (`005196a`) and every other branch are at the same commits as before.
  A live check of the remote branches shows no `claude/plat-*` branch and no changed tip.
* Draft pull request #1 is open, still a draft, with head `005196a`, last updated before this work began.
* Nothing under `public/` (including `public/builds/`), `creative/` or the logo changed. No Instagram work was touched
  and none was uploaded.
