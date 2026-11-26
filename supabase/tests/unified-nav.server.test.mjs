// THE UNIVERSAL SIGN-IN AND THE SESSION-AWARE HEADER: the server's decisions, run for real. The routing rules, the sign-in router page (/auth/continue), the sign-in
// page when someone is already signed in, and the route that tells the public header who is signed in are the REAL modules, run in plain Node under the
// loader in support/page-render-loader.mjs. Only the things that need a running site are stand-ins: the redirect (it throws, as in Next.js, so the test sees
// where the visitor was sent), the cookies, the verified session, the staff check and the customer-name read. What is proved here is therefore the LOGIC of every
// branch; the database function behind a staff member's name is proved in unified-nav.db.test.mjs, and how the header draws the answers in
// header.browser.test.mjs.
//
// What is proved:
//   * the routing rules for every state the staff check can report, with and without a page the person was heading to: staff with the second step done go to
//     /admin, staff without it go to /admin/mfa (and back to their admin page), customers and accounts without an admin area go to /account, a failed staff
//     check goes NOWHERE ("could not finish", never "customer"); a customer is never sent to an admin address; "/account" alone is not a request;
//   * an address that is not a same-site /account or /admin path (another site, "//host", backslashes, encoded slashes, control characters, too long) is never followed;
//   * the router page: signed out and expired sessions go to the sign-in page (with the page they wanted), a verified session goes where the rules say, and a failed
//     check shows the plain message with Try again and Sign out and does not redirect; the sign-in page does the same for someone already signed in;
//   * the header's route: a visitor with no sign-in cookie costs NO call to the auth service, the staff check or the customer read; each situation gives exactly
//     the answer the header expects (a staff name, a customer name, the neutral labels, "could not tell"), carries only a label, a kind and one fixed address, is
//     never cacheable, may not be read by another site, and is absent while the account switch is off.
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { afterEach, before, describe, it } from "node:test";

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const __dirname_of = () => require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

let postAuth;
let resolver;
let continuePage;
let signInPage;
let identityRoute;
let identityLib;
let accountPage;
before(async () => {
  accountPage = (await import("../../src/app/account/page.tsx")).default;
  postAuth = await import("../../src/lib/accounts/shared/post-auth.ts");
  resolver = await import("../../src/lib/accounts/server/post-auth.ts");
  continuePage = (await import("../../src/app/auth/continue/page.tsx")).default;
  signInPage = (await import("../../src/app/auth/sign-in/page.tsx")).default;
  identityRoute = await import("../../src/app/auth/header-identity/route.ts");
  identityLib = await import("../../src/lib/accounts/server/header-identity.ts");
});

const SIGNED_IN = { state: "signed_in", user: { id: "11111111-1111-4111-8111-111111111111", email: "someone@example.test" }, supabase: {} };
const AUTH_COOKIE = [{ name: "sb-abcdefghij-auth-token", value: "x" }];
function install(scenario) {
  globalThis.__M1_NAV__ = { pathname: "/auth/continue", cookies: AUTH_COOKIE, session: SIGNED_IN, staff: { state: "not_staff" }, staffProfile: { state: "not_staff" }, ...scenario };
  return globalThis.__M1_NAV__;
}
afterEach(() => {
  delete globalThis.__M1_NAV__;
  delete process.env.CUSTOMER_ACCOUNTS_ENABLED;
});

/** Runs a server page or action and reports where it sent the visitor (a redirect) or what it drew. */
async function visit(run) {
  try {
    const element = await run();
    return { to: null, html: renderToStaticMarkup(element) };
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) return { to: error.url, html: null };
    throw error;
  }
}
const params = (next) => ({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });

