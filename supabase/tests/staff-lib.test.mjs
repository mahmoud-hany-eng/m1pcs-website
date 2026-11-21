// Unit tests for the staff (admin) logic that needs no server, no database and no network: the safety switch, the form
// parsing and the deposit-schedule helper. LOCAL tests with plain inputs; they say nothing about a real Supabase project.
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, test } from "node:test";

register("./support/alias-loader.mjs", import.meta.url);

let load = null;
let skip = false;
try {
  load = {
    flag: await import("../../src/lib/staff/flag.ts"),
    v: await import("../../src/lib/staff/validation.ts"),
    state: await import("../../src/lib/staff/form-state.ts"),
    client: await import("../../src/lib/staff/idempotency-client.ts"),
    outcomes: await import("../../src/lib/staff/outcomes.ts"),
    gateway: await import("../../src/lib/staff/gateway.ts"),
    format: await import("../../src/lib/staff/format.ts"),
  };
} catch (error) {
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { flag, v, state, client, outcomes, gateway, format } = load ?? {};

const form = (fields) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("the admin safety switch", { skip }, () => {
  test("is off unless set to exactly true", () => {
    for (const value of [undefined, "", "TRUE", "1", "yes", " true", "true "]) assert.equal(flag.isStaffAdminEnabled({ STAFF_ADMIN_ENABLED: value }), false, String(value));
    assert.equal(flag.isStaffAdminEnabled({ STAFF_ADMIN_ENABLED: "true" }), true);
  });
  test("is ignored on a production deployment", () => {
    assert.deepEqual(flag.staffAdminGate({ STAFF_ADMIN_ENABLED: "true", VERCEL_ENV: "production" }), { enabled: false, reason: "blocked_in_production" });
    assert.equal(flag.isStaffAdminEnabled({ STAFF_ADMIN_ENABLED: "true", VERCEL_ENV: "preview" }), true);
  });
});

describe("what a form hands back after an error", { skip }, () => {
  test("keeps what was typed, and never a code, a password or a confirmation word", () => {
    const echoed = state.echoValues(form({ full_name: "A B", amount: "10", code: "123456", typed_confirmation: "REVERSE", password: "x", confirm: "x" }));
    assert.deepEqual(echoed, { full_name: "A B", amount: "10" });
  });
  test("skips files and very long text", () => {
    const data = new FormData();
    data.set("note", "y".repeat(1001));
    data.set("short", "ok");
    data.set("file", new Blob(["x"]), "x.txt");
    assert.deepEqual(state.echoValues(data), { short: "ok" });
  });
});

describe("the address a form may open next", { skip }, () => {
  test("accepts only internal admin paths", () => {
    assert.equal(state.safeAdminHref("/admin/orders/9b2c3b0e-0d3e-4b1a-9a53-5c1f4f0f3a11"), "/admin/orders/9b2c3b0e-0d3e-4b1a-9a53-5c1f4f0f3a11");
    assert.equal(state.safeAdminHref("/admin"), "/admin");
    for (const bad of ["https://evil.example", "//evil.example", "/administrator", "/admin/../x", "/admin?x=1", "/admin/a/b/c/d", "/account", "", null, 4]) {
      assert.equal(state.safeAdminHref(bad), null, String(bad));
    }
  });
});

describe("customer form parsing", { skip }, () => {
  test("accepts a normal WhatsApp customer", () => {
    const r = v.parseCustomer(form({ full_name: "  Sample Customer ", phone: "+974 5555 0000", email: "", source: "whatsapp", preferred_language: "ar" }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { fullName: "Sample Customer", phone: "+974 5555 0000", email: null, source: "whatsapp", language: "ar", address: null });
  });
  test("refuses a missing name, a bad phone, a bad email and unknown choices, field by field", () => {
    const r = v.parseCustomer(form({ full_name: " ", phone: "abc", email: "no-at", source: "tiktok", preferred_language: "fr" }));
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ["email", "full_name", "phone", "preferred_language", "source"]);
  });
  test("caps lengths", () => {
    assert.equal(v.parseCustomer(form({ full_name: "x".repeat(121) })).ok, false);
    assert.equal(v.parseCustomer(form({ full_name: "x", delivery_address: "y".repeat(501) })).ok, false);
  });
});

const orderForm = (extra = {}) =>
  form({ item_description_0: "Example case", item_quantity_0: "1", item_price_0: "1,250.50", item_kind_0: "component", prices_verified: "yes", ...extra });

describe("order form parsing", { skip }, () => {
  test("turns QAR text into integer minor units and skips unused rows", () => {
    const r = v.parseOrder(orderForm({ item_description_1: "Fan", item_quantity_1: "3", item_price_1: "40", item_kind_1: "component" }), "c1");
    assert.equal(r.ok, true);
    assert.deepEqual(r.value.items, [
      { kind: "component", description: "Example case", quantity: 1, unit_price_minor: 125050 },
      { kind: "component", description: "Fan", quantity: 3, unit_price_minor: 4000 },
    ]);
  });
  test("requires the staff member to confirm the prices were verified", () => {
    const r = v.parseOrder(orderForm({ prices_verified: "no" }), "c1");
    assert.equal(r.ok, false);
    assert.ok(r.errors.prices_verified);
  });
  test("requires at least one item and a total above zero", () => {
    assert.equal(v.parseOrder(form({ prices_verified: "yes" }), "c1").ok, false);
    const zero = v.parseOrder(orderForm({ item_price_0: "0" }), "c1");
    assert.equal(zero.ok, false);
    assert.ok(zero.errors.items);
  });
  test("a negative amount is allowed only for a discount and is stored as negative", () => {
    const bad = v.parseOrder(orderForm({ item_price_0: "-10" }), "c1");
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.item_price_0);
    const ok = v.parseOrder(orderForm({ item_description_1: "Discount", item_price_1: "100", item_kind_1: "discount" }), "c1");
    assert.equal(ok.ok, true);
    assert.equal(ok.value.items[1].unit_price_minor, -10000);
  });
  test("rejects inexact money, floats, exponents and silly quantities", () => {
    for (const price of ["12.345", "1e3", "abc", "1,25", "  ", "0x10"]) {
      const r = v.parseOrder(orderForm({ item_price_0: price }), "c1");
      assert.equal(r.ok, false, price);
    }
    for (const q of ["0", "-1", "1.5", "10000", "abc"]) assert.equal(v.parseOrder(orderForm({ item_quantity_0: q }), "c1").ok, false, q);
  });
  test("rejects an unknown item kind and an unknown delivery method", () => {
    assert.equal(v.parseOrder(orderForm({ item_kind_0: "gift" }), "c1").ok, false);
    assert.equal(v.parseOrder(orderForm({ delivery_method: "drone" }), "c1").ok, false);
    assert.equal(v.parseOrder(orderForm({ delivery_method: "delivery" }), "c1").ok, true);
  });
});

