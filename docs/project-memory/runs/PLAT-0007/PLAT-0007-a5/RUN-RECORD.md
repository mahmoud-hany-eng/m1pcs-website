# PLAT-0007 — run record, attempt 5 (one email-and-password login: the passwordless sign-in removed)

The brief is recorded as HD-0028. It follows attempt 4 ([RUN-RECORD](../PLAT-0007-a4/RUN-RECORD.md): the unified login, the personalised header and the public header above both dashboards; deployed to DEV and accepted). Scope: **the sign-in page and the code that could sign someone in without a password**. **Local only: nothing is pushed**, the hosted DEV database and the hosted Auth settings were not touched, there is **no database migration**, and there is no change to Production, `main`, `claude-dev`, MFA, any role or permission, any order / payment / loyalty / receipt record, the deposit tiers, the accounting, the staff or customer routing rules, or the Instagram files.

## What the owner asked for, and where it lives

| Request | Where it is |
| --- | --- |
| The sign-in page holds only the M1 branding with a "Welcome back" heading, the email input, the password input, Forgot password, the main Log in button and Create account | `src/app/auth/sign-in/page.tsx`, `src/components/account/forms.tsx` (`SignInForm`) |
| Remove the "or" divider, the second email field, the one-time-link text and the "Email me a sign-in link" button | the same files: `EmailLinkForm` and the divider are gone |
| Remove the code that exists only to issue magic links, not just the button; leave no public action that signs in without a password | `emailLinkAction` (the only caller of `signInWithOtp` in the project) is deleted from `src/lib/accounts/server/actions.ts`; `magiclink` is removed from the types `src/app/auth/confirm/route.ts` accepts |
| Keep confirmation after sign-up, Forgot password, secure sessions, expiry and re-authentication, claim codes | untouched: `signUpAction`, `resendConfirmationAction`, `requestPasswordResetAction`, `updatePasswordAction`, the confirm route's `email`, `signup` and `recovery` types, the claim actions; all re-tested (below) |
| Keep the universal role-based routing and the header behaviour | untouched (`/auth/continue`, `routeAfterSignIn`, `header-identity`); the existing routing and header suites still pass |

## What changed, in one paragraph each

* **The page.** One form: Email, Password, **Log in** (it said "Sign in"), then **Forgot password?** and **New here? Create account**. The page's heading is "Welcome back" (it was "Sign in") under the same "M1 account" label. The introductory sentence and the closing sentence about the quote form were removed so that the page holds only the requested elements. Notices (session ended, sign-in required, the router could not answer) and the field errors are unchanged.
* **The server.** `emailLinkAction` and its form are deleted. `emailLinkTarget` stays: it still builds the address the confirmation and password-reset emails open. The confirm route keeps `email` (the type the repository's confirmation template carries), `signup` (its older name) and `recovery`; a `magiclink` token now ends at the same "That link did not work" page with no session, like any bad link.
* **The email templates.** `supabase/templates/magic_link.html` (the local stack's sign-in-link email) now carries **no link and no token**; it only says to sign in with the password. The Auth service can still send that email if its API is called directly with the project's public key, so the reference template must be harmless (the hosted project needs the same text: OQ-0061).
* **The test emulator.** It gained `POST /auth/v1/recover` and `PUT /auth/v1/user`, so Forgot password can be driven end to end in a real browser (before, only its input checks were tested).

## Tests

| Check | Result |
| --- | --- |
| `npm run test:db` (real PostgreSQL 16, rendered pages, static rules) | **1302 of 1302 pass**, 0 skipped (1295 before: +7 static tests for this change; the sign-in page render test and the allowed-types test were rewritten, not weakened) |
| `npm run test:browser` (the CI command, no screenshot folder set) | **249 of 249 pass**, 0 skipped (243 in the same configuration before: +6). The accounts file went from 44 to 50 tests: the sign-in page contents, empty / malformed / wrong credentials, four widths, Forgot password for known and unknown addresses, the whole reset journey, a directly requested magic link signing nobody in, and `type=email` confirmation. The screenshots were taken in a separate run of that file (50 of 50), at desktop and mobile width |
| `npm run ops:validate` / `npm run ops:test` | OK (the same 1 warning that predates this work) / **563 of 563** |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | no problems / clean / compiles |
| Mutation check (`run-unified-nav-mutations.mjs`, new rules L01 to L07) | **7 of 7 caught** (a magic-link type accepted again; an action calling `signInWithOtp` added; the heading lost; a second form added; the template carrying a link again; the button label changed; the Forgot password call removed) |

New tests: `unified-nav.static.test.mjs` (7: the only sign-in call in the source is `signInWithPassword`; no `signInWithOtp`, anonymous, OAuth, ID-token, SSO, web3 or `shouldCreateUser` anywhere; the account actions are exactly the known nine; token-checking calls only in the confirm route; the three allowed types; the sign-in page's contents; the forms that remain; the templates), `unified-nav.server.test.mjs` (the sign-in page render: one form, one email field, one password field, no link wording), `accounts.e2e.test.mjs` (6 new, 2 rewritten: see above).

## Limits

* The hosted Supabase Auth project cannot be switched to "password only": its API can still send a sign-in-link (OTP) email when called directly. The site neither requests, offers nor accepts one of the `magiclink` kind, but whether the real service would also accept such a token presented as `type=email` was not tested (the emulator is not the real service). OQ-0061 records the recommended hosted-template change and a one-time check on DEV; neither was done.
* Forgot password and confirmation were driven against the local emulator (mocked delivery), not the real service; the hosted Auth redirect list must contain the Preview URL first.
* The owner's real login with a real authenticator code was not driven (as in attempt 4); the routing matrix and the header suites that cover it are unchanged and pass.
* Reminders carried: revoke the Vercel project-scoped token; clawback after payment reversal is not implemented (OQ-0043); the hosted 11-argument `admin.create_order` one-blank-line deviation; the legacy 6- and 7-argument `create_order` overloads remain a Production blocker; the historical-order importer and retroactive loyalty are not started.

## Owner decisions remaining

OQ-0061 (the hosted Magic Link email template). The staff display name (OQ-0057) is still open.