describe("where a person goes after signing in: the rules, for every state the staff check can report", () => {
  const go = (to) => ({ kind: "go", to });
  it("staff with the second step done go to the dashboard, or to the admin or account page they were heading to", () => {
    assert.deepEqual(postAuth.routeAfterSignIn("ok", undefined), go("/admin"));
    assert.deepEqual(postAuth.routeAfterSignIn("ok", ""), go("/admin"));
    assert.deepEqual(postAuth.routeAfterSignIn("ok", "/account"), go("/admin"), "/account alone is the usual landing place, not a request");
    assert.deepEqual(postAuth.routeAfterSignIn("ok", "/admin/orders"), go("/admin/orders"));
    assert.deepEqual(postAuth.routeAfterSignIn("ok", "/account/orders"), go("/account/orders"));
  });
  it("staff without the second step go to the second-step page, and back to the admin page they were heading to afterwards", () => {
    assert.deepEqual(postAuth.routeAfterSignIn("needs_mfa", undefined), go("/admin/mfa"));
    assert.deepEqual(postAuth.routeAfterSignIn("needs_mfa", "/admin"), go("/admin/mfa?next=%2Fadmin"));
    assert.deepEqual(postAuth.routeAfterSignIn("needs_mfa", "/admin/orders"), go("/admin/mfa?next=%2Fadmin%2Forders"));
    assert.deepEqual(postAuth.routeAfterSignIn("needs_mfa", "/account/orders"), go("/admin/mfa"), "an account page is not carried through the staff second step");
  });
  it("a customer (not staff, or an environment with no admin area) goes to the account, or to the account page they were heading to, never to an admin address", () => {
    for (const check of ["not_staff", "disabled"]) {
      assert.deepEqual(postAuth.routeAfterSignIn(check, undefined), go("/account"), check);
      assert.deepEqual(postAuth.routeAfterSignIn(check, "/account/orders/O-1"), go("/account/orders/O-1"), check);
      assert.deepEqual(postAuth.routeAfterSignIn(check, "/admin"), go("/account"), `${check}: an admin address would only answer 404`);
      assert.deepEqual(postAuth.routeAfterSignIn(check, "/admin/orders"), go("/account"), check);
    }
  });
  it("a staff check that could not be completed goes nowhere: it is never read as 'customer'", () => {
    for (const next of [undefined, "", "/account", "/account/orders", "/admin", "/admin/orders"]) {
      assert.deepEqual(postAuth.routeAfterSignIn("unavailable", next), { kind: "unavailable" }, String(next));
    }
  });
  it("a visitor with no session (or an ended one) goes to sign in", () => {
    assert.deepEqual(postAuth.routeAfterSignIn("signed_out", "/admin"), { kind: "sign_in", reason: "required" });
    assert.deepEqual(postAuth.routeAfterSignIn("expired", "/account"), { kind: "sign_in", reason: "expired" });
  });
  it("every state has an answer, and no answer ever leaves this site or reaches a path outside /admin, /account and /auth/continue", () => {
    const hostile = [undefined, null, 5, {}, [], "", "/", "https://evil.example/admin", "//evil.example", "/\\evil.example", "/admin\\..\\x", "/%2fadmin", "/admin/%2e%2e/x", "/account\n", "/admin/" + "a".repeat(300), "javascript:alert(1)", "/auth/sign-in", "/other"];
    for (const check of ["ok", "needs_mfa", "not_staff", "disabled", "unavailable", "signed_out", "expired"]) {
      for (const next of hostile) {
        const route = postAuth.routeAfterSignIn(check, next);
        assert.ok(["go", "sign_in", "unavailable"].includes(route.kind), `${check} ${String(next)}`);
        if (route.kind === "go") assert.match(route.to, /^\/(admin|account)(\/[A-Za-z0-9._~%-]*)*(\?next=%2Fadmin[A-Za-z0-9._~%-]*)?$/, `${check} ${String(next)} -> ${route.to}`);
      }
    }
  });
  it("only a same-site /account or /admin path counts as a page to return to, and '/account' alone counts as none", () => {
    assert.equal(postAuth.explicitNext("/admin/orders"), "/admin/orders");
    assert.equal(postAuth.explicitNext("/account/orders"), "/account/orders");
    for (const none of ["/account", "/", "", "https://evil.example", "//evil.example", "/auth/sign-in", "/administration", "/accounts", null, undefined]) assert.equal(postAuth.explicitNext(none), "", String(none));
  });
  it("the router's own address carries the page only when there is one, and encodes it", () => {
    assert.equal(postAuth.continueUrl(), "/auth/continue");
    assert.equal(postAuth.continueUrl(""), "/auth/continue");
    assert.equal(postAuth.continueUrl("/account"), "/auth/continue");
    assert.equal(postAuth.continueUrl("/admin/orders"), "/auth/continue?next=%2Fadmin%2Forders");
    assert.equal(postAuth.continueUrl("https://evil.example"), "/auth/continue");
  });
});

