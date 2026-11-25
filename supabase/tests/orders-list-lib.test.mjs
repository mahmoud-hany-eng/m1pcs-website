// The Orders list's address-bar rules and the header's account-link rules: the pure logic that needs no server, no database and no browser.
// LOCAL tests with plain inputs. What the database does with the choices is proved in orders-list.db.test.mjs; how the page and the header draw them
// is proved in orders.pages.db.test.mjs, orders.layout.browser.test.mjs and header.browser.test.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, test } from "node:test";

register("./support/alias-loader.mjs", import.meta.url);

let load = null;
let skip = false;
try {
  load = {
    list: await import("../../src/lib/staff/orders-list.ts"),
    nav: await import("../../src/lib/account-nav.ts"),
    header: await import("../../src/lib/accounts/shared/header-nav.ts"),
  };
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { list, nav, header } = load ?? {};
const STATUSES = ["", "pending_confirmation", "awaiting_deposit", "delivered", "on_hold", "cancelled"];
const parse = (raw) => list.parseOrdersListQuery(raw, STATUSES);

describe("the Orders list's choices in the address bar", { skip }, () => {
  test("no choices at all are the default list: 5 per page, newest first, any status, any date, page 1", () => {
    const { query, error } = parse({});
    assert.equal(error, null);
    assert.deepEqual(query, { q: "", status: "", year: null, month: null, from: null, to: null, sort: "newest", size: 5, page: 1 });
    assert.deepEqual(query, list.DEFAULT_QUERY);
    assert.equal(list.hasActiveFilters(query), false);
  });

  test("every choice is read, and anything unreadable falls back to its default instead of failing", () => {
    const { query, error } = parse({ q: "  Ali  ", status: "delivered", year: "2026", month: "11", from: "2026-11-10", to: "2026-11-25", sort: "price_desc", size: "25", page: "3" });
    assert.equal(error, null);
    assert.deepEqual(query, { q: "Ali", status: "delivered", year: 2026, month: 11, from: "2026-11-10", to: "2026-11-25", sort: "price_desc", size: 25, page: 3 });
    const junk = parse({ status: "nonsense", year: "1999", month: "13", sort: "cheapest", size: "7", page: "-4" });
    assert.equal(junk.error, null);
    assert.deepEqual(junk.query, list.DEFAULT_QUERY);
    for (const bad of [{ year: "abc" }, { year: "20260" }, { year: "2101" }, { month: "0" }, { month: "x" }, { size: "100" }, { size: "" }, { page: "0" }, { page: "1e3" }, { page: "99999999" }]) {
      assert.equal(parse(bad).error, null, JSON.stringify(bad));
    }
    assert.equal(parse({ page: "99999999" }).query.page, 1, "an absurd page number is ignored");
    assert.equal(parse({ page: "100000" }).query.page, 100000);
    assert.equal(parse({ size: "5" }).query.size, 5);
    assert.equal(parse({ size: "10" }).query.size, 10);
    assert.equal(parse({ size: "25" }).query.size, 25);
  });

  test("a repeated parameter uses the first value, and the search text is limited to 80 characters", () => {
    assert.equal(parse({ sort: ["oldest", "newest"] }).query.sort, "oldest");
    assert.equal(parse({ q: "x".repeat(200) }).query.q.length, 80);
  });

  test("DATES: only real calendar days are accepted; anything else is an error a person can act on, not a different list", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2027-02-29", "2026-00-10", "2026-11-00", "11/25/2026", "25-11-2026", "abc", "2026-1-5", "2026-11-25T10:00"]) {
      const { error } = parse({ from: bad });
      assert.match(error ?? "", /is not a real date/, bad);
      assert.match(parse({ to: bad }).error ?? "", /is not a real date/, `to ${bad}`);
    }
    assert.equal(parse({ from: "2028-02-29" }).error, null, "2028 is a leap year");
    assert.equal(parse({ from: "2100-12-31" }).error, null);
    assert.match(parse({ from: "2019-12-31" }).error ?? "", /outside the supported years \(2020 to 2100\)/);
    assert.match(parse({ to: "2101-01-01" }).error ?? "", /outside the supported years/);
    assert.equal(parse({ from: "" }).query.from, null, "an empty date is no date");
    assert.equal(parse({ from: "  " }).error, null);
    assert.match(parse({ from: "x".repeat(100) }).error ?? "", /“x{20}” is not a real date/, "a long junk value is cut in the message");
  });

  test("a start date after the end date is refused with both dates in the message; equal dates, and open ends, are fine", () => {
    const { error } = parse({ from: "2026-11-25", to: "2026-11-10" });
    assert.equal(error, "The start date (25 Nov 2026) is after the end date (10 Nov 2026). Swap them, or change one of them.");
    assert.equal(parse({ from: "2026-11-10", to: "2026-11-10" }).error, null, "a single day");
    assert.equal(parse({ from: "2026-11-10" }).error, null, "open-ended to the future");
    assert.equal(parse({ to: "2026-11-10" }).error, null, "open-ended to the past");
    assert.equal(parse({ from: "2026-12-31", to: "2027-01-01" }).error, null, "across a year end");
  });

  test("the address is written back without defaults, with the report's own choices first, and reads back to the same choices", () => {
    const base = list.DEFAULT_QUERY;
    assert.equal(list.ordersQueryString(base), "");
    assert.equal(list.ordersHref(base), "/admin/orders");
    assert.equal(list.ordersHref(base, {}, {}, "#orders-list"), "/admin/orders#orders-list");
    assert.equal(list.ordersHref(base, {}, { fy: "2026", fm: "11" }, "#orders-list"), "/admin/orders?fy=2026&fm=11#orders-list");
    const full = { q: "ali baba", status: "on_hold", year: 2026, month: 11, from: "2026-11-10", to: "2026-11-25", sort: "price_asc", size: 10, page: 4 };
    const qs = list.ordersQueryString(full, {}, { fy: "2025" });
    assert.equal(qs, "fy=2025&q=ali+baba&status=on_hold&year=2026&month=11&from=2026-11-10&to=2026-11-25&sort=price_asc&size=10&page=4");
    const back = parse(Object.fromEntries(new URLSearchParams(qs)));
    assert.equal(back.error, null);
    assert.deepEqual(back.query, full);
    // overrides replace single choices; the original is not changed
    assert.equal(list.ordersQueryString(full, { page: 1 }, {}).includes("page="), false, "page 1 is the default and is left out");
    assert.equal(full.page, 4);
    assert.equal(list.ordersQueryString(full, { sort: "newest", size: 5 }, {}).includes("sort="), false);
  });

  test("a changed filter or sort goes back to page 1 because the form carries no page; paging links carry everything else", () => {
    const q = { ...list.DEFAULT_QUERY, status: "delivered", sort: "oldest", size: 10, page: 3 };
    const next = list.ordersHref(q, { page: 4 }, { fy: "2026" }, "#orders-list");
    assert.equal(next, "/admin/orders?fy=2026&status=delivered&sort=oldest&size=10&page=4#orders-list");
    const hidden = list.ordersHiddenFields(q);
    assert.deepEqual(hidden, { status: "delivered", sort: "oldest", size: "10", page: "3" }, "the report's form keeps the list exactly where it is");
  });

  test("the sort choices are the four the owner asked for, newest first being the default", () => {
    assert.deepEqual(list.ORDER_SORTS.map((s) => s.value), ["newest", "oldest", "price_asc", "price_desc"]);
    assert.deepEqual(list.ORDER_SORTS.map((s) => s.label), ["Newest orders first", "Oldest orders first", "Lowest order price first", "Highest order price first"]);
    assert.deepEqual([...list.PAGE_SIZES], [5, 10, 25]);
    assert.equal(list.DEFAULT_PAGE_SIZE, 5);
  });

  test("the sentence under the filters says exactly what the database applied", () => {
    const f = (o) => ({ search: "", status: null, year: null, month: null, from: null, to: null, range_overrides_period: false, ...o });
    assert.equal(list.periodWords(f({})), null);
    assert.equal(list.periodWords(f({ year: 2026 })), "placed in 2026");
    assert.equal(list.periodWords(f({ year: 2026, month: 11 })), "placed in November 2026");
    assert.equal(list.periodWords(f({ from: "2026-11-10", to: "2026-11-25" })), "placed from 10 Nov 2026 to 25 Nov 2026");
    assert.equal(list.periodWords(f({ from: "2026-11-10", to: "2026-11-10" })), "placed on 10 Nov 2026");
    assert.equal(list.periodWords(f({ from: "2026-11-10" })), "placed on or after 10 Nov 2026");
    assert.equal(list.periodWords(f({ to: "2026-11-25" })), "placed on or before 25 Nov 2026");
    assert.equal(list.summaryText({ total: 23, first: 1, last: 5 }), "Showing 1–5 of 23 orders");
    assert.equal(list.summaryText({ total: 1, first: 1, last: 1 }), "Showing 1–1 of 1 order");
    assert.equal(list.summaryText({ total: 0, first: 0, last: 0 }), "No orders match");
    assert.equal(list.dayText("2026-01-05"), "5 Jan 2026");
  });

  test("hasActiveFilters ignores the sort and the page size, which narrow nothing", () => {
    assert.equal(list.hasActiveFilters({ ...list.DEFAULT_QUERY, sort: "oldest", size: 25, page: 2 }), false);
    for (const o of [{ q: "x" }, { status: "delivered" }, { year: 2026 }, { month: 3 }, { from: "2026-01-01" }, { to: "2026-01-01" }]) assert.equal(list.hasActiveFilters({ ...list.DEFAULT_QUERY, ...o }), true, JSON.stringify(o));
  });
});

