// EMAIL LINKS: THE REAL TEMPLATES, FILLED IN WITH THE ADDRESSES THE APP REALLY SENDS.
//
// Why this file exists. In the unified-login commit (2cd3424) the sign-up and resend actions stopped sending "?next=/account" with the address the email's
// link should open. The repository's confirmation template builds the link as `{{ .RedirectTo }}&token_hash=...&type=email`, which only works when the address
// already has a "?". The emailed link became "/auth/confirm&token_hash=..." (a page that does not exist) and nothing noticed: the local emulator used to compose
// its own links and never filled in a template. The emulator now fills in the repository's templates too (supabase/emulator/gotrue.mjs), and THIS file proves
// the same thing without a browser:
//   * the address the REAL sign-up, resend and forgot-password actions hand to the Auth service (captured from a stand-in client);
//   * the REAL files in supabase/templates, filled in the way the Auth service fills them ({{ .RedirectTo }}, {{ .TokenHash }}), give a working link: the
//     /auth/confirm path, token_hash as a real query parameter, the right type, the page to return to;
//   * the address cannot point to another site, whatever the request headers or the `next` value say;
//   * the default Supabase template ({{ .ConfirmationURL }}, which comes back to the site with ?code=) still works with the same address;
//   * the REAL confirmation route, given that link, hands the visitor to the sign-in router, which decides by VERIFIED STAFF MEMBERSHIP where they go;
//     a recovery link goes to the new-password page; a sign-in (magic) link is refused without even asking the Auth service.
// It says nothing about the hosted project: what a project's dashboard really contains is a setting this repository cannot read (see
// supabase/tests/REAL_SUPABASE_CHECKS.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const ORIGIN = "https://m1pcs-website-h1gf1tiho-m1-pc-s.vercel.app";
const PROJECT = "https://tqdkxqjiadwashhwuglx.supabase.co";
const HASH = "3f9a7c0e5b1d4a62";
const GOOD_PASSWORD = "A-long-synthetic-passphrase-1";

let actions;
let route;
let siteUrl;
let postAuth;
let continuePage;
before(async () => {
  siteUrl = await import("../../src/lib/accounts/shared/site-url.ts");
  postAuth = await import("../../src/lib/accounts/shared/post-auth.ts");
  actions = await import("../../src/lib/accounts/server/actions.ts");
  route = await import("../../src/app/auth/confirm/route.ts");
  continuePage = (await import("../../src/app/auth/continue/page.tsx")).default;
});

// --- a stand-in for the Auth service's client: it records what the app asked for -----------------------------------------------------------------------------
const SIGNED_IN = { state: "signed_in", user: { id: "11111111-1111-4111-8111-111111111111", email: "someone@example.test" }, supabase: {} };
function fakeSupabase(calls, { verifyError = null } = {}) {
  return {
    auth: {
      signUp: async (args) => (calls.push({ call: "signUp", args }), { data: { session: null, user: { id: "u1" } }, error: null }),
      resend: async (args) => (calls.push({ call: "resend", args }), { error: null }),
      resetPasswordForEmail: async (email, options) => (calls.push({ call: "resetPasswordForEmail", args: { email, options } }), { error: null }),
      verifyOtp: async (args) => (calls.push({ call: "verifyOtp", args }), { error: verifyError }),
      exchangeCodeForSession: async (code) => (calls.push({ call: "exchangeCodeForSession", args: { code } }), { error: verifyError }),
    },
  };
}
function install(scenario = {}) {
  globalThis.__M1_NAV__ = { pathname: "/auth/continue", cookies: [{ name: "sb-abcdefghij-auth-token", value: "x" }], session: SIGNED_IN, staff: { state: "not_staff" }, staffProfile: { state: "not_staff" }, headers: {}, ...scenario };
  return globalThis.__M1_NAV__;
}
afterEach(() => {
  delete globalThis.__M1_NAV__;
  delete process.env.CUSTOMER_ACCOUNTS_ENABLED;
  delete process.env.CUSTOMER_ACCOUNTS_SITE_URL;
});
function enable({ siteUrl: configured = ORIGIN } = {}) {
  process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
  if (configured) process.env.CUSTOMER_ACCOUNTS_SITE_URL = configured;
  else delete process.env.CUSTOMER_ACCOUNTS_SITE_URL;
}
const form = (fields) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
/** Runs a server action the way Next does: a redirect throws, and the test reads where it went. */
async function run(action, data) {
  try {
    return { result: await action({ status: "idle" }, data), to: null };
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) return { result: null, to: error.url };
    throw error;
  }
}
/** What each action handed to the Auth service as the address the email's link should open (undefined when it handed none). */
async function redirectsSent(headers = {}) {
  const calls = [];
  install({ supabase: fakeSupabase(calls), headers });
  await run(actions.signUpAction, form({ email: "new.customer@example.test", password: GOOD_PASSWORD }));
  await run(actions.resendConfirmationAction, form({ email: "new.customer@example.test" }));
  await run(actions.requestPasswordResetAction, form({ email: "new.customer@example.test" }));
  const of = (name) => calls.find((c) => c.call === name);
  return {
    signUp: of("signUp")?.args.options?.emailRedirectTo,
    resend: of("resend")?.args.options?.emailRedirectTo,
    reset: of("resetPasswordForEmail")?.args.options?.redirectTo,
    resendType: of("resend")?.args.type,
  };
}