describe("the server half of the router asks the staff check about THIS request's verified session", () => {
  it("applies the rules to whatever the staff check says", async () => {
    const answers = { ok: "/admin", needs_mfa: "/admin/mfa", not_staff: "/account", disabled: "/account" };
    for (const [state, to] of Object.entries(answers)) {
      install({ staff: { state } });
      assert.deepEqual(await resolver.resolveAfterSignIn(undefined), { kind: "go", to }, state);
    }
    install({ staff: { state: "unavailable" } });
    assert.deepEqual(await resolver.resolveAfterSignIn(undefined), { kind: "unavailable" });
  });
});

describe("the sign-in router page (/auth/continue)", () => {
  const run = (next) => visit(() => continuePage(params(next)));
  it("sends a signed-out visitor to sign in, keeping the page they wanted", async () => {
    install({ session: { state: "signed_out" } });
    assert.equal((await run("/admin/orders")).to, "/auth/sign-in?reason=required&next=%2Fadmin%2Forders");
    install({ session: { state: "expired" } });
    assert.equal((await run()).to, "/auth/sign-in?reason=expired");
  });
  it("sends staff with the second step to /admin, staff without it to the second step, and a customer to /account", async () => {
    for (const [state, to] of [["ok", "/admin"], ["needs_mfa", "/admin/mfa"], ["not_staff", "/account"], ["disabled", "/account"]]) {
      install({ staff: { state } });
      assert.equal((await run()).to, to, state);
    }
  });
  it("keeps the page a person was heading to, where the rules allow it", async () => {
    install({ staff: { state: "ok" } });
    assert.equal((await run("/admin/orders")).to, "/admin/orders");
    install({ staff: { state: "not_staff" } });
    assert.equal((await run("/account/orders")).to, "/account/orders");
    assert.equal((await run("/admin/orders")).to, "/account", "a customer is not sent to an admin address");
    assert.equal((await run("https://evil.example/")).to, "/account", "another site is never followed");
  });
  it("when the staff check could not be completed it does NOT redirect: it says so, offers Try again and Sign out, and never shows or opens the customer account", async () => {
    install({ staff: { state: "unavailable" } });
    const result = await run("/admin/orders");
    assert.equal(result.to, null);
    const page = text(result.html);
    assert.match(page, /We could not finish signing you in/);
    assert.match(page, /Try again/);
    assert.match(page, /Sign out/);
    assert.match(result.html, /href="\/auth\/continue\?next=%2Fadmin%2Forders"/, "Try again returns to the router with the same page");
    assert.doesNotMatch(result.html, /href="\/account"/, "no way into the customer account from here");
  });
  it("a check that THROWS is not an answer either: the error is not swallowed into 'customer'", async () => {
    install({ staffThrows: true });
    await assert.rejects(() => run(), /the staff check threw/);
  });
  it("when the auth service itself cannot be reached it says so instead of guessing", async () => {
    for (const state of ["unavailable", "not_configured"]) {
      install({ session: { state } });
      const result = await run();
      assert.equal(result.to, null, state);
      assert.match(text(result.html), /We could not finish signing you in/, state);
    }
  });
});