describe("the account links the public header may offer", { skip }, () => {
  const labels = (links) => links.map((l) => `${l.label} ${l.href}`);

  test("with the switches off (the default, and production) the header offers NOTHING, so no link can lead to a 404", () => {
    assert.deepEqual(header.headerAccountLinks({}), []);
    assert.deepEqual(header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "false" }), []);
    assert.deepEqual(header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "TRUE" }), [], "only the exact value true counts");
    assert.deepEqual(header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "1" }), []);
    assert.deepEqual(header.headerAccountLinks({ STAFF_ADMIN_ENABLED: "true" }), [], "the staff switch alone opens nothing: the admin area also needs the account switch");
  });

  test("on a PRODUCTION deployment both switches are ignored, whatever they say", () => {
    assert.deepEqual(header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true", VERCEL_ENV: "production" }), []);
    assert.deepEqual(header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "production" }), []);
  });

  test("in a Preview with the customer switch on the three customer entries appear, with the staff entry only when the staff switch is on too", () => {
    const customer = header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", VERCEL_ENV: "preview" });
    assert.deepEqual(labels(customer), ["My Account /account", "Customer Sign In /auth/sign-in", "Create Account /auth/sign-up"]);
    assert.ok(customer.every((l) => l.group === "customer"));
    const both = header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true", VERCEL_ENV: "preview" });
    assert.deepEqual(labels(both), ["My Account /account", "Customer Sign In /auth/sign-in", "Create Account /auth/sign-up", "Staff Dashboard /admin"]);
    assert.equal(both.at(-1).group, "staff");
    // a local run (no VERCEL_ENV at all) behaves like a preview
    assert.equal(header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true" }).length, 4);
  });

  test("every link goes to a plain address on this site: no external link, no query, no fragment, nothing that carries a token", () => {
    for (const link of header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true" })) assert.match(link.href, /^\/[a-z/-]*$/, link.href);
  });

  test("an entry is left out where it is plainly redundant: sign-in inside the account and the dashboard, the page's own link on itself", () => {
    const all = header.headerAccountLinks({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true" });
    const at = (path) => labels(nav.linksForPath(all, path));
    assert.deepEqual(at("/"), ["My Account /account", "Customer Sign In /auth/sign-in", "Create Account /auth/sign-up", "Staff Dashboard /admin"]);
    assert.deepEqual(at("/build-my-pc"), at("/"));
    assert.deepEqual(at("/account"), ["My Account /account", "Staff Dashboard /admin"], "inside the account the person is signed in");
    assert.deepEqual(at("/account/orders/O-1"), ["My Account /account", "Staff Dashboard /admin"]);
    assert.deepEqual(at("/admin"), ["My Account /account"], "in the dashboard: no sign-in links and no link to where they are");
    assert.deepEqual(at("/admin/orders"), ["My Account /account"]);
    assert.deepEqual(at("/auth/sign-in"), ["My Account /account", "Create Account /auth/sign-up", "Staff Dashboard /admin"]);
    assert.deepEqual(at("/auth/sign-up"), ["My Account /account", "Customer Sign In /auth/sign-in", "Staff Dashboard /admin"]);
    assert.deepEqual(at("/accounts-and-more"), at("/"), "a prefix is a whole path segment: /accounts-and-more is not inside /account");
    assert.deepEqual(at("/administration"), at("/"), "...nor is /administration inside /admin");
  });

  test("a link says it is the current page for the page itself and everything below it, and for nothing else", () => {
    assert.equal(nav.isCurrentLink({ href: "/account" }, "/account"), true);
    assert.equal(nav.isCurrentLink({ href: "/account" }, "/account/orders"), true);
    assert.equal(nav.isCurrentLink({ href: "/account" }, "/accounts"), false);
    assert.equal(nav.isCurrentLink({ href: "/auth/sign-in" }, "/auth/sign-up"), false);
  });
});