describe("payment form parsing", { skip }, () => {
  const ok = { amount: "1,000.50", purpose: "deposit", method: "fawran", reference: "FW-1", received_confirmed: "yes" };
  test("accepts cash and Fawran only", () => {
    assert.equal(v.parsePayment(form(ok)).value.amountMinor, 100050);
    assert.equal(v.parsePayment(form({ ...ok, method: "cash" })).ok, true);
    for (const method of ["card", "bank_transfer", "", "CASH"]) assert.equal(v.parsePayment(form({ ...ok, method })).ok, false, method);
  });
  test("a payment is recorded only when the staff member confirms receipt", () => {
    const r = v.parsePayment(form({ ...ok, received_confirmed: "" }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.received_confirmed);
  });
  test("refuses zero, negative, inexact and missing amounts", () => {
    for (const amount of ["0", "-5", "1.234", "", "ten"]) assert.equal(v.parsePayment(form({ ...ok, amount })).ok, false, amount);
  });
  test("receipt numbers are never typed by staff: no such field is read", () => {
    const r = v.parsePayment(form({ ...ok, receipt_code: "R-0000-00001" }));
    assert.equal(r.ok, true);
    assert.equal("receipt_code" in r.value, false);
  });
});

describe("other staff inputs", { skip }, () => {
  test("a reason is 3 to 500 characters", () => {
    assert.equal(v.parseReason(form({ reason: "ab" })).ok, false);
    assert.equal(v.parseReason(form({ reason: "abc" })).ok, true);
    assert.equal(v.parseReason(form({ reason: "x".repeat(501) })).ok, false);
    assert.equal(v.parseReason(form({})).ok, false);
  });
  test("tracking needs a title", () => {
    assert.equal(v.parseTracking(form({ title: "", message: "m" })).ok, false);
    assert.equal(v.parseTracking(form({ title: "Parts ordered" })).ok, true);
  });
  test("uuid check", () => {
    assert.equal(v.isUuid("9b2c3b0e-0d3e-4b1a-9a53-5c1f4f0f3a11"), true);
    for (const bad of ["", "abc", "9b2c3b0e0d3e4b1a9a535c1f4f0f3a11", "'; drop table x; --", null, 4]) assert.equal(v.isUuid(bad), false);
  });
});

describe("deposit schedule form", { skip }, () => {
  const ok = { first_up_to: "3,000", second_up_to: "5000", percent_1: "15", percent_2: "25", percent_3: "35", reason: "Owner confirmed schedule", confirmed_by_owner: "yes", typed_confirmation: "CHANGE DEPOSIT SCHEDULE" };
  test("parses percentages to basis points and builds the tiered policy value", () => {
    const r = v.parseDepositSchedule(form(ok), "confirmed");
    assert.equal(r.ok, true);
    assert.deepEqual(v.depositPolicyValue(r.value), {
      mode: "tiered",
      minimum_minor: 0,
      required_before_status: "confirmed",
      tiers: [{ up_to_minor: 300000, percent_bps: 1500 }, { up_to_minor: 500000, percent_bps: 2500 }, { percent_bps: 3500 }],
    });
  });
  test("percent parsing is exact and bounded", () => {
    assert.equal(v.parsePercentToBps("12.5"), 1250);
    assert.equal(v.parsePercentToBps("15%"), 1500);
    assert.equal(v.parsePercentToBps("100"), 10000);
    for (const bad of ["100.01", "101", "-1", "1.234", "", "abc", "1e2"]) assert.equal(v.parsePercentToBps(bad), null, bad);
  });
  test("needs ascending limits, a reason and the typed confirmation", () => {
    assert.equal(v.parseDepositSchedule(form({ ...ok, second_up_to: "3000" }), "confirmed").ok, false);
    assert.equal(v.parseDepositSchedule(form({ ...ok, reason: "" }), "confirmed").ok, false);
    assert.equal(v.parseDepositSchedule(form({ ...ok, typed_confirmation: "yes" }), "confirmed").ok, false);
    assert.equal(v.parseDepositSchedule(form({ ...ok, percent_2: "x" }), "confirmed").ok, false);
    const unconfirmed = v.parseDepositSchedule(form({ ...ok, confirmed_by_owner: "" }), "confirmed");
    assert.equal(unconfirmed.ok, false);
    assert.ok(unconfirmed.errors.confirmed_by_owner);
  });
});

describe("idempotency keys (PLAT-0004): one key per intended action, kept across retries, replaced only when spent", { skip }, () => {
  const good = "3f2b8c1e-9d4a-4b7e-8a61-2c5d7e9f0a1b";

  test("a form must carry a key of exactly the shape the database accepts, and nothing else is passed on", () => {
    assert.equal(v.parseIdempotencyKey(form({ idempotency_key: good })), good);
    assert.equal(v.parseIdempotencyKey(form({ idempotency_key: `  ${good}  ` })), good, "surrounding spaces are trimmed");
    for (const bad of ["", "short", "x".repeat(101), "has space in it", "semi;colon-key-12345", "quote'key-1234567", "slash/key-1234567", "ünïcode-key-12345"]) {
      assert.equal(v.parseIdempotencyKey(form({ idempotency_key: bad })), null, JSON.stringify(bad));
    }
    assert.equal(v.parseIdempotencyKey(form({})), null, "a missing key is refused, never invented");
    assert.equal(v.parseIdempotencyKey(form({ idempotency_key: "a".repeat(8) })), "a".repeat(8));
    assert.equal(v.parseIdempotencyKey(form({ idempotency_key: "a".repeat(100) })), "a".repeat(100));
  });

  test("the pattern is the SAME as the database's check, so the two can never drift apart", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../migrations/20261121120100_idempotency_expand.sql", import.meta.url), "utf8");
    const quoted = [...sql.matchAll(/'(\^\[A-Za-z0-9\._:-\]\{8,100\}\$)'/g)].map((m) => m[1]);
    assert.ok(quoted.length >= 2, "the migration states the pattern in its table check and in the helper");
    for (const pattern of quoted) assert.equal(pattern, v.IDEMPOTENCY_KEY_PATTERN.source);
  });

  test("a fresh key is valid, and two fresh keys differ", () => {
    const a = v.freshIdempotencyKey();
    const b = v.freshIdempotencyKey();
    assert.match(a, v.IDEMPOTENCY_KEY_PATTERN);
    assert.notEqual(a, b);
  });

  test("the expected paid amount must be a whole number of minor units, and a missing or malformed one is refused (never invented)", () => {
    assert.equal(v.parseExpectedPaid(form({ expected_paid_minor: "0" })), 0);
    assert.equal(v.parseExpectedPaid(form({ expected_paid_minor: " 125000 " })), 125000);
    assert.equal(v.parseExpectedPaid(form({ expected_paid_minor: "999999999999" })), 999999999999);
    for (const bad of ["", "-1", "1.5", "1e3", "abc", "0x10", "1 000", "9999999999999", "١٢٣"]) {
      assert.equal(v.parseExpectedPaid(form({ expected_paid_minor: bad })), null, JSON.stringify(bad));
    }
    assert.equal(v.parseExpectedPaid(form({})), null);
  });

  test("a stale form is told to reload, in plain words, and nothing was changed", () => {
    assert.match(v.STALE_FORM_MESSAGE, /Reload the page/);
    assert.match(v.STALE_FORM_MESSAGE, /Nothing was changed/);
  });
});