describe("the sign-in page for someone who is already signed in, and for everyone else", () => {
  const run = (next) => visit(() => signInPage(params(next)));
  it("a signed-in person is sent through the same router (staff to the dashboard, a customer to the account)", async () => {
    for (const [state, to] of [["ok", "/admin"], ["needs_mfa", "/admin/mfa"], ["not_staff", "/account"]]) {
      install({ pathname: "/auth/sign-in", staff: { state } });
      assert.equal((await run()).to, to, state);
    }
    install({ pathname: "/auth/sign-in", staff: { state: "ok" } });
    assert.equal((await run("/admin/orders")).to, "/admin/orders");
  });
  it("a failed staff check shows a notice and a Sign out button, and does not hide the form or open the customer account", async () => {
    install({ pathname: "/auth/sign-in", staff: { state: "unavailable" } });
    const result = await run();
    assert.equal(result.to, null);
    assert.match(text(result.html), /signed in, but we could not check where to take you/i);
    assert.match(text(result.html), /Sign out/);
  });
  it("a signed-out visitor sees the one sign-in form, with the Forgot password and Create account links, no sign-in link, and no staff or admin wording", async () => {
    install({ pathname: "/auth/sign-in", session: { state: "signed_out" }, cookies: [] });
    const result = await run("/admin/orders");
    assert.equal(result.to, null);
    assert.match(result.html, /name="next" value="\/admin\/orders"/, "the page they wanted is carried by the form (and checked again when it is sent)");
    assert.match(text(result.html), /Welcome back/);
    assert.match(text(result.html), /Forgot password\?/);
    assert.match(text(result.html), /Create account/);
    assert.equal((result.html.match(/<form\b/g) ?? []).length, 1, "exactly one form on the page");
    assert.equal((result.html.match(/type="password"/g) ?? []).length, 1, "exactly one password field");
    assert.equal((result.html.match(/type="email"/g) ?? []).length, 1, "exactly one email field: there is no second, passwordless one");
    assert.doesNotMatch(text(result.html), /sign-in link|no password needed|email me|one-time/i, "no passwordless wording");
    assert.doesNotMatch(result.html, /link-email/, "no field for a sign-in link");
    assert.doesNotMatch(text(result.html), /admin login|staff login|staff dashboard|are you staff/i, "the sign-in page does not tell people apart");
    assert.equal(globalThis.__M1_NAV__.staffCalls ?? 0, 0, "the staff check is not asked for a visitor who is not signed in");
  });
  it("an unsafe page to return to is dropped (the form carries nothing)", async () => {
    install({ pathname: "/auth/sign-in", session: { state: "signed_out" }, cookies: [] });
    const result = await run("https://evil.example/admin");
    assert.match(result.html, /name="next" value=""/);
  });
});