// --- the templates, filled in the way the Auth service fills them -------------------------------------------------------------------------------------------
const TEMPLATE = { confirmation: "supabase/templates/confirmation.html", recovery: "supabase/templates/recovery.html", magic_link: "supabase/templates/magic_link.html" };
const decodeEntities = (text) => text.replace(/&amp;/g, "&").replace(/&#x3D;|&#61;/g, "=").replace(/&#x3F;|&#63;/g, "?");
/** `{{ .Name }}` replaced by the variable. A variable this test does not know fails the test: a template that needs a new one must be reviewed. */
function renderTemplate(template, variables) {
  return template.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_, name) => {
    assert.ok(name in variables, `the template uses {{ .${name} }}, which this test does not provide`);
    return variables[name];
  });
}
/** The link in the email: the address in the template's first href, with HTML entities decoded (a mail client's "click" does that). */
const linkOf = (templateKey, redirectTo, hash = HASH) => {
  const html = renderTemplate(read(TEMPLATE[templateKey]), { RedirectTo: redirectTo, TokenHash: hash, SiteURL: ORIGIN });
  return decodeEntities(html.match(/href="([^"]+)"/)[1]);
};
/** What a link must be to work with /auth/confirm. Throws (a failed assertion) for anything else, in particular for the malformed address of 2cd3424. */
function assertWorkingLink(link, { type, next, hash = HASH, origin = ORIGIN }) {
  const url = new URL(link);
  assert.equal(url.origin, origin, `the link opens ${link}`);
  assert.equal(url.pathname, "/auth/confirm", `the path of ${link}`);
  assert.equal(url.searchParams.get("token_hash"), hash, `token_hash must be a real query parameter in ${link}`);
  assert.equal(url.searchParams.get("type"), type, `the verification type in ${link}`);
  assert.equal(url.searchParams.get("next"), next, `the page to return to in ${link}`);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["next", "token_hash", "type"], `no other parameter in ${link}`);
  assert.equal(url.hash, "", `no fragment in ${link}`);
}
const allowedTypes = () => read("src/app/auth/confirm/route.ts").match(/ALLOWED_TYPES[^=]*=\s*\[([^\]]*)\]/)[1].match(/"[a-z_]+"/g).map((t) => t.slice(1, -1));