// A stand-in for sessionStorage: what the key store needs, nothing else.
const memoryStore = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, value) => void data.set(k, String(value)), data };
};

describe("the browser's key store (PLAT-0004): a key is kept across retries and reloads, replaced when spent or when the page's decision changed", { skip }, () => {
  const PAGE = "page-key-00000001";

  test("the first visit saves the page's own key; a reload or a retry keeps it", () => {
    const store = memoryStore();
    assert.equal(client.chooseKey(store, "payment:o1", "0", PAGE), PAGE);
    assert.equal(client.chooseKey(store, "payment:o1", "0", "page-key-00000002"), PAGE, "a second page render (a reload) still carries the first key");
  });

  test("the key is bound to the balance the page showed: when the balance moved it is a NEW decision and gets the page's new key", () => {
    const store = memoryStore();
    assert.equal(client.chooseKey(store, "payment:o1", "0", PAGE), PAGE);
    // The payment went through but the response was lost; the reloaded page shows the new balance.
    assert.equal(client.chooseKey(store, "payment:o1", "30000", "page-key-00000002"), "page-key-00000002");
    // ...and that new key is now the saved one for the new balance.
    assert.equal(client.chooseKey(store, "payment:o1", "30000", "page-key-00000003"), "page-key-00000002");
  });

  test("scopes do not share keys: another order, another customer, another form", () => {
    const store = memoryStore();
    assert.equal(client.chooseKey(store, "payment:o1", "0", PAGE), PAGE);
    assert.equal(client.chooseKey(store, "payment:o2", "0", "page-key-00000002"), "page-key-00000002");
    assert.equal(client.chooseKey(store, "order:c1", "", "page-key-00000003"), "page-key-00000003");
    assert.equal(client.chooseKey(store, "payment:o1", "0", "page-key-00000004"), PAGE);
  });

  test("damaged, foreign or old-format saved values are ignored and replaced; storage that throws or is missing falls back to the page's key", () => {
    for (const bad of ["not json", "{}", "null", JSON.stringify({ key: "bad key!", binding: "0" }), JSON.stringify({ key: PAGE }), JSON.stringify({ key: PAGE, binding: 0 }), "plain-old-key-00000009"]) {
      const store = memoryStore({ "m1-idem:payment:o1": bad });
      assert.equal(client.chooseKey(store, "payment:o1", "0", PAGE), PAGE, bad);
    }
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.equal(client.chooseKey(throwing, "payment:o1", "0", PAGE), PAGE);
    assert.equal(client.rotateKey(throwing, "payment:o1", "0", "page-key-00000009"), "page-key-00000009");
    assert.equal(client.chooseKey(null, "payment:o1", "0", PAGE), PAGE);
    assert.match(client.rotateKey(null, "payment:o1", "0"), v.IDEMPOTENCY_KEY_PATTERN);
  });

  test("rotating saves the new key under the same scope, so a reload keeps it", () => {
    const store = memoryStore();
    client.chooseKey(store, "payment:o1", "0", PAGE);
    const next = client.rotateKey(store, "payment:o1", "0");
    assert.notEqual(next, PAGE);
    assert.match(next, v.IDEMPOTENCY_KEY_PATTERN);
    assert.equal(client.chooseKey(store, "payment:o1", "0", "page-key-00000002"), next);
  });

  test("a key is spent after a success or when the database retired it, and NOT after any other failure or an unknown outcome", () => {
    assert.equal(client.keyIsSpent({ status: "success", message: "Payment recorded." }), true);
    assert.equal(client.keyIsSpent({ status: "error", message: "x", keyRetired: true }), true);
    for (const message of ["this payment would exceed the order total", outcomes.failureState(new gateway.StaffOutcomeUnknownError(true)).message, "Something went wrong. Nothing was changed."]) {
      assert.equal(client.keyIsSpent({ status: "error", message }), false, message);
    }
    assert.equal(client.keyIsSpent({ status: "error", message: "this idempotency key was already used for a different request" }), false, "the wording alone no longer decides: the database's flag does");
    assert.equal(client.keyIsSpent({ status: "error" }), false);
    assert.equal(client.keyIsSpent({ status: "idle" }), false);
  });
});

