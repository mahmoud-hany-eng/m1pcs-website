# The account menu in the public website's header (PLAT-0007)

Status: implemented locally; not pushed or deployed. The brief is HD-0024. It is a **navigation shortcut only**: it adds no sign-in, no session logic and no
permission. Every address it leads to still passes its own sign-in and second-step (MFA) checks, exactly as before.

## 1. What it is

A small circular account icon immediately to the right of **Get a Quote** in the header from 1024px up (the `lg` breakpoint). A click opens a dark-glass menu with a
short fade and a few pixels of slide; on a phone (below 1024px) the same entries are in the hamburger menu, in an "Account" group below the six links.

### The bar at each width (corrective release, PLAT-0007-a2)

| Width | In the bar | The six links |
| --- | --- | --- |
| below 1024px | logo, menu button | in the menu, with Get a Quote and the Account group |
| 1024px to 80em (1280px) | logo, **Get a Quote, account button**, menu button | in the menu (a list hanging under the menu button; it does not repeat Get a Quote or the Account group, which are in the bar) |
| 80em (1280px) and up | logo, **the six links**, Get a Quote, account button | in the bar |

**Why.** The first version put the six links in the bar from 1024px, with about 52px to spare in the site's own font. A CI runner drew a wider fallback font and the links wrapped
onto two rows (found by `header.browser.test.mjs`, run #19). How much room six links need depends on the font the visitor's system really draws, which cannot be known, so the
layout no longer depends on a guess: the links are in the bar only where there is room to spare even in a wide fallback font (at least 24px free on each side, tested at 1280 and
1440px in three font conditions), and below that they are in the menu, which does not depend on text width. The switch is written in **em** (`min-width: 80em`), not px, so a visitor
who has chosen larger default text in the browser gets the menu earlier too (that case follows from the CSS standard; it could not be driven in the automated browser). The links
never wrap inside themselves and the group does not shrink. Opening the menu closes the account menu and the other way round (they are side by side from 1024px); widening the window
past 80em closes an open menu and gives the page its scrolling back.

| Entry | Address | Offered when |
| --- | --- | --- |
| My Account | `/account` | the customer-account switch is on |
| Customer Sign In | `/auth/sign-in` | the same (left out inside `/account`, `/admin` and on the sign-in page itself) |
| Create Account | `/auth/sign-up` | the same (left out inside `/account`, `/admin` and on the sign-up page itself) |
| Staff Dashboard | `/admin` | the staff switch **and** the account switch are on (the admin layout needs both); drawn after a divider; left out inside `/admin` |

## 2. The feature switches (the production guarantee)

The routes themselves answer the site's ordinary 404 unless their switches are on, and **on a Vercel production deployment both switches are ignored** whatever the
variables say (`src/lib/accounts/shared/flag.ts`, `src/lib/staff/flag.ts`). The header uses **the same two gate functions**, through one pure module,
`src/lib/accounts/shared/header-nav.ts`, which returns the links that exist in this deployment, **nothing at all** otherwise. The header draws no button and no link
where there is nothing to offer, so **no visitor is ever offered a link that would be a 404**, and today's Production header is exactly as it was (tested).

* The root layout calls it with `process.env` and hands the result to the header as props. The header and the menu import none of the account code; a static test
  pins the layout's import as the single exception to the public site's isolation rule, requires the module to import only the two gates and the link type, to
  read no environment of its own, and the layout not to read cookies or headers (so the public pages stay static and cached).
* **When customer accounts are approved for Production**, the only change is lifting the production guard in `flag.ts`; this component needs nothing. That is a
  separate, approved release. **Nothing here activates accounts or the admin routes in Production.**
* **Evaluated where the page is rendered.** The account, sign-in, sign-up and dashboard pages are rendered per visitor. The public pages are built once per
  deployment, so they use the environment of the **build**; on Vercel a deployment's build and run share one environment, so a Preview with the switches on shows the
  button on every page, and Production shows none. Changing a variable needs a new deployment, as for any variable. Checked by hand with two scratch builds: a
  Preview-style build (both switches on) draws the button on `/`, `/build-my-pc` and `/contact`; a production-style build with both switches forced on draws no button
  and no account link anywhere, and `/auth/sign-in`, `/account` and `/admin` answer 404. In the automated suite the public pages are checked in the default build
  (no account link of any kind) and the menu itself is exercised on the per-visitor pages.

## 3. Signed-in state

The sign-in cookies are `HttpOnly` by design, so a public page cannot know whether the visitor is signed in, and reading them in the layout would make every public
page dynamic (slower, uncached). So the menu offers the whole set and leaves out only what is plainly redundant on the page being viewed (the table above). "My
Account" sends a visitor who is not signed in to the sign-in page with the way back in `next`. A true signed-in state is OQ-0048.

## 4. Behaviour and accessibility

* **Disclosure pattern.** The button has `aria-label="Account menu"`, `aria-expanded` and (while open) `aria-controls`; the list is ordinary links in a
  `nav aria-label="Account"`. No hover is needed anywhere.
* Opens on click, Enter or Space; **ArrowDown** opens it on the first entry. Up / Down / Home / End move between entries (wrapping). **Escape** closes it and returns
  focus to the button; tabbing out of it closes it; a click or tap elsewhere closes it; using an entry or any change of page closes it.
* The menu is in the page only while open or closing, so a closed menu puts no extra links in the document.
* Motion: `account-menu-in` (160 ms) and `account-menu-out` (120 ms), CSS in `globals.css`. With **reduced motion** there is no animation and it closes at once.
* It sits above the page (the header is `z-50`; the menu `z-[60]` inside it) and inside the screen; text is near-white on the dark glass; entries are at least 40 px
  tall; the current page is marked `aria-current="page"`.
* The header's size (4 / 5 rem box, the capsule), stickiness, the transparent-to-glass change and the existing links are unchanged. The hamburger menu scrolls inside
  itself on a short screen.

## 5. Tests

`orders-list-lib.test.mjs` (the link rules: nothing unless the switch is on, nothing in production, the staff entry needs both switches, the redundancy rules),
`static.test.mjs` (the isolation exception and the layout's constraints), `header.browser.test.mjs` (25: four copies of the site: off, customer switch, both, and
production with both forced on; **the bar at 1024, 1060, 1100, 1280 and 1440px in three font conditions (the site's fonts, the web fonts blocked, a wide fallback): Get a Quote and the account button always in the bar, no wrap, overlap or overflow, links inline only from 1280px with room to spare, the menu below it; the menu's contents, keyboard and reduced motion at tablet widths; the two menus never open together**; open and close; animation and reduced motion; click outside, Escape and focus; the
keyboard; never covered by the page; the entries' destinations; the Staff Dashboard link leading a visitor with no session to sign in; the quotation builder; the
phone menu at 390 and 360 px; no account group when the switches are off).

Four deliberate breakages of the menu (no close on an outside click, Escape without returning focus, a button that never reports `aria-expanded`, a hamburger with no Account group) were each caught by this file; see the run record.
