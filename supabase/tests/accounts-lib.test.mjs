// Unit tests for the customer-account logic that needs no server, no database and no network: the feature flag, the
// redirect sanitiser, validation, error mapping, cookie hardening, the email-link address and the dashboard view models.
// These are LOCAL tests with plain inputs. They say nothing about a real Supabase project.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, test } from "node:test";

register("./support/alias-loader.mjs", import.meta.url);

let load = null;
let skip = false;
try {
  load = {
    flag: await import("../../src/lib/accounts/shared/flag.ts"),
    redirect: await import("../../src/lib/accounts/shared/redirect.ts"),
    claim: await import("../../src/lib/accounts/shared/claim-code.ts"),
    validation: await import("../../src/lib/accounts/shared/validation.ts"),
    errors: await import("../../src/lib/accounts/shared/auth-errors.ts"),
    cookies: await import("../../src/lib/accounts/shared/cookies.ts"),
    siteUrl: await import("../../src/lib/accounts/shared/site-url.ts"),
    views: await import("../../src/lib/accounts/shared/view-models.ts"),
  };
} catch (error) {
  // CI (M1_REQUIRE_PG=1) must FAIL on any import error: a real defect in the website code must never turn into a green skip.
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { flag, redirect, claim, validation, errors, cookies, siteUrl, views } = load ?? {};

const form = (fields) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("the feature flag", { skip }, () => {
  test("is off unless it is exactly the text true", () => {
    for (const env of [{}, { CUSTOMER_ACCOUNTS_ENABLED: "" }, { CUSTOMER_ACCOUNTS_ENABLED: "false" }, { CUSTOMER_ACCOUNTS_ENABLED: "TRUE" }, { CUSTOMER_ACCOUNTS_ENABLED: "1" }, { CUSTOMER_ACCOUNTS_ENABLED: "yes" }, { CUSTOMER_ACCOUNTS_ENABLED: " true" }]) {
      assert.equal(flag.isCustomerAccountsEnabled(env), false, JSON.stringify(env));
      assert.equal(flag.customerAccountsGate(env).reason, "flag_off");
    }
  });

  test("turns on locally and on preview deployments", () => {
    assert.equal(flag.isCustomerAccountsEnabled({ CUSTOMER_ACCOUNTS_ENABLED: "true" }), true);
    assert.equal(flag.isCustomerAccountsEnabled({ CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "preview" }), true);
    assert.equal(flag.isCustomerAccountsEnabled({ CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "development" }), true);
  });

  test("can never be turned on in a production deployment, whatever its value", () => {
    const gate = flag.customerAccountsGate({ CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "production" });
    assert.deepEqual(gate, { enabled: false, reason: "blocked_in_production" });
    assert.equal(flag.isCustomerAccountsEnabled({ CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "production", NODE_ENV: "development" }), false);
  });
});

describe("the redirect sanitiser (no open redirect)", { skip }, () => {
  test("keeps a path inside /account", () => {
    assert.equal(redirect.safeAccountPath("/account"), "/account");
    assert.equal(redirect.safeAccountPath("/account/orders"), "/account/orders");
    assert.equal(redirect.safeAccountPath("/account/orders/O-2611-00042"), "/account/orders/O-2611-00042");
  });

  test("drops the query string and the fragment: only the path is ever followed", () => {
    assert.equal(redirect.safeAccountPath("/account/orders?next=https://evil.example"), "/account/orders");
    assert.equal(redirect.safeAccountPath("/account#frag"), "/account");
  });

  test("refuses every address that leaves the site or the account area", () => {
    const hostile = [
      "https://evil.example",
      "http://evil.example/account",
      "//evil.example",
      "//evil.example/account",
      "/\\evil.example",
      "\\\\evil.example",
      "/account@evil.example.test",
      "/account.evil.example",
      "/accountant",
      "/",
      "/policies",
      "/account/../policies",
      "/account/%2e%2e/policies",
      "/account%2f..%2fpolicies",
      "/account%5c..",
      "javascript:alert(1)",
      "data:text/html,x",
      "/account\n/evil",
      "/account\r\nLocation: https://evil.example",
      "/account\u0000",
      " /account",
      "account",
      "",
      "/account/" + "a".repeat(250),
    ];
    for (const input of hostile) assert.equal(redirect.safeAccountPath(input), "/account", JSON.stringify(input).slice(0, 60));
  });

  test("refuses anything that is not text", () => {
    for (const input of [null, undefined, 5, {}, ["/account/orders"], true]) assert.equal(redirect.safeAccountPath(input), "/account");
  });

  test("uses the fallback it is given", () => {
    assert.equal(redirect.safeAccountPath("https://evil.example", "/account/orders"), "/account/orders");
  });

  test("safeNextPath keeps a customer or an admin path and nothing else", () => {
    assert.equal(redirect.safeNextPath("/account/orders"), "/account/orders");
    assert.equal(redirect.safeNextPath("/admin"), "/admin");
    assert.equal(redirect.safeNextPath("/admin/orders/9b2c3b0e-0d3e-4b1a-9a53-5c1f4f0f3a11?x=1"), "/admin/orders/9b2c3b0e-0d3e-4b1a-9a53-5c1f4f0f3a11");
    const hostile = ["https://evil.example/admin", "//evil.example/admin", "/administrator", "/admin@evil.example.test", "/admin/../policies", "/admin%2f..", "/admin\\..", "/admin\n/x", "/policies", "/", "", "admin"];
    for (const input of hostile) assert.equal(redirect.safeNextPath(input), "/account", JSON.stringify(input));
    for (const input of [null, undefined, 3, {}, ["/admin"]]) assert.equal(redirect.safeNextPath(input), "/account");
    assert.equal(redirect.safeNextPath("https://evil.example", "/admin"), "/admin");
  });

  test("safeAccountPath still refuses the admin area", () => {
    assert.equal(redirect.safeAccountPath("/admin"), "/account");
  });

  test("the sign-in address can lead back into the admin area, and only there", () => {
    assert.equal(redirect.signInUrl("required", "/admin/orders"), "/auth/sign-in?reason=required&next=%2Fadmin%2Forders");
    assert.equal(redirect.signInUrl("required", "//evil.example/admin"), "/auth/sign-in?reason=required&next=%2Faccount");
  });

  test("the sign-in address carries only a safe next path and a known reason", () => {
    assert.equal(redirect.signInUrl("expired", "/account/orders"), "/auth/sign-in?reason=expired&next=%2Faccount%2Forders");
    assert.equal(redirect.signInUrl("required", "https://evil.example"), "/auth/sign-in?reason=required&next=%2Faccount");
    assert.equal(redirect.signInUrl("signed_out"), "/auth/sign-in?reason=signed_out");
  });
});

describe("claim codes", { skip }, () => {
  test("a code is normalised from the way people type it", () => {
    assert.equal(claim.normalizeClaimCode("abcde-12345-fghij-67890"), "ABCDE12345FGHIJ67890");
    assert.equal(claim.normalizeClaimCode("  ABCDE 12345 FGHIJ 67890 "), "ABCDE12345FGHIJ67890");
    assert.equal(claim.normalizeClaimCode("ABCDE12345FGHIJ67890"), "ABCDE12345FGHIJ67890");
  });

  test("input is capped before it is processed: a valid code buried in padding is refused, not trimmed", () => {
    const code = "ABCDE-12345-FGHIJ-67890";
    assert.equal(claim.normalizeClaimCode(" ".repeat(64 - code.length) + code), "ABCDE12345FGHIJ67890", "exactly at the cap");
    assert.equal(claim.normalizeClaimCode(" ".repeat(65 - code.length) + code), null, "one over the cap");
    assert.equal(claim.normalizeClaimCode(" ".repeat(5000) + code), null);
  });

  test("anything that is not exactly 20 letters and digits is refused", () => {
    for (const input of ["", "short", "ABCDE-12345-FGHIJ-6789", "ABCDE-12345-FGHIJ-678901", "ABCDE-12345-FGHIJ-6789!", "ÄBCDE-12345-FGHIJ-67890", "A".repeat(65), null, undefined, 12345678901234567890]) {
      assert.equal(claim.normalizeClaimCode(input), null, String(input).slice(0, 30));
    }
  });

  test("the grouped form reads back as people write it", () => {
    assert.equal(claim.groupClaimCode("ABCDE12345FGHIJ67890"), "ABCDE-12345-FGHIJ-67890");
  });

  test("the failure message is one fixed sentence that names nothing", () => {
    assert.match(claim.CLAIM_FAILED_MESSAGE, /did not work/);
    assert.doesNotMatch(claim.CLAIM_FAILED_MESSAGE, /expired|used|exist|customer|wrong|invalid|attempt|limit/i);
  });
});

describe("form validation", { skip }, () => {
  test("sign-up needs a valid email and a long enough password", () => {
    assert.equal(validation.parseSignUp(form({ email: "a@example.test", password: "correct horse battery" })).ok, true);
    const bad = validation.parseSignUp(form({ email: "not-an-email", password: "short" }));
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.email && bad.errors.password);
  });

  test("the email is trimmed and lower-cased", () => {
    const parsed = validation.parseSignUp(form({ email: "  Alice@Example.TEST ", password: "correct horse battery" }));
    assert.equal(parsed.value.email, "alice@example.test");
  });

  test("a password may not be the email address or longer than the service can hash", () => {
    assert.ok(validation.parseSignUp(form({ email: "someone@example.test", password: "someone@example.test" })).errors.password);
    assert.ok(validation.parseSignUp(form({ email: "a@example.test", password: "x".repeat(73) })).errors.password);
    assert.ok(validation.parseSignUp(form({ email: "a@example.test", password: "é".repeat(37) })).errors.password, "72 bytes, not 72 characters");
    assert.equal(validation.parseSignUp(form({ email: "a@example.test", password: "x".repeat(72) })).ok, true);
  });

  test("the password minimum is exactly ten characters: nine is refused, ten is accepted", () => {
    assert.equal(validation.PASSWORD_MIN_LENGTH, 10);
    assert.ok(validation.parseSignUp(form({ email: "a@example.test", password: "abcdefghi" })).errors.password, "nine characters");
    assert.equal(validation.parseSignUp(form({ email: "a@example.test", password: "abcdefghij" })).ok, true, "ten characters");
  });

  test("an email longer than 254 characters or with no domain is refused", () => {
    for (const email of [`${"a".repeat(250)}@x.test`, "a@b", "a b@example.test", "@example.test", "a@@example.test", ""]) {
      assert.equal(validation.parseEmail(email), null, email.slice(0, 30));
    }
  });

  test("sign-in does not enforce a password policy, only that one was entered", () => {
    assert.equal(validation.parseSignIn(form({ email: "a@example.test", password: "x" })).ok, true);
    assert.ok(validation.parseSignIn(form({ email: "a@example.test", password: "" })).errors.password);
    assert.ok(validation.parseSignIn(form({ email: "a@example.test", password: "x".repeat(2000) })).errors.password);
  });

  test("a profile accepts a database-compatible phone and refuses the rest", () => {
    const ok = validation.parseProfile(form({ full_name: "Alice Test", phone: "+974 5555 0001", preferred_language: "en" }));
    assert.equal(ok.ok, true);
    assert.equal(ok.value.phone, "+974 5555 0001");
    for (const phone of ["abc", "12", "+974555500011111111111111111", "5555 0001; drop table"]) {
      assert.ok(validation.parseProfile(form({ full_name: "A", phone, preferred_language: "en" })).errors.phone, phone);
    }
    assert.equal(validation.parseProfile(form({ full_name: "A", phone: "", preferred_language: "ar" })).value.phone, null);
  });

  test("a profile refuses an empty or oversized name, an unknown language and a long address", () => {
    assert.ok(validation.parseProfile(form({ full_name: "  ", preferred_language: "en" })).errors.full_name);
    assert.ok(validation.parseProfile(form({ full_name: "x".repeat(121), preferred_language: "en" })).errors.full_name);
    assert.ok(validation.parseProfile(form({ full_name: "A", preferred_language: "fr" })).errors.preferred_language);
    assert.ok(validation.parseProfile(form({ full_name: "A", preferred_language: "en", delivery_address: "x".repeat(501) })).errors.delivery_address);
  });

  test("a profile has no customer id or email field that a person could fill in", () => {
    const parsed = validation.parseProfile(form({ full_name: "A", preferred_language: "en", customer_id: "someone-elses", id: "x", email: "forged@example.test" }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(Object.keys(parsed.value).sort(), ["delivery_address", "full_name", "marketing_consent", "phone", "preferred_language"]);
  });

  test("an error message never repeats what was typed", () => {
    const secret = "Hunter2-sentinel-value";
    const results = [
      validation.parseSignUp(form({ email: secret, password: secret })),
      validation.parseSignIn(form({ email: secret, password: "" })),
      validation.parseProfile(form({ full_name: "", phone: secret, preferred_language: secret })),
    ];
    for (const result of results) assert.ok(!JSON.stringify(result).includes(secret));
  });
});

describe("password recovery inputs", { skip }, () => {
  test("a new password follows the sign-up rules and must be typed twice the same", () => {
    const ok = validation.parseNewPassword(form({ password: "A-long-synthetic-passphrase-1", confirm: "A-long-synthetic-passphrase-1" }));
    assert.equal(ok.ok, true);
    assert.ok(validation.parseNewPassword(form({ password: "short", confirm: "short" })).errors.password);
    assert.ok(validation.parseNewPassword(form({ password: "A-long-synthetic-passphrase-1", confirm: "A-long-synthetic-passphrase-2" })).errors.confirm);
    assert.ok(validation.parseNewPassword(form({ password: "x".repeat(73), confirm: "x".repeat(73) })).errors.password);
    assert.equal(validation.parseNewPassword(form({})).ok, false);
  });
  test("the service's same-password error has its own fixed message", () => {
    assert.equal(errors.classifyAuthError({ code: "same_password", status: 422 }), "same_password");
    assert.match(errors.authFailureMessage("same_password"), /different password/);
  });
  test("an expired reset link has a notice and a sign-in address", () => {
    assert.match(errors.signInNotice("reset_link"), /reset link/);
    assert.equal(redirect.signInUrl("reset_link"), "/auth/sign-in?reason=reset_link");
  });
});

describe("auth error mapping (no enumeration, no raw text)", { skip }, () => {
  const classify = (code, status = 400, name = "AuthApiError") => errors.classifyAuthError({ code, status, name });

  test("each known error maps to one fixed class", () => {
    assert.equal(classify("invalid_credentials"), "invalid_credentials");
    assert.equal(classify("email_not_confirmed"), "email_not_confirmed");
    assert.equal(classify("over_email_send_rate_limit", 429), "rate_limited");
    assert.equal(classify("anything", 429), "rate_limited");
    assert.equal(classify("weak_password"), "weak_password");
    assert.equal(classify("signup_disabled"), "signups_closed");
    assert.equal(classify("bad_jwt", 401), "session_expired");
    assert.equal(classify("refresh_token_not_found", 400), "session_expired");
    assert.equal(classify(undefined, 401), "session_expired");
    assert.equal(errors.classifyAuthError({ name: "AuthSessionMissingError", status: 400 }), "session_expired");
  });

  test("a service outage is not mistaken for an expired session", () => {
    assert.equal(errors.classifyAuthError({ name: "AuthRetryableFetchError", status: 0 }), "unavailable");
    assert.equal(classify("unexpected_failure", 503), "unavailable");
    assert.equal(classify("unexpected_failure", 500), "unavailable");
  });

  test("unknown and missing errors fall back to a vague class", () => {
    assert.equal(classify("something_new"), "unknown");
    assert.equal(errors.classifyAuthError(null), "unknown");
    assert.equal(errors.classifyAuthError(undefined), "unknown");
  });

  test("a wrong password and a missing user are told apart by nothing", () => {
    // The service returns invalid_credentials for both, and this layer adds no distinction.
    assert.equal(errors.authFailureMessage(classify("invalid_credentials")), "The email or password is not correct.");
    assert.equal(errors.authFailureMessage(classify("user_not_found", 400)), errors.authFailureMessage("session_expired"));
  });

  test("every message is fixed text without markup, addresses or codes", () => {
    for (const failure of ["invalid_credentials", "email_not_confirmed", "rate_limited", "weak_password", "signups_closed", "session_expired", "unavailable", "unknown"]) {
      const message = errors.authFailureMessage(failure);
      assert.ok(message.length > 10 && message.length < 140, failure);
      assert.doesNotMatch(message, /[<>@{}]|AuthApiError|supabase|gotrue|jwt|postgres/i, message);
    }
  });

  test("the sign-in notice knows four reasons and ignores everything else", () => {
    for (const reason of ["expired", "required", "signed_out", "confirmed"]) assert.ok(errors.signInNotice(reason));
    for (const reason of ["<script>", "admin", undefined, 3, ["expired"]]) assert.equal(errors.signInNotice(reason), null);
  });
});

describe("session cookie hardening", { skip }, () => {
  test("the library's browser-oriented defaults are replaced by HttpOnly, SameSite=Lax and a bounded lifetime", () => {
    const hardened = cookies.hardenCookieOptions({ path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60 }, true);
    assert.equal(hardened.httpOnly, true);
    assert.equal(hardened.secure, true);
    assert.equal(hardened.sameSite, "lax");
    assert.equal(hardened.path, "/");
    assert.equal(hardened.maxAge, cookies.MAX_SESSION_COOKIE_SECONDS);
  });

  test("whatever the library asks for, HttpOnly and Lax win", () => {
    const hardened = cookies.hardenCookieOptions({ httpOnly: false, sameSite: "none", secure: false, path: "/elsewhere" }, true);
    assert.equal(hardened.httpOnly, true);
    assert.equal(hardened.sameSite, "lax");
    assert.equal(hardened.secure, true);
    assert.equal(hardened.path, "/");
  });

  test("a cookie is never widened to a parent domain", () => {
    assert.equal("domain" in cookies.hardenCookieOptions({ domain: ".monepcs.qa" }, true), false);
  });

  test("a shorter lifetime is kept, a longer one is capped, a missing one gets the cap", () => {
    assert.equal(cookies.hardenCookieOptions({ maxAge: 3600 }, true).maxAge, 3600);
    assert.equal(cookies.hardenCookieOptions({ maxAge: 10 ** 9 }, true).maxAge, cookies.MAX_SESSION_COOKIE_SECONDS);
    assert.equal(cookies.hardenCookieOptions({}, true).maxAge, cookies.MAX_SESSION_COOKIE_SECONDS);
    assert.equal(cookies.hardenCookieOptions(undefined, false).maxAge, cookies.MAX_SESSION_COOKIE_SECONDS);
  });

  test("signing out still clears the cookie: a deletion keeps Max-Age 0", () => {
    assert.equal(cookies.hardenCookieOptions({ maxAge: 0 }, true).maxAge, 0);
    assert.equal(cookies.hardenCookieOptions({ expires: new Date(0) }, true).maxAge, 0);
    assert.equal(cookies.hardenCookieOptions({ maxAge: 0 }, true).httpOnly, true);
  });

  test("Secure follows the request: HTTPS and proxies on, plain localhost off", () => {
    const headers = (map) => ({ get: (name) => map[name] ?? null });
    assert.equal(cookies.isSecureRequest(headers({ "x-forwarded-proto": "https" })), true);
    assert.equal(cookies.isSecureRequest(headers({ "x-forwarded-proto": "https,http" })), true);
    assert.equal(cookies.isSecureRequest(headers({ "x-forwarded-proto": "http", host: "monepcs.qa" })), false);
    assert.equal(cookies.isSecureRequest(headers({ host: "localhost:3000" })), false);
    assert.equal(cookies.isSecureRequest(headers({ host: "127.0.0.1:3101" })), false);
    assert.equal(cookies.isSecureRequest(headers({ host: "monepcs.qa" })), true, "an unknown public host errs on the side of Secure");
    assert.equal(cookies.isSecureRequest(headers({})), true);
  });
});

describe("the address that email links point back to", { skip }, () => {
  test("comes from configuration", () => {
    assert.equal(siteUrl.resolveSiteOrigin({ CUSTOMER_ACCOUNTS_SITE_URL: "https://preview.example.test/some/path" }, "evil.example", "https"), "https://preview.example.test");
  });

  test("a request header is trusted only for a local address", () => {
    assert.equal(siteUrl.resolveSiteOrigin({}, "localhost:3111", "http"), "http://localhost:3111");
    assert.equal(siteUrl.resolveSiteOrigin({}, "127.0.0.1:3111", null), "http://127.0.0.1:3111");
    assert.equal(siteUrl.resolveSiteOrigin({}, "evil.example", "https"), null);
    assert.equal(siteUrl.resolveSiteOrigin({}, "localhost.evil.example", "https"), null);
    assert.equal(siteUrl.resolveSiteOrigin({}, null, null), null);
  });

  test("a configured value must be https (or plain localhost) and carry no credentials", () => {
    for (const value of ["http://preview.example.test", "ftp://x.test", "https://user:pw@preview.example.test", "not a url", ""]) {
      assert.equal(siteUrl.resolveSiteOrigin({ CUSTOMER_ACCOUNTS_SITE_URL: value }, null, null), null, value);
    }
    assert.equal(siteUrl.resolveSiteOrigin({ CUSTOMER_ACCOUNTS_SITE_URL: "http://localhost:3000" }, null, null), "http://localhost:3000");
  });

  test("the confirmation address carries the next path", () => {
    assert.equal(siteUrl.confirmUrl("https://preview.example.test", "/account"), "https://preview.example.test/auth/confirm?next=%2Faccount");
  });

  test("the confirmation address ALWAYS has a query string (the email templates append '&token_hash=' to it), with /account when no page is given", () => {
    for (const next of [undefined, ""]) {
      assert.equal(siteUrl.confirmUrl("https://preview.example.test", next), "https://preview.example.test/auth/confirm?next=%2Faccount");
    }
    assert.equal(siteUrl.confirmUrl("https://preview.example.test", "/auth/reset-password"), "https://preview.example.test/auth/confirm?next=%2Fauth%2Freset-password");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
const STATUSES = [
  { code: "pending_confirmation", sort_order: 10, customer_label: "Order received", customer_description: "We have your order.", is_terminal: false, is_provisional: true },
  { code: "awaiting_deposit", sort_order: 20, customer_label: "Awaiting deposit", customer_description: "We are waiting for the deposit.", is_terminal: false, is_provisional: true },
  { code: "building", sort_order: 60, customer_label: "Building", customer_description: "Your PC is being built.", is_terminal: false, is_provisional: true },
  { code: "delivered", sort_order: 90, customer_label: "Delivered", customer_description: "Delivered.", is_terminal: true, is_provisional: true },
  { code: "on_hold", sort_order: 900, customer_label: "On hold", customer_description: "Paused.", is_terminal: false, is_provisional: true },
  { code: "cancelled", sort_order: 910, customer_label: "Cancelled", customer_description: "Cancelled.", is_terminal: true, is_provisional: true },
];
const order = (overrides = {}) => ({
  id: "o1", order_ref: "O-2611-00001", customer_id: "c1", quotation_id: null, status: "awaiting_deposit", currency: "QAR",
  total_minor: 400000, deposit_required_minor: 200000, amount_paid_minor: 100000, balance_due_minor: 300000,
  delivery_method: null, delivery_address: null, placed_via: "admin", created_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-10T09:00:00Z", ...overrides,
});

describe("dashboard view models", { skip }, () => {
  test("a status carries its customer wording and its place on the normal path", () => {
    const view = views.buildStatusView("building", STATUSES);
    assert.deepEqual([view.label, view.step, view.steps, view.tone], ["Building", 3, 4, "progress"]);
    assert.equal(views.buildStatusView("delivered", STATUSES).tone, "done");
    assert.equal(views.buildStatusView("on_hold", STATUSES).tone, "paused");
    assert.equal(views.buildStatusView("on_hold", STATUSES).step, null);
    assert.equal(views.buildStatusView("cancelled", STATUSES).tone, "cancelled");
  });

  test("an unknown status is shown, not hidden, so a change of vocabulary never blanks the page", () => {
    const view = views.buildStatusView("brand_new_stage", STATUSES);
    assert.equal(view.label, "brand new stage");
    assert.equal(view.step, null);
  });

  test("an order summary shows money from the row's own numbers", () => {
    const summary = views.buildOrderSummary(order(), STATUSES);
    assert.deepEqual([summary.total, summary.depositRequired, summary.paid, summary.balanceDue], ["QAR 4,000.00", "QAR 2,000.00", "QAR 1,000.00", "QAR 3,000.00"]);
    assert.equal(summary.depositOutstanding, "QAR 1,000.00");
    assert.equal(summary.fullyPaid, false);
    assert.equal(summary.href, "/account/orders/O-2611-00001");
  });

  test("no deposit is outstanding once it is paid, and an order is paid in full when nothing is left", () => {
    const paidDeposit = views.buildOrderSummary(order({ amount_paid_minor: 200000, balance_due_minor: 200000 }), STATUSES);
    assert.equal(paidDeposit.depositOutstanding, null);
    const paid = views.buildOrderSummary(order({ amount_paid_minor: 400000, balance_due_minor: 0 }), STATUSES);
    assert.equal(paid.fullyPaid, true);
    const unpriced = views.buildOrderSummary(order({ total_minor: 0, deposit_required_minor: 0, amount_paid_minor: 0, balance_due_minor: 0 }), STATUSES);
    assert.equal(unpriced.fullyPaid, false);
    assert.equal(unpriced.depositOutstanding, null);
  });

  test("the timeline is oldest first with only the newest marked, and a missing status label is allowed", () => {
    const events = [
      { id: "e2", order_id: "o1", status_code: null, title: "Parts ordered", message: "Ordered today.", published_at: "2026-11-12T10:00:00Z" },
      { id: "e1", order_id: "o1", status_code: "awaiting_deposit", title: "Order confirmed", message: null, published_at: "2026-11-10T10:00:00Z" },
    ];
    const timeline = views.buildTimeline(events, STATUSES);
    assert.deepEqual(timeline.map((entry) => entry.id), ["e1", "e2"]);
    assert.deepEqual(timeline.map((entry) => entry.isLatest), [false, true]);
    assert.equal(timeline[0].statusLabel, "Awaiting deposit");
    assert.equal(timeline[1].statusLabel, null);
    assert.match(timeline[0].when, /Qatar time/);
    assert.deepEqual(views.buildTimeline([], STATUSES), []);
  });

  test("updates published at the same instant follow the order of their stages, whatever order they arrive in", () => {
    const at = "2026-11-10T10:00:00Z";
    const [first, second] = STATUSES; // the database's own order: the first stage comes before the second
    const make = (id, status_code) => ({ id, order_id: "o1", status_code, title: id, message: null, published_at: at });
    // The ids run the opposite way to the stages, so only a stage-aware sort can produce the expected order.
    const events = [make("a-note", null), make("m-second", second.code), make("z-first", first.code)];
    const expected = ["z-first", "m-second", "a-note"];
    assert.deepEqual(views.buildTimeline(events, STATUSES).map((entry) => entry.id), expected);
    // Reversing what arrives changes nothing: the order is decided by the data, not by arrival.
    assert.deepEqual(views.buildTimeline([...events].reverse(), STATUSES).map((entry) => entry.id), expected);
    // Two updates with no stage and the same instant are settled by id, so the result is still the same every time.
    const notes = [make("n2", null), make("n1", null)];
    assert.deepEqual(views.buildTimeline(notes, STATUSES).map((entry) => entry.id), ["n1", "n2"]);
  });

  test("payments are listed in date order and a reversal is shown as reducing what was paid", () => {
    const list = views.buildPayments([
      { id: "p2", order_id: "o1", entry_type: "reversal", purpose: "deposit", amount_minor: -50000, currency: "QAR", method: "cash", receipt_number: null, received_at: "2026-11-12T10:00:00Z", reverses_payment_id: "p1", created_at: "2026-11-12T10:00:00Z" },
      { id: "p1", order_id: "o1", entry_type: "payment", purpose: "deposit", amount_minor: 100000, currency: "QAR", method: "bank_transfer", receipt_number: "RCPT-1", received_at: "2026-11-10T10:00:00Z", reverses_payment_id: null, created_at: "2026-11-10T10:00:00Z" },
    ]);
    assert.deepEqual(list.map((p) => p.id), ["p1", "p2"]);
    assert.equal(list[0].amount, "QAR 1,000.00");
    assert.equal(list[1].amount, "-QAR 500.00");
    assert.deepEqual([list[0].reducesPaid, list[1].reducesPaid], [false, true]);
    assert.equal(list[0].receipt, "RCPT-1");
    assert.equal(list[0].method, "Bank transfer");
  });

  test("REGRESSION (DEFECT-1): a Fawran payment is shown as Fawran, and every method the database accepts has a label of its own", () => {
    const row = (method) => ({ id: `p-${method}`, order_id: "o1", entry_type: "payment", purpose: "deposit", amount_minor: 58764, currency: "QAR", method, receipt_number: "R-2611-00002", received_at: "2026-11-10T10:00:00Z", reverses_payment_id: null, created_at: "2026-11-10T10:00:00Z" });
    assert.equal(views.buildPayments([row("fawran")])[0].method, "Fawran");
    // Read the accepted methods from the typed list, so a method added to the database without a label here fails this test.
    const typed = readFileSync(new URL("../../src/lib/platform/database.types.ts", import.meta.url), "utf8").match(/export type PaymentMethod = ([^;]+);/);
    assert.ok(typed, "the typed list of payment methods was found");
    const methods = [...typed[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(methods.includes("fawran") && methods.includes("cash"));
    for (const method of methods.filter((m) => m !== "other")) assert.notEqual(views.buildPayments([row(method)])[0].method, "Other method", `${method} must not be shown as "Other method"`);
    assert.equal(views.buildPayments([row("something_new")])[0].method, "Other method", "an unknown method still falls back safely");
  });

  test("the ledger check agrees with the order only when the entries add up", () => {
    const payments = [{ amount_minor: 100000 }, { amount_minor: -20000 }];
    assert.equal(views.ledgerMatchesOrder(order({ amount_paid_minor: 80000 }), payments), true);
    assert.equal(views.ledgerMatchesOrder(order({ amount_paid_minor: 100000 }), payments), false);
  });

  test("loyalty shows the database's balance and a running balance in date order, newest first", () => {
    const ledger = [
      { id: "l2", customer_id: "c1", order_id: null, entry_type: "adjustment", points: -5, reverses_entry_id: null, description: "Correction", created_at: "2026-11-12T00:00:00Z" },
      { id: "l1", customer_id: "c1", order_id: "o1", entry_type: "award", points: 40, reverses_entry_id: null, description: "Points earned on order O-2611-00001", created_at: "2026-11-10T00:00:00Z" },
    ];
    const loyalty = views.buildLoyalty([{ customer_id: "c1", balance_points: 35, entries: 2 }], ledger);
    assert.equal(loyalty.balance, 35, "the balance comes from the database view");
    assert.deepEqual(loyalty.entries.map((e) => [e.id, e.runningBalance, e.pointsText]), [["l2", 35, "-5"], ["l1", 40, "+40"]]);
    assert.deepEqual(views.buildLoyalty([], []), { balance: 0, entryCount: 0, entries: [] });
    // Two linked records: the balances are added up, exactly.
    assert.equal(views.buildLoyalty([{ customer_id: "c1", balance_points: 35, entries: 2 }, { customer_id: "c2", balance_points: 15, entries: 1 }], []).balance, 50);
    assert.equal(views.buildLoyalty([{ customer_id: "c1", balance_points: null, entries: 0 }], []).balance, 0);
  });

  test("the overview leaves a cancelled order's balance out, keeps a delivered one that still owes, and counts open orders", () => {
    const orders = [
      order({ id: "a", order_ref: "O-2611-00001", status: "building", balance_due_minor: 300000, created_at: "2026-11-10T00:00:00Z" }),
      order({ id: "b", order_ref: "O-2611-00002", status: "cancelled", balance_due_minor: 999999, created_at: "2026-11-11T00:00:00Z" }),
      order({ id: "c", order_ref: "O-2611-00003", status: "delivered", balance_due_minor: 50000, created_at: "2026-11-09T00:00:00Z" }),
    ];
    const overview = views.buildOverview({ full_name: "Alice Test" }, orders, STATUSES, [{ customer_id: "c1", balance_points: 12, entries: 1 }]);
    assert.equal(overview.totalBalanceDue, "QAR 3,500.00");
    assert.equal(overview.hasBalanceDue, true);
    assert.equal(overview.orderCount, 3);
    assert.equal(overview.openOrderCount, 1);
    assert.equal(overview.latestOrder.ref, "O-2611-00002");
    assert.equal(overview.greeting, "Welcome back, Alice");
    assert.equal(overview.loyaltyBalance, 12);
  });

  test("a customer with no orders gets zeros and no latest order, not an error", () => {
    const overview = views.buildOverview({ full_name: "  " }, [], STATUSES, []);
    assert.deepEqual([overview.orderCount, overview.openOrderCount, overview.latestOrder, overview.hasBalanceDue, overview.loyaltyBalance, overview.greeting], [0, 0, null, false, 0, "Welcome back"]);
  });

  test("an order reference in an address is accepted only in the real format", () => {
    assert.equal(views.isOrderRef("O-2611-00042"), true);
    for (const value of ["o-2611-00042", "O-2611-0004", "O-2611-000420", "../etc/passwd", "O-2611-00042; select", "", null, undefined, 42]) assert.equal(views.isOrderRef(value), false, String(value));
  });

  test("dates are shown in Qatar time", () => {
    assert.equal(views.formatDate("2026-11-10T22:30:00Z"), "11 Nov 2026");
    assert.match(views.formatDateTime("2026-11-10T22:30:00Z"), /^11 Nov 2026, 01:30 \(Qatar time\)$/);
    assert.equal(views.formatDate("not a date"), "");
  });

  test("the view-model file holds no price, status code, deposit rule or point value of its own", () => {
    // A guard against business rules creeping into display code: they belong in the database.
    return import("node:fs").then(({ readFileSync }) => {
      const source = readFileSync(new URL("../../src/lib/accounts/shared/view-models.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(source, /\b(5000|0\.10|10000)\b|percent_bps|qar_per_point|required_before_status/);
      assert.doesNotMatch(source, /"(pending_confirmation|awaiting_deposit|deposit_received|sourcing|in_transit|building|quality_check|ready_for_delivery|delivered)"/);
    });
  });
});