describe("what the screen says (PLAT-0004): every sentence is true for the situation that produces it", { skip }, () => {
  const { StaffOperationError, StaffOutcomeUnknownError, StaffPermissionError, StaffUnavailableError } = gateway ?? {};

  test("a repeat is described as a repeat, a first save as a first save", () => {
    assert.equal(outcomes.paymentSuccessMessage(false), outcomes.PAYMENT_RECORDED);
    assert.equal(outcomes.paymentSuccessMessage(true), outcomes.PAYMENT_ALREADY_RECORDED);
    assert.match(outcomes.PAYMENT_ALREADY_RECORDED, /already recorded/);
    assert.match(outcomes.PAYMENT_ALREADY_RECORDED, /nothing new was recorded/);
    assert.equal(outcomes.orderSuccessMessage(false), outcomes.ORDER_CREATED);
    assert.equal(outcomes.orderSuccessMessage(true), outcomes.ORDER_ALREADY_CREATED);
    assert.match(outcomes.ORDER_ALREADY_CREATED, /no second order was made/);
  });

  test("a refusal that retires the key tells the form so; an ordinary refusal does not", () => {
    assert.deepEqual(outcomes.failureState(new StaffOperationError("this payment was recorded and has since been reversed", { retireKey: true })), {
      status: "error", message: "this payment was recorded and has since been reversed", keyRetired: true,
    });
    assert.deepEqual(outcomes.failureState(new StaffOperationError("this payment would exceed the order total")), { status: "error", message: "this payment would exceed the order total" });
  });

  test("permission, unavailable and unexpected failures use fixed, honest sentences", () => {
    assert.equal(outcomes.failureState(new StaffPermissionError()).message, outcomes.DENIED);
    assert.equal(outcomes.failureState(new StaffUnavailableError(gateway.UNAVAILABLE_NOTHING_CHANGED)).message, gateway.UNAVAILABLE_NOTHING_CHANGED);
    assert.equal(outcomes.failureState(new Error("select * from private.secrets")).message, gateway.UNEXPECTED);
    assert.doesNotMatch(outcomes.failureState(new Error("password=hunter2 host=db.internal")).message, /hunter2|internal|password/);
  });

  test("a lost commit never claims that nothing was changed, and never invites a blind retry of a non-keyed action", () => {
    const keyed = outcomes.failureState(new StaffOutcomeUnknownError(true));
    const plain = outcomes.failureState(new StaffOutcomeUnknownError(false));
    for (const s of [keyed, plain]) {
      assert.equal(s.status, "error");
      assert.doesNotMatch(s.message, /nothing was changed/i);
      assert.match(s.message, /may or may not have been saved/);
      assert.match(s.message, /Reload the page and check/);
      assert.equal(s.keyRetired, undefined, "the key is KEPT so that sending the form again is a repeat");
    }
    assert.match(keyed.message, /will not be saved twice/);
    assert.doesNotMatch(plain.message, /will not be saved twice/);
  });

  test("the duplicate-order warning creates nothing, shows evidence, never calls the order invalid, and tells the person how to proceed", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const warning = outcomes.duplicateWarning([
      { order_id: "11111111-1111-4111-8111-111111111111", order_ref: "O-2026-0001", status: "pending_confirmation", total_minor: 400000, created_at: "2026-11-21T11:48:00Z" },
    ], now);
    assert.equal(warning.status, "error");
    assert.equal(warning.keyRetired, undefined);
    assert.match(warning.message, /Nothing was created yet/);
    assert.match(warning.message, /O-2026-0001/);
    assert.match(warning.message, /12 minutes ago/);
    assert.match(warning.message, /QAR 4,000\.00/);
    assert.match(warning.message, /tick the box below/);
    assert.doesNotMatch(warning.message, /invalid|rejected|not allowed/i);
    assert.deepEqual(warning.duplicates, [{ id: "11111111-1111-4111-8111-111111111111", ref: "O-2026-0001", status: "pending_confirmation", totalMinor: 400000, createdAt: "2026-11-21T11:48:00Z" }]);
    const two = outcomes.duplicateWarning([
      { order_id: "11111111-1111-4111-8111-111111111111", order_ref: "O-1", status: "pending_confirmation", total_minor: 100, created_at: "2026-11-21T11:59:40Z" },
      { order_id: "22222222-2222-4222-8222-222222222222", order_ref: "O-2", status: "awaiting_deposit", total_minor: 200, created_at: "2026-11-20T12:30:00Z" },
    ], now);
    assert.match(two.message, /2 orders/);
    assert.match(two.message, /less than a minute ago/);
    assert.match(two.message, /24 hours ago/, "23.5 hours rounds to 24");
  });

  test("ages read naturally and an unreadable time never shows 'Invalid Date' or NaN", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    assert.equal(format.ageText("2026-11-21T11:59:59Z", now), "less than a minute ago");
    assert.equal(format.ageText("2026-11-21T11:59:00Z", now), "1 minute ago");
    assert.equal(format.ageText("2026-11-21T11:30:00Z", now), "30 minutes ago");
    assert.equal(format.ageText("2026-11-21T11:00:00Z", now), "1 hour ago");
    assert.equal(format.ageText("2026-11-21T09:00:00Z", now), "3 hours ago");
    assert.equal(format.ageText("2026-11-21T12:05:00Z", now), "less than a minute ago", "a clock a little ahead is not a negative age");
    assert.equal(format.ageText("garbage", now), "recently");
  });
});
