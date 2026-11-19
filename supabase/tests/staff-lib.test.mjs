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
  };
} catch (error) {
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { flag, v, state } = load ?? {};

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