describe("the address the app gives the Auth service for the link in each email", () => {
  it("sign-up, resend and forgot-password each send an address on THIS site's /auth/confirm, with a query string", async () => {
    enable();
    const sent = await redirectsSent();
    assert.equal(sent.signUp, `${ORIGIN}/auth/confirm?next=%2Faccount`);
    assert.equal(sent.resend, `${ORIGIN}/auth/confirm?next=%2Faccount`);
    assert.equal(sent.reset, `${ORIGIN}/auth/confirm?next=%2Fauth%2Freset-password`);
    assert.equal(sent.resendType, "signup", "resend asks for the sign-up confirmation email");
    for (const address of [sent.signUp, sent.resend, sent.reset]) assert.ok(new URL(address).search.length > 1, `${address} has a query string`);
  });

  it("the address always has a query string, whatever `next` is: the template appends '&token_hash=' to it", () => {
    for (const next of [undefined, "", "/account", "/auth/reset-password", "/account/orders"]) {
      const address = siteUrl.confirmUrl(ORIGIN, next);
      assert.ok(address.includes("?"), `confirmUrl(${JSON.stringify(next)}) = ${address}`);
      assert.equal(new URL(address).pathname, "/auth/confirm");
    }
    assert.equal(siteUrl.confirmUrl(ORIGIN), `${ORIGIN}/auth/confirm?next=%2Faccount`);
  });

  it("the address cannot be pointed at another site: a hostile Host / forwarded host is ignored when the site address is configured, and nothing is sent when it is not", async () => {
    const hostile = { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" };
    enable();
    const configured = await redirectsSent(hostile);
    for (const address of [configured.signUp, configured.resend, configured.reset]) assert.equal(new URL(address).origin, ORIGIN, address);

    enable({ siteUrl: null });
    const unconfigured = await redirectsSent(hostile);
    assert.equal(unconfigured.signUp, undefined, "no address is sent for a remote host: the service falls back to its own Site URL");
    assert.equal(unconfigured.resend, undefined);
    assert.equal(unconfigured.reset, undefined);
  });

  it("local development (a localhost address, no configuration) still gets a working address", async () => {
    enable({ siteUrl: null });
    const sent = await redirectsSent({ host: "localhost:3000" });
    assert.equal(sent.signUp, "http://localhost:3000/auth/confirm?next=%2Faccount");
    assert.equal(sent.reset, "http://localhost:3000/auth/confirm?next=%2Fauth%2Freset-password");
  });
});

describe("the repository's email templates, filled in with the addresses the app really sends", () => {
  it("the confirmation template depends on '{{ .RedirectTo }}&token_hash=': it needs an address that already has a query string", () => {
    const href = read(TEMPLATE.confirmation).match(/href="([^"]+)"/)[1];
    assert.equal(href, "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email");
    assert.equal(read(TEMPLATE.recovery).match(/href="([^"]+)"/)[1], "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery");
  });

  it("SIGN-UP: the confirmation email's link is /auth/confirm with token_hash, type=email and the page to return to", async () => {
    enable();
    const { signUp } = await redirectsSent();
    assertWorkingLink(linkOf("confirmation", signUp), { type: "email", next: "/account" });
  });

  it("RESEND: the second confirmation email's link is just as valid", async () => {
    enable();
    const { resend } = await redirectsSent();
    assertWorkingLink(linkOf("confirmation", resend, "a-second-hash"), { type: "email", next: "/account", hash: "a-second-hash" });
  });

  it("PASSWORD RECOVERY: the recovery email's link is /auth/confirm with token_hash, type=recovery and the new-password page", async () => {
    enable();
    const { reset } = await redirectsSent();
    assertWorkingLink(linkOf("recovery", reset), { type: "recovery", next: "/auth/reset-password" });
  });

  it("the HTML-escaped form of the same link (&amp; between the parameters, as a mail client shows it) opens the same address", async () => {
    enable();
    const { signUp } = await redirectsSent();
    const html = renderTemplate(read(TEMPLATE.confirmation), { RedirectTo: signUp, TokenHash: HASH, SiteURL: ORIGIN }).replace(/&(?!amp;)/g, "&amp;");
    assertWorkingLink(decodeEntities(html.match(/href="([^"]+)"/)[1]), { type: "email", next: "/account" });
  });

  it("each type a template puts in its link is a type the confirmation route accepts, and a sign-in (magic) link type is not one of them", () => {
    const accepted = allowedTypes();
    for (const key of ["confirmation", "recovery"]) {
      const type = new URL(linkOf(key, siteUrl.confirmUrl(ORIGIN))).searchParams.get("type");
      assert.ok(accepted.includes(type), `${key} template: type=${type} must be accepted (${accepted})`);
    }
    assert.ok(!accepted.includes("magiclink"));
  });

  it("THE ORIGINAL BUG IS CAUGHT: an address with no query string (what 2cd3424 sent) turns the template into '/auth/confirm&token_hash=...', and this check refuses it", () => {
    const malformed = linkOf("confirmation", new URL("/auth/confirm", ORIGIN).toString());
    assert.equal(malformed, `${ORIGIN}/auth/confirm&token_hash=${HASH}&type=email`);
    assert.equal(new URL(malformed).pathname, `/auth/confirm&token_hash=${HASH}&type=email`, "the path is a page that does not exist");
    assert.equal(new URL(malformed).searchParams.get("token_hash"), null);
    assert.throws(() => assertWorkingLink(malformed, { type: "email", next: "/account" }), assert.AssertionError);
  });

  it("the sign-in-link template carries no link and no token (a sign-in link the service sends is empty)", () => {
    const html = renderTemplate(read(TEMPLATE.magic_link), {});
    assert.doesNotMatch(html, /<a\b|href|token/i);
  });

  it("DEFAULT SUPABASE TEMPLATE ({{ .ConfirmationURL }}): the service verifies the token itself and comes back to the same address with ?code=, which the route accepts", async () => {
    enable();
    const { signUp } = await redirectsSent();
    // The default template links to the service's verify address, which carries the site's address as redirect_to ...
    const confirmationUrl = `${PROJECT}/auth/v1/verify?token=abcdef&type=signup&redirect_to=${encodeURIComponent(signUp)}`;
    const redirectTo = new URL(confirmationUrl).searchParams.get("redirect_to");
    assert.equal(redirectTo, signUp, "the service gets the address back exactly as the site sent it");
    // ... and, once the token is verified (PKCE), sends the browser there with a code added to the query string.
    const back = new URL(redirectTo);
    back.searchParams.set("code", "a-pkce-code");
    assert.equal(back.pathname, "/auth/confirm");
    assert.equal(back.searchParams.get("code"), "a-pkce-code");
    assert.equal(back.searchParams.get("next"), "/account", "the page to return to survives");
    const calls = [];
    install({ supabase: fakeSupabase(calls), staff: { state: "not_staff" } });
    process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
    const to = await confirmRoute(back.toString());
    assert.equal(to, "/auth/continue");
    assert.deepEqual(calls.map((c) => c.call), ["exchangeCodeForSession"]);
  });
});

/** Runs the real confirmation route for an address and returns where it sent the visitor. */
async function confirmRoute(link) {
  try {
    const response = await route.GET({ nextUrl: new URL(link) });
    throw new Error(`the route did not redirect (it answered ${response?.status})`);
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) return error.url;
    throw error;
  }
}
async function visitContinue(staff) {
  install({ pathname: "/auth/continue", staff });
  try {
    await continuePage({ searchParams: Promise.resolve({}) });
    return null;
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) return error.url;
    throw error;
  }
}