describe("what the public header is told about who is signed in (/auth/header-identity)", () => {
  const ask = async (scenario) => {
    process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
    install(scenario);
    const response = await identityRoute.GET();
    return { status: response.status, body: response.status === 404 ? null : await response.json(), headers: response.headers, nav: globalThis.__M1_NAV__ };
  };
  const keys = (o) => Object.keys(o).sort();

  it("a visitor with no sign-in cookie is signed out, and that costs no call to the auth service, the staff check or the customer read", async () => {
    const { body, nav } = await ask({ cookies: [] });
    assert.deepEqual(body, { state: "signed_out" });
    assert.equal(nav.sessionCalls ?? 0, 0);
    assert.equal(nav.profileCalls ?? 0, 0);
    assert.equal(nav.nameCalls ?? 0, 0);
  });
  it("other cookies (not the sign-in cookie) do not count", async () => {
    const { body, nav } = await ask({ cookies: [{ name: "theme", value: "dark" }, { name: "sb-x-other", value: "1" }] });
    assert.deepEqual(body, { state: "signed_out" });
    assert.equal(nav.sessionCalls ?? 0, 0);
  });
  it("a sign-in cookie the auth service no longer accepts is signed out; an outage is 'could not tell', never signed out", async () => {
    assert.deepEqual((await ask({ session: { state: "expired" } })).body, { state: "signed_out" });
    assert.deepEqual((await ask({ session: { state: "signed_out" } })).body, { state: "signed_out" });
    assert.deepEqual((await ask({ session: { state: "not_configured" } })).body, { state: "signed_out" });
    assert.deepEqual((await ask({ session: { state: "unavailable" } })).body, { state: "unknown" });
  });
  it("active staff are named with the display name the staff table holds, and linked to /admin", async () => {
    const { body } = await ask({ staffProfile: { state: "staff", displayName: "Olivia Owner" } });
    assert.deepEqual(body, { state: "signed_in", kind: "staff", label: "Olivia Owner", href: "/admin" });
  });
  it("staff with no name set get the neutral label, never an invented name or an e-mail address", async () => {
    for (const displayName of [null, "", "   ", "‮"]) {
      const { body } = await ask({ staffProfile: { state: "staff", displayName } });
      assert.deepEqual(body, { state: "signed_in", kind: "staff", label: "Staff account", href: "/admin" }, JSON.stringify(displayName));
    }
  });
  it("a staff name is cleaned and cut before it is sent (no control or direction-changing characters, 60 characters at most)", async () => {
    const { body } = await ask({ staffProfile: { state: "staff", displayName: "  Sara‮   Al​i\n" } });
    assert.equal(body.label, "Sara Ali");
    const long = (await ask({ staffProfile: { state: "staff", displayName: "A".repeat(200) } })).body.label;
    assert.ok(Array.from(long).length <= 60);
  });
  it("a customer is named with the linked customer profile's name and linked to /account", async () => {
    const { body, nav } = await ask({ staffProfile: { state: "not_staff" }, customerName: "Sara Ali" });
    assert.deepEqual(body, { state: "signed_in", kind: "customer", label: "Sara Ali", href: "/account" });
    assert.equal(nav.nameCalls, 1);
  });
  it("a customer with no profile yet gets the neutral label 'My account'", async () => {
    const { body } = await ask({ staffProfile: { state: "not_staff" }, customerName: null });
    assert.deepEqual(body, { state: "signed_in", kind: "customer", label: "My account", href: "/account" });
  });
  it("a customer whose profile cannot be read is still a signed-in customer (the staff check said so), with the neutral label", async () => {
    const { body } = await ask({ staffProfile: { state: "not_staff" }, customerNameError: true });
    assert.deepEqual(body, { state: "signed_in", kind: "customer", label: "My account", href: "/account" });
  });
  it("a staff check that could not be completed is NEVER answered as a customer: neutral label, and the link goes through the router, which fails safe", async () => {
    const { body, nav } = await ask({ staffProfile: { state: "unavailable" }, customerName: "Should Not Appear" });
    assert.deepEqual(body, { state: "signed_in", kind: "unknown", label: "My account", href: "/auth/continue" });
    assert.equal(nav.nameCalls ?? 0, 0, "the customer's name is not even read when the staff check failed");
  });
  it("an answer carries only a state, a kind, a label and one of three fixed addresses: no e-mail, no id, no role, no permission", async () => {
    for (const scenario of [
      { staffProfile: { state: "staff", displayName: "Olivia Owner" } },
      { staffProfile: { state: "not_staff" }, customerName: "Sara Ali" },
      { staffProfile: { state: "unavailable" } },
    ]) {
      const { body } = await ask(scenario);
      assert.deepEqual(keys(body), ["href", "kind", "label", "state"]);
      assert.ok(["/admin", "/account", "/auth/continue"].includes(body.href));
      assert.doesNotMatch(JSON.stringify(body), /someone@example\.test|11111111-1111|permission|role|owner@/i);
    }
  });
  it("the answer is never cached, varies with the cookie, is not indexed and cannot be read by another site", async () => {
    for (const scenario of [{ cookies: [] }, { staffProfile: { state: "staff", displayName: "Olivia Owner" } }]) {
      const { headers } = await ask(scenario);
      assert.match(headers.get("cache-control"), /private/);
      assert.match(headers.get("cache-control"), /no-store/);
      assert.match(headers.get("vary"), /cookie/i);
      assert.match(headers.get("x-robots-tag"), /noindex/);
      assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
      assert.equal(headers.get("x-content-type-options"), "nosniff");
      assert.match(headers.get("content-type"), /application\/json/);
    }
  });
  it("the route does not exist while the account switch is off (404, still not cacheable), and so does nothing on a production deployment", async () => {
    install({});
    for (const env of [{}, { CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "production" }]) {
      delete process.env.CUSTOMER_ACCOUNTS_ENABLED;
      const was = process.env.VERCEL_ENV;
      Object.assign(process.env, env);
      const response = await identityRoute.GET();
      if (was === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = was;
      assert.equal(response.status, 404);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.equal(globalThis.__M1_NAV__.sessionCalls ?? 0, 0, "nothing was asked of anyone");
    }
    delete process.env.CUSTOMER_ACCOUNTS_ENABLED;
    delete process.env.VERCEL_ENV;
  });
  it("one request asks the auth service exactly once", async () => {
    const { nav } = await ask({ staffProfile: { state: "not_staff" }, customerName: "Sara Ali" });
    assert.equal(nav.sessionCalls, 1);
    assert.equal(typeof identityLib.readHeaderIdentity, "function");
  });
});

describe("the account overview: a staff member with no customer profile is not a new customer", () => {
  const USER = { id: "22222222-2222-4222-8222-222222222222", email: "staff.person@example.test" };
  const CUSTOMER_ROW = { id: "33333333-3333-4333-8333-333333333333", full_name: "Alice Test", customer_code: "C-0001" };
  const context = (customers) => ({ user: USER, supabase: {}, customer: customers[0] ?? null, customers });
  const open = (staff, customers = []) => {
    const nav = install({ pathname: "/account", customerContext: context(customers), staff });
    return { nav, run: () => visit(() => accountPage({ searchParams: Promise.resolve({}) })) };
  };

  it("verified staff (second step done) with no profile are sent to the staff dashboard, not shown the set-up screen", async () => {
    const { run } = open({ state: "ok" });
    const result = await run();
    assert.equal(result.to, "/admin");
    assert.equal(result.html, null, "nothing of the set-up screen was drawn");
  });

  it("staff who still need the second step are sent to it, not shown the set-up screen", async () => {
    const result = await open({ state: "needs_mfa" }).run();
    assert.equal(result.to, "/admin/mfa");
  });

  it("when the staff check cannot be made, the set-up screen is NOT shown (a failed lookup is never read as 'new customer'): a calm message instead", async () => {
    const result = await open({ state: "unavailable" }).run();
    assert.equal(result.to, null);
    const page = text(result.html);
    assert.match(page, /We could not open your account/);
    assert.match(page, /We could not check your account just now/);
    assert.doesNotMatch(page, /Welcome to M1|claim code|Start a new profile|New to M1/i, "no set-up screen, no profile form, no claim-code offer");
  });

  it("someone who is not staff (or where there is no staff area) keeps the usual set-up and claim-code screen", async () => {
    for (const state of ["not_staff", "disabled"]) {
      const result = await open({ state }).run();
      assert.equal(result.to, null, state);
      const page = text(result.html);
      assert.match(page, /Welcome to M1/, state);
      assert.match(page, /I have a claim code/, state);
      assert.match(result.html, /href="\/account\/claim"/, state);
      assert.match(page, /New to M1\?/, state);
    }
  });

  it("an account that already has a customer profile never asks the staff check at all (it costs nothing and cannot misroute)", async () => {
    const { nav, run } = open({ state: "ok" }, [CUSTOMER_ROW]);
    const result = await run();
    assert.equal(result.to, null);
    assert.match(text(result.html), /Alice/);
    assert.equal(nav.staffCalls ?? 0, 0, "no staff lookup for a customer with a profile");
  });
});

describe("the staff name for the header (the real lookup in src/lib/staff/session.ts, read as source)", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname_of(), "../../src/lib/staff/session.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function getStaffProfileFor"));
  it("an error asking the staff database is 'unavailable' (never 'not staff', which would show a customer name), and so is an identity that could not be verified", () => {
    const catchBlock = body.slice(body.indexOf("catch (error)"), body.indexOf("catch (error)") + 260);
    assert.match(catchBlock, /return \{ state: "unavailable" \}/);
    assert.doesNotMatch(catchBlock, /not_staff/);
    assert.match(body, /if \(!identity\.ok\) return \{ state: "unavailable" \}/);
  });
  it("'not staff' is answered in exactly two places: the admin area is switched off here, or the database said this person has no active staff row", () => {
    const fn = body.slice(0, body.indexOf("\n}\n") + 3);
    assert.equal((fn.match(/not_staff/g) ?? []).length, 2);
    assert.match(fn, /if \(!adminEnabled\(\)\) return \{ state: "not_staff" \}/);
    assert.match(fn, /profile \? \{ state: "staff", displayName: profile\.display_name \?\? null \} : \{ state: "not_staff" \}/);
  });
});