describe("completing the email: the destination is decided by verified staff membership, not by the link", () => {
  const link = async () => {
    enable();
    return linkOf("confirmation", (await redirectsSent()).signUp);
  };

  it("a confirmed sign-up link verifies the token (type email) and hands the visitor to the sign-in router, with no page requested", async () => {
    const address = await link();
    const calls = [];
    install({ supabase: fakeSupabase(calls) });
    process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
    assert.equal(await confirmRoute(address), "/auth/continue");
    assert.deepEqual(calls, [{ call: "verifyOtp", args: { type: "email", token_hash: HASH } }]);
  });

  it("then the router sends authorized staff by their verified membership (the dashboard, or the second step first), and a customer to their account", async () => {
    const address = await link();
    process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
    install({ supabase: fakeSupabase([]) });
    assert.equal(await confirmRoute(address), "/auth/continue");
    assert.equal(await visitContinue({ state: "ok" }), "/admin", "verified staff with the second step done");
    assert.equal(await visitContinue({ state: "needs_mfa" }), "/admin/mfa", "verified staff who still need the second step");
    assert.equal(await visitContinue({ state: "not_staff" }), "/account", "a customer");
    assert.equal(await visitContinue({ state: "disabled" }), "/account", "no staff area in this environment");
    assert.equal(await visitContinue({ state: "unavailable" }), null, "a failed staff check goes nowhere: it is never read as 'customer'");
  });

  it("the default `next=/account` of the link is not a request: it never overrides the staff decision (the router drops it)", () => {
    assert.deepEqual(postAuth.routeAfterSignIn("ok", "/account"), { kind: "go", to: "/admin" });
    assert.deepEqual(postAuth.routeAfterSignIn("needs_mfa", "/account"), { kind: "go", to: "/admin/mfa" });
    assert.deepEqual(postAuth.routeAfterSignIn("not_staff", "/account"), { kind: "go", to: "/account" });
    assert.equal(postAuth.continueUrl("/account"), "/auth/continue");
  });

  it("a recovery link verifies as recovery and always ends at the new-password page, whatever `next` says", async () => {
    enable();
    const { reset } = await redirectsSent();
    const calls = [];
    install({ supabase: fakeSupabase(calls) });
    process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
    assert.equal(await confirmRoute(linkOf("recovery", reset)), "/auth/reset-password");
    assert.equal(await confirmRoute(linkOf("recovery", siteUrl.confirmUrl(ORIGIN, "/account"))), "/auth/reset-password");
    assert.deepEqual(calls.map((c) => c.args.type), ["recovery", "recovery"]);
  });

  it("a link the service does not accept (used, expired, wrong) ends at the one error page and creates nothing", async () => {
    const address = await link();
    install({ supabase: fakeSupabase([], { verifyError: { code: "otp_expired" } }) });
    process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
    assert.equal(await confirmRoute(address), "/auth/error?reason=link");
  });

  it("a sign-in (magic) link, and any type the site does not send, is refused WITHOUT asking the Auth service", async () => {
    for (const type of ["magiclink", "invite", "email_change", "sms", "reauthentication", ""]) {
      const calls = [];
      install({ supabase: fakeSupabase(calls) });
      process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
      assert.equal(await confirmRoute(`${ORIGIN}/auth/confirm?next=%2Faccount&token_hash=${HASH}&type=${type}`), "/auth/error?reason=link", `type=${type}`);
      assert.deepEqual(calls, [], `type=${type} must not reach the Auth service`);
    }
  });

  it("a `next` that points to another site is never followed, in a link that otherwise verifies", async () => {
    const hostile = ["//evil.example", "https://evil.example/steal", "/\\evil.example", "%2F%2Fevil.example", "/account/../../evil.example", "javascript:alert(1)", "/admin//evil.example"];
    for (const next of hostile) {
      for (const type of ["email", "signup"]) {
        install({ supabase: fakeSupabase([]) });
        process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
        const to = await confirmRoute(`${ORIGIN}/auth/confirm?next=${encodeURIComponent(next)}&token_hash=${HASH}&type=${type}`);
        assert.ok(to.startsWith("/auth/continue") || to === "/auth/error?reason=link", `next=${next}: went to ${to}`);
        // Whatever the route chose stays on THIS site: it is a path (never "//host" or "scheme:"), and resolved against the site it keeps the site's origin.
        assert.match(to, /^\/[^/\\]/, `next=${next}: went to ${to}`);
        assert.equal(new URL(to, ORIGIN).origin, ORIGIN, `next=${next}: went to ${to}`);
        assert.doesNotMatch(decodeURIComponent(to).split("?")[0], /javascript:|evil/i, `next=${next}: the path itself is the router's: ${to}`);
      }
    }
  });

  it("the confirmation route is absent while the account switch is off", async () => {
    install({ supabase: fakeSupabase([]) });
    delete process.env.CUSTOMER_ACCOUNTS_ENABLED;
    const response = await route.GET({ nextUrl: new URL(`${ORIGIN}/auth/confirm?token_hash=${HASH}&type=email`) });
    assert.equal(response.status, 404);
  });
});
