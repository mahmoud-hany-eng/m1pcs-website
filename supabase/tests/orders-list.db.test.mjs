// THE ORDERS LIST, IN THE DATABASE. A real PostgreSQL 16, the real migrations, and the real staff function admin.list_orders_page that the Orders page
// calls. Everything the owner asked of the list is proved here, against more than a hundred orders and a set of orders placed on the exact seconds
// either side of a Qatar midnight, month end and year end:
//   * the default is the 5 newest orders, newest first, with the total, the page count and "first-last" for "Showing 1-5 of N";
//   * newest / oldest are exact reverses; lowest / highest price sort by what the customer has to PAY (total - discount - redeemed credit), not by
//     the gross; equal values never repeat or skip an order across pages (the secondary order is the date placed, then the id);
//   * the month / year / custom range filters work on the date the order was PLACED, in Asia/Qatar, with both ends of a range inclusive, either end
//     optional, and the range winning over the month and year;
//   * the filters combine (search + status + period + sort), the page is clamped to the last page, an empty result is a clean empty page;
//   * a differential check: 90 combinations of choices are answered by the database AND by an independent model written here in JavaScript from the
//     raw rows, and the two must agree on the total, the page, and every id in order;
//   * the list's filters never touch the completion-date financial report (an order placed in one month and completed in another is in the list of
//     the first and in the report of the second);
//   * the permission (orders.read, second factor), the privileges, the shape of a row (no cost, margin, profit or supplier), and that the migration is
//     purely additive, rerunnable, and leaves admin.list_orders exactly as it was.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { CUST_C, lines, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const MIGRATION = "20261125120000_orders_list_paging.sql";
const FN = "admin.list_orders_page(text, text, integer, integer, date, date, text, integer, integer)";
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

// ---- an independent model of the rules (Qatar is UTC+3 all year: no daylight saving) ---------------------------------------------------------------
const QATAR_MS = 3 * 3600 * 1000;
const qatarDay = (iso) => new Date(new Date(iso).getTime() + QATAR_MS).toISOString().slice(0, 10);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function model(all, f, currentYear) {
  const o = { search: "", status: null, year: null, month: null, from: null, to: null, sort: "newest", page: 1, size: 5, ...f };
  const byRange = o.from !== null || o.to !== null;
  let yearEff = null;
  let monthEff = null;
  if (!byRange && (o.year !== null || o.month !== null)) {
    yearEff = o.year ?? currentYear;
    monthEff = o.month;
  }
  const needle = o.search.trim().toLowerCase();
  const matches = all.filter((r) => {
    if (o.status !== null && r.status !== o.status) return false;
    if (needle && !(r.ref.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle))) return false;
    const day = qatarDay(r.created_at);
    if (byRange) return (o.from === null || day >= o.from) && (o.to === null || day <= o.to);
    if (yearEff !== null) {
      if (Number(day.slice(0, 4)) !== yearEff) return false;
      if (monthEff !== null && Number(day.slice(5, 7)) !== monthEff) return false;
    }
    return true;
  });
  const t = (r) => new Date(r.created_at).getTime();
  const order = {
    newest: (a, b) => t(b) - t(a) || cmp(b.id, a.id),
    oldest: (a, b) => t(a) - t(b) || cmp(a.id, b.id),
    price_asc: (a, b) => a.net - b.net || t(b) - t(a) || cmp(b.id, a.id),
    price_desc: (a, b) => b.net - a.net || t(b) - t(a) || cmp(b.id, a.id),
  }[o.sort];
  const sorted = [...matches].sort(order);
  const pages = Math.max(1, Math.ceil(sorted.length / o.size));
  const page = Math.min(Math.max(o.page, 1), pages);
  return { total: sorted.length, pages, page, ids: sorted.slice((page - 1) * o.size, page * o.size).map((r) => r.id), yearEff, monthEff, byRange };
}

suite("the Orders list: filtered, sorted, counted and paged in the database", () => {
  let db;
  let all = [];
  let currentYear;
  const ids = {};

  const query = (args = {}, who = AS.sam) => {
    const a = { search: null, status: null, year: null, month: null, from: null, to: null, sort: "newest", page: 1, size: 5, ...args };
    const sql = `select admin.list_orders_page(${lit(a.search)}, ${lit(a.status)}, ${lit(a.year)}, ${lit(a.month)}, ${lit(a.from)}::date, ${lit(a.to)}::date, ${lit(a.sort)}, ${a.page}, ${a.size})::text;`;
    return JSON.parse(lines(db.ok(sql, who)).pop());
  };
  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  const idsOf = (page) => page.rows.map((r) => r.id);
  /** Every page of one choice set, in order. */
  const walk = (args, size = 25) => {
    const out = [];
    let first = query({ ...args, page: 1, size });
    out.push(...idsOf(first));
    for (let p = 2; p <= first.pages; p += 1) out.push(...idsOf(query({ ...args, page: p, size })));
    return out;
  };
  const placeAt = (id, iso) => rewrite(`update public.orders set created_at = '${iso}' where id = '${id}';`);
  const create = ({ customer, total, discount = null, points = 0 }) =>
    lines(
      commit(
        `select admin.create_order('${customer}', '${JSON.stringify([{ kind: "component", description: "Test item", quantity: 1, unit_price_minor: total }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, ${
          discount ? `'${JSON.stringify(discount)}'::jsonb` : "null::jsonb"
        }, ${points}::bigint, null::bigint, null::bigint, null::jsonb);`,
      ),
    )
      .pop()
      .trim();

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    currentYear = Number(read("select extract(year from now() at time zone 'Asia/Qatar')::integer"));
    // 130 ordinary orders for two customers, 73 hours apart from 1 November 2025 (so they cover November 2025 to the end of November 2026), with 17
    // different prices so that many orders share a price. Every 7th is awaiting a deposit and every 11th is on hold.
    commit(`do $$
      declare i integer; cust uuid;
      begin
        for i in 1..130 loop
          cust := case when i % 2 = 0 then '${ID.custA}'::uuid else '${ID.custB}'::uuid end;
          perform admin.create_order(cust, jsonb_build_array(jsonb_build_object('kind', 'component', 'description', 'Item ' || i, 'quantity', 1, 'unit_price_minor', 10000 + (i % 17) * 5000)),
                                     null::uuid, 'admin'::text, null::text, null::text, null::text, null::jsonb, 0::bigint, null::bigint, null::bigint, null::jsonb);
        end loop;
      end $$;`);
    rewrite(`with n as (select id, row_number() over (order by order_ref) as i from public.orders)
             update public.orders o set created_at = timestamptz '2025-11-01 09:00:00+03' + (n.i * interval '73 hours'),
                    status = case when n.i % 7 = 0 then 'awaiting_deposit' when n.i % 11 = 0 then 'on_hold' else o.status end
               from n where n.id = o.id;`);

    // Eight orders for a customer of their own (Carol), placed on the exact seconds either side of a Qatar midnight, month end and year end, and two
    // with the same moment and the same price (a tie). Searching for Carol isolates them.
    const edges = {
      yearEndLast: "2025-12-31T20:59:59Z", // 23:59:59 on 31 Dec 2025 in Qatar
      yearStart: "2025-12-31T21:00:00Z", //   00:00:00 on  1 Jan 2026 in Qatar
      octLast: "2026-10-31T20:59:59Z", //     23:59:59 on 31 Oct 2026
      novFirst: "2026-10-31T21:00:00Z", //    00:00:00 on  1 Nov 2026
      novLast: "2026-11-30T20:59:59Z", //     23:59:59 on 30 Nov 2026
      decFirst: "2026-11-30T21:00:00Z", //    00:00:00 on  1 Dec 2026
      tieA: "2026-06-15T09:00:00Z",
      tieB: "2026-06-15T09:00:00Z",
    };
    let price = 700000;
    for (const [name, iso] of Object.entries(edges)) {
      ids[name] = create({ customer: CUST_C, total: name.startsWith("tie") ? 450000 : (price += 10000) });
      placeAt(ids[name], iso);
    }
    // Three orders whose gross order value and the amount to PAY are in a different order: S2 has the highest gross and the middle payable.
    commit(`select admin.adjust_loyalty('${ID.custB}', 2000, 'points for the list test');`);
    ids.s1 = create({ customer: ID.custB, total: 5_000_000 });
    ids.s2 = create({ customer: ID.custB, total: 6_000_000, discount: { mode: "fixed", amount_minor: 1_500_000, reason: "owner discount for the list test" }, points: 2000 });
    ids.s3 = create({ customer: ID.custB, total: 4_600_000 });
    for (const [k, iso] of [["s1", "2026-03-05T10:00:00Z"], ["s2", "2026-03-06T10:00:00Z"], ["s3", "2026-03-07T10:00:00Z"]]) placeAt(ids[k], iso);

    all = JSON.parse(
      read(`select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'created_at', o.created_at, 'status', o.status, 'net', o.net_payable_minor, 'ref', o.order_ref, 'name', c.full_name, 'code', c.customer_code)), '[]'::jsonb)::text
            from public.orders o join public.customers c on c.id = o.customer_id`),
    );
    // The fixtures bring a couple of orders of their own, so the exact count is read, not assumed: it is well over 100.
    assert.ok(all.length >= 130 + 8 + 3 && all.length > 100, `the data set has ${all.length} orders (more than 100)`);
  });
  after(() => db?.stop());

  // ===================================================================================================================
  describe("the default: the 5 newest orders", () => {
    it("with no filter it returns exactly 5 rows, newest first, and says how many there are", () => {
      const page = query();
      assert.equal(page.rows.length, 5);
      assert.equal(page.total, all.length);
      assert.equal(page.page, 1);
      assert.equal(page.page_size, 5);
      assert.equal(page.pages, Math.ceil(all.length / 5));
      assert.equal(page.first, 1);
      assert.equal(page.last, 5);
      assert.equal(page.sort, "newest");
      const times = page.rows.map((r) => new Date(r.created_at).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
      // The very newest order in the data is the one placed 00:00:00 on 1 Dec 2026 Qatar time... or a bulk order; the model says which.
      assert.deepEqual(idsOf(page), model(all, {}, currentYear).ids);
      assert.deepEqual(page.filters, { search: "", status: null, year: null, month: null, from: null, to: null, range_overrides_period: false });
    });

    it("the function's own defaults (no arguments at all) are the same: 5 newest, newest first", () => {
      const page = JSON.parse(lines(db.ok("select admin.list_orders_page()::text;", AS.sam)).pop());
      assert.deepEqual(idsOf(page), idsOf(query()));
    });

    it("fewer than 5 orders exist: it returns what there is (checked on a filter that matches 3)", () => {
      const page = query({ search: "Carol", from: "2026-11-01", to: "2026-11-30" });
      assert.equal(page.total, 2);
      assert.equal(page.rows.length, 2);
      assert.equal(page.first, 1);
      assert.equal(page.last, 2);
      assert.equal(page.pages, 1);
    });

    it("a row carries the money fields the screen shows and NOTHING private: no cost, margin, profit, supplier or note", () => {
      const row = query().rows[0];
      for (const key of ["id", "order_ref", "status", "status_label", "total_minor", "net_payable_minor", "discount_minor", "loyalty_credit_minor", "amount_paid_minor", "balance_due_minor", "created_at", "customer_name", "customer_code", "workflow_version", "fulfillment_type"]) {
        assert.ok(key in row, `row has ${key}`);
      }
      const text = JSON.stringify(query({ size: 100 }));
      assert.doesNotMatch(text, /cost|margin|profit|supplier|internal|note/i);
      assert.equal("rn" in row, false, "the row-number helper does not leak into the answer");
    });
  });

  // ===================================================================================================================
  describe("sorting", () => {
    it("newest first and oldest first are exact reverses across every page, with no order repeated or missing", () => {
      const newest = walk({ sort: "newest" });
      const oldest = walk({ sort: "oldest" });
      assert.equal(newest.length, all.length);
      assert.equal(new Set(newest).size, all.length, "no duplicates");
      assert.deepEqual(oldest, [...newest].reverse());
      assert.deepEqual(new Set(newest), new Set(all.map((r) => r.id)), "none missing");
    });

    it("lowest / highest price sort by what the customer has to PAY, with ties broken by the date placed (newest first) and then the id, across every page", () => {
      for (const sort of ["price_asc", "price_desc"]) {
        const walked = walk({ sort }, 10);
        assert.equal(walked.length, all.length, sort);
        assert.equal(new Set(walked).size, all.length, `${sort}: no duplicates`);
        assert.deepEqual(walked, model(all, { sort, size: 1000 }, currentYear).ids.length === all.length ? model(all, { sort, size: 1000 }, currentYear).ids : [], `${sort}: matches the model`);
        const byId = new Map(all.map((r) => [r.id, r]));
        const nets = walked.map((id) => byId.get(id).net);
        const sorted = [...nets].sort((a, b) => (sort === "price_asc" ? a - b : b - a));
        assert.deepEqual(nets, sorted, `${sort} is ordered by the amount payable`);
      }
    });

    it("the price is the AMOUNT PAYABLE, not the gross: the order with the biggest gross but a discount and credit sorts in the middle", () => {
      const desc = query({ sort: "price_desc", size: 5 });
      assert.deepEqual(idsOf(desc).slice(0, 3), [ids.s1, ids.s3, ids.s2], "payable 50,000.00 > 46,000.00 > 44,800.00, though the gross of S2 (60,000.00) is the highest");
      const s2 = desc.rows.find((r) => r.id === ids.s2);
      assert.equal(s2.total_minor, 6_000_000);
      assert.equal(s2.discount_minor, 1_500_000);
      assert.equal(s2.loyalty_credit_minor, 20_000);
      assert.equal(s2.net_payable_minor, 6_000_000 - 1_500_000 - 20_000, "the payable amount is gross - discount - credit");
      const tail = walk({ sort: "price_asc" }).slice(-3);
      assert.deepEqual(tail, [ids.s2, ids.s3, ids.s1], "the three most expensive, ending the lowest-first list");
    });

    it("orders with the same price and the very same moment are ordered by id, so they never swap places between pages", () => {
      const two = [ids.tieA, ids.tieB].sort().reverse(); // newest first falls back to id descending
      const page = query({ search: "Carol", from: "2026-06-15", to: "2026-06-15", sort: "newest" });
      assert.deepEqual(idsOf(page), two);
      const small = [1, 2].map((p) => idsOf(query({ search: "Carol", from: "2026-06-15", to: "2026-06-15", sort: "price_asc", page: p, size: 1 }))[0]);
      assert.deepEqual(small, two, "one row per page: the same two orders, once each, in the same order as on one page");
    });

    it("an unknown sort is refused with a message", () => {
      const r = db.run(`${AS.sam}select admin.list_orders_page(null, null, null, null, null, null, 'cheapest', 1, 5);`);
      assert.equal(r.ok, false);
      assert.match(r.err, /22023|sort must be/);
    });
  });

  // ===================================================================================================================
  describe("the date the order was placed, in Qatar time", () => {
    it("a month is chosen by the Qatar calendar: 23:59:59 on 31 October is October, 00:00:00 on 1 November is November (the same for the end of November and of the year)", () => {
      const only = (args) => query({ search: "Carol", size: 25, sort: "oldest", ...args });
      assert.deepEqual(idsOf(only({ year: 2026, month: 10 })).filter((id) => [ids.octLast, ids.novFirst].includes(id)), [ids.octLast]);
      assert.deepEqual(idsOf(only({ year: 2026, month: 11 })), [ids.novFirst, ids.novLast], "November 2026 is exactly the two orders inside it");
      assert.deepEqual(idsOf(only({ year: 2026, month: 12 })), [ids.decFirst]);
      assert.deepEqual(idsOf(only({ year: 2025 })), [ids.yearEndLast], "2025 ends at 23:59:59 on 31 December, Qatar time");
      assert.ok(idsOf(only({ year: 2026 })).includes(ids.yearStart), "2026 starts at 00:00:00 on 1 January, Qatar time");
      assert.ok(!idsOf(only({ year: 2026 })).includes(ids.yearEndLast));
    });

    it("year only, month only (the current Qatar year) and all months / all years", () => {
      const year2026 = query({ year: 2026, size: 100 });
      assert.deepEqual(year2026.filters.year, 2026);
      assert.equal(year2026.filters.month, null);
      assert.equal(year2026.total, model(all, { year: 2026 }, currentYear).total);
      const all2025 = query({ year: 2025, size: 100 });
      assert.equal(all2025.total, model(all, { year: 2025 }, currentYear).total);
      assert.equal(year2026.total + all2025.total, all.length, "every order is in exactly one of the two years");
      // A month with no year means that month of the current Qatar year, and the answer says which year it applied.
      const march = query({ month: 3, size: 100 });
      assert.equal(march.filters.year, currentYear);
      assert.equal(march.filters.month, 3);
      assert.equal(march.total, model(all, { month: 3 }, currentYear).total);
      assert.equal(query({ size: 100 }).total, all.length, "no period at all: every order, any date");
    });

    it("the years offered are the years in which orders were placed (and the current year), newest first", () => {
      const { years } = query();
      assert.deepEqual(years, [...new Set([2025, 2026, currentYear])].sort((a, b) => b - a));
    });

    it("a custom range is inclusive at BOTH ends, in Qatar days: 1 Nov to 30 Nov 2026 takes the first and the last second of November, and not the seconds outside it", () => {
      const r = query({ search: "Carol", from: "2026-11-01", to: "2026-11-30", sort: "oldest", size: 25 });
      assert.deepEqual(idsOf(r), [ids.novFirst, ids.novLast]);
      const oneDay = query({ search: "Carol", from: "2026-11-01", to: "2026-11-01", size: 25 });
      assert.deepEqual(idsOf(oneDay), [ids.novFirst], "a single day is a range of one day");
      const dayBefore = query({ search: "Carol", from: "2026-10-31", to: "2026-10-31", size: 25 });
      assert.deepEqual(idsOf(dayBefore), [ids.octLast]);
    });

    it("an open-ended range: only a start date, or only an end date", () => {
      const fromOnly = query({ search: "Carol", from: "2026-11-01", sort: "oldest", size: 25 });
      assert.deepEqual(idsOf(fromOnly), [ids.novFirst, ids.novLast, ids.decFirst], "1 November 2026 onwards");
      const toOnly = query({ search: "Carol", to: "2025-12-31", sort: "oldest", size: 25 });
      assert.deepEqual(idsOf(toOnly), [ids.yearEndLast], "up to and including 31 December 2025");
    });

    it("a custom range takes precedence over the month and the year, and the answer says the month and year were ignored", () => {
      const r = query({ search: "Carol", year: 2025, month: 1, from: "2026-11-01", to: "2026-11-30", sort: "oldest", size: 25 });
      assert.deepEqual(idsOf(r), [ids.novFirst, ids.novLast]);
      assert.equal(r.filters.range_overrides_period, true);
      assert.equal(r.filters.year, null);
      assert.equal(r.filters.month, null);
      assert.equal(r.filters.from, "2026-11-01");
      assert.equal(r.filters.to, "2026-11-30");
      assert.equal(query({ from: "2026-11-01", size: 5 }).filters.range_overrides_period, false, "a range alone overrides nothing");
    });

    it("invalid choices are refused with a message a person can act on", () => {
      const refused = (args, pattern) => {
        const r = db.run(`${AS.sam}select admin.list_orders_page(null, null, ${lit(args.year ?? null)}, ${lit(args.month ?? null)}, ${lit(args.from ?? null)}::date, ${lit(args.to ?? null)}::date, 'newest', 1, 5);`);
        assert.equal(r.ok, false, JSON.stringify(args));
        assert.match(r.err, pattern, JSON.stringify(args));
      };
      refused({ from: "2026-11-25", to: "2026-11-10" }, /start date must not be after the end date/);
      refused({ month: 13 }, /month must be 1 to 12/);
      refused({ month: 0 }, /month must be 1 to 12/);
      refused({ year: 1999 }, /year must be between 2020 and 2100/);
      refused({ from: "2019-12-31" }, /dates must be between 2020 and 2100/);
      refused({ to: "2101-01-01" }, /dates must be between 2020 and 2100/);
    });
  });

  // ===================================================================================================================
  describe("search, status and all of them together", () => {
    it("search matches the order number, the customer name or the customer code, and a % or _ in it is just a character", () => {
      const ref = all.find((r) => r.name.startsWith("Carol")).ref;
      assert.equal(query({ search: ref }).total, 1);
      assert.equal(query({ search: ref.toLowerCase() }).total, 1, "not case sensitive");
      assert.equal(query({ search: "carol" }).total, 8);
      const code = all.find((r) => r.name.startsWith("Carol")).code;
      assert.equal(query({ search: code }).total, 8);
      assert.equal(query({ search: "%" }).total, 0, "a percent sign is not a wildcard");
      assert.equal(query({ search: "_" }).total, 0, "an underscore is not a wildcard");
      assert.equal(query({ search: "\\" }).total, 0);
    });

    it("a status is exact, and the earlier-workflow codes are accepted as they were", () => {
      const waiting = query({ status: "awaiting_deposit", size: 100 });
      assert.equal(waiting.total, all.filter((r) => r.status === "awaiting_deposit").length);
      assert.ok(waiting.rows.every((r) => r.status === "awaiting_deposit"));
      assert.equal(query({ status: "sourcing", size: 100 }).total, 0);
    });

    it("November 2026 + a status + highest price first + a search work together", () => {
      const r = query({ year: 2026, month: 11, status: "awaiting_deposit", sort: "price_desc", size: 25 });
      assert.deepEqual(idsOf(r), model(all, { year: 2026, month: 11, status: "awaiting_deposit", sort: "price_desc", size: 25 }, currentYear).ids);
      assert.ok(r.rows.every((x) => x.status === "awaiting_deposit"));
      const c = query({ search: "alice", from: "2026-03-01", to: "2026-09-30", sort: "newest", size: 25 });
      assert.deepEqual(idsOf(c), model(all, { search: "alice", from: "2026-03-01", to: "2026-09-30", size: 25 }, currentYear).ids);
      const none = query({ sort: "price_asc", size: 25 });
      assert.deepEqual(idsOf(none), model(all, { sort: "price_asc", size: 25 }, currentYear).ids, "no dates, lowest price first");
    });

    it("nothing matches: a clean empty answer, never an error", () => {
      const r = query({ search: "no such customer anywhere" });
      assert.equal(r.total, 0);
      assert.deepEqual(r.rows, []);
      assert.equal(r.pages, 1);
      assert.equal(r.page, 1);
      assert.equal(r.first, 0);
      assert.equal(r.last, 0);
    });

    it("DIFFERENTIAL: 90 combinations of choices are answered by the database and by an independent model, and agree on the count, the page and every id in order", () => {
      let seed = 20261125;
      const rand = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const pick = (list) => list[rand(list.length)];
      const days = ["2025-11-15", "2025-12-31", "2026-01-01", "2026-03-06", "2026-06-15", "2026-10-31", "2026-11-01", "2026-11-30", "2026-12-01", "2026-12-31"];
      let checked = 0;
      for (let i = 0; i < 90; i += 1) {
        const args = { size: pick([5, 10, 25]), sort: pick(["newest", "oldest", "price_asc", "price_desc"]), page: pick([1, 1, 2, 3, 7, 999]) };
        if (rand(3) === 0) args.search = pick(["carol", "alice", "bob", "O-", "0001", "zzz", "test"]);
        if (rand(3) === 0) args.status = pick(["awaiting_deposit", "on_hold", "pending_confirmation", "delivered"]);
        const kind = rand(6);
        if (kind === 1) args.year = pick([2025, 2026]);
        else if (kind === 2) Object.assign(args, { year: pick([2025, 2026]), month: 1 + rand(12) });
        else if (kind === 3) args.month = 1 + rand(12);
        else if (kind === 4) {
          const a = pick(days);
          const b = pick(days);
          Object.assign(args, { from: a < b ? a : b, to: a < b ? b : a });
        } else if (kind === 5) {
          if (rand(2)) args.from = pick(days);
          else args.to = pick(days);
          if (rand(3) === 0) Object.assign(args, { year: 2025, month: 6 });
        }
        const got = query(args);
        const want = model(all, args, currentYear);
        const label = JSON.stringify(args);
        assert.equal(got.total, want.total, `total: ${label}`);
        assert.equal(got.pages, want.pages, `pages: ${label}`);
        assert.equal(got.page, want.page, `page: ${label}`);
        assert.deepEqual(idsOf(got), want.ids, `ids: ${label}`);
        assert.equal(got.filters.range_overrides_period, want.byRange && (args.year != null || args.month != null), `override flag: ${label}`);
        assert.equal(got.filters.year, want.yearEff, `effective year: ${label}`);
        assert.equal(got.filters.month, want.monthEff, `effective month: ${label}`);
        checked += 1;
      }
      assert.equal(checked, 90);
    });
  });

  // ===================================================================================================================
  describe("paging over more than 100 orders", () => {
    it("every order is on exactly one page of 5; the last page holds the remainder; going past the end returns the last page", () => {
      const first = query();
      const pages = Math.ceil(all.length / 5);
      const remainder = all.length - 5 * (pages - 1);
      assert.equal(first.total, all.length);
      assert.equal(first.pages, pages);
      const last = query({ page: pages });
      assert.equal(last.rows.length, remainder);
      assert.equal(last.first, 5 * (pages - 1) + 1);
      assert.equal(last.last, all.length);
      const beyond = query({ page: 5000 });
      assert.equal(beyond.page, pages, "a page past the end is moved back to the last page");
      assert.deepEqual(idsOf(beyond), idsOf(last));
      const zero = query({ page: 0 });
      assert.equal(zero.page, 1, "page 0 is page 1");
      const walked = walk({}, 5);
      assert.equal(walked.length, all.length);
      assert.equal(new Set(walked).size, all.length);
      assert.ok(all.length > 100, "more than 100 orders, all reachable");
    });

    it("the page size is respected and capped (5, 10 and 25 are what the screen offers; the database allows up to 100)", () => {
      assert.equal(query({ size: 10 }).rows.length, 10);
      assert.equal(query({ size: 25 }).rows.length, 25);
      assert.equal(query({ size: 100 }).rows.length, 100);
      assert.equal(query({ size: 100000 }).page_size, 100);
      assert.equal(query({ size: 0 }).page_size, 1);
      const page2 = query({ size: 10, page: 2 });
      assert.equal(page2.first, 11);
      assert.equal(page2.last, 20);
    });

    it("the last page of a filtered list says exactly which rows it shows", () => {
      const r = query({ year: 2026, month: 3, size: 5, page: 99 });
      const m = model(all, { year: 2026, month: 3, size: 5, page: 99 }, currentYear);
      assert.equal(r.total, m.total);
      assert.equal(r.first, (m.page - 1) * 5 + 1);
      assert.equal(r.last, Math.min(m.page * 5, m.total));
    });
  });

  // ===================================================================================================================
  describe("the list is independent of the completion-date financial report", () => {
    it("an order placed in October and completed in November is in the October list and in the November REPORT, and filtering the list changes nothing in the report", () => {
      const id = ids.s1;
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      const net = Number(read(`select net_payable_minor from public.orders where id = '${id}'`));
      commit(`select admin.record_payment('${id}', 'balance', ${net}, 'cash');`);
      for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
      rewrite(`update public.orders set created_at = '2026-10-10T09:00:00Z', completed_at = '2026-11-12T09:00:00Z' where id = '${id}';
               update private.order_completions set completed_at = '2026-11-12T09:00:00Z' where order_id = '${id}';`);
      const reportOf = () => JSON.parse(lines(db.ok("select admin.financial_report(2026, 11)::text;", AS.olivia)).pop());
      const before = reportOf();
      assert.ok(before.period.net_revenue_minor >= net, "the November report counts the order by its COMPLETION date");
      const inOctober = query({ year: 2026, month: 10, size: 100 });
      const inNovember = query({ year: 2026, month: 11, size: 100 });
      assert.ok(idsOf(inOctober).includes(id), "the list is by the date PLACED: October");
      assert.ok(!idsOf(inNovember).includes(id), "...so it is not in the November list");
      // Whatever the list is asked, the report (and the completed-order list) are byte for byte the same.
      for (const args of [{ year: 2026, month: 10 }, { from: "2026-11-01" }, { sort: "price_desc", status: "delivered" }, { search: "zzz" }]) query(args);
      assert.deepEqual(reportOf(), before);
      const completed = JSON.parse(lines(db.ok("select admin.list_completed_orders(2026, 11, 50, 0)::text;", AS.olivia)).pop());
      assert.ok(completed.rows.some((r) => r.id === id), "the completed-orders function (kept, though the Orders page no longer draws it) still answers by completion date");
    });
  });

  // ===================================================================================================================
  describe("who may call it", () => {
    it("signed-in staff with a verified second factor can; a customer, an anonymous caller, a deactivated staff member and an owner without the second factor cannot", () => {
      assert.equal(query({}, AS.sam).total, query({}, AS.olivia).total, "ordinary staff and the owner see the same list (it holds no private data)");
      const refused = (who, pattern) => {
        const r = db.run(`${who}select admin.list_orders_page();`);
        assert.equal(r.ok, false);
        assert.match(r.err, pattern);
      };
      refused(AS.alice, /permission denied: orders\.read is required/);
      refused(AS.dana, /permission denied: orders\.read is required/);
      refused(AS.oliviaAal1, /permission denied: orders\.read is required/);
      refused(AS.anon, /permission denied/);
      refused(AS.service, /permission denied/);
    });

    it("the function is executable by the signed-in role and the staff gateway only", () => {
      const row = JSON.parse(
        read(`select jsonb_build_object('anon', has_function_privilege('anon', '${FN}', 'execute'), 'public', has_function_privilege('public', '${FN}', 'execute'),
                  'service', has_function_privilege('service_role', '${FN}', 'execute'), 'authenticated', has_function_privilege('authenticated', '${FN}', 'execute'),
                  'gateway', has_function_privilege('m1_staff_gateway', '${FN}', 'execute'), 'secdef', (select prosecdef from pg_proc where oid = '${FN}'::regprocedure),
                  'stable', (select provolatile from pg_proc where oid = '${FN}'::regprocedure))::text`),
      );
      assert.deepEqual(row, { anon: false, public: false, service: false, authenticated: true, gateway: true, secdef: true, stable: "s" });
    });
  });

  // ===================================================================================================================
  describe("the migration is additive, rerunnable and leaves the earlier list alone", () => {
    it("it adds exactly one function and changes nothing else: every other function, table, column, index and constraint is identical to the database without it", () => {
      const fingerprint = (database) =>
        JSON.parse(
          lines(
            database.ok(
              `select jsonb_build_object(
                 'functions', (select jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(pg_get_functiondef(p.oid)))
                               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname in ('admin', 'private', 'public') and p.prokind in ('f', 'p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
                 'columns', (select md5(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_schema, table_name, column_name))
                             from information_schema.columns where table_schema in ('public', 'private')),
                 'indexes', (select md5(string_agg(schemaname || '.' || indexname || ':' || indexdef, '|' order by schemaname, indexname)) from pg_indexes where schemaname in ('public', 'private')),
                 'constraints', (select md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), '|' order by conrelid::regclass::text, conname)) from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace)),
                 'triggers', (select md5(string_agg(tgrelid::regclass::text || '.' || tgname, '|' order by tgrelid::regclass::text, tgname)) from pg_trigger where not tgisinternal),
                 'policies', (select md5(string_agg(schemaname || '.' || tablename || '.' || policyname, '|' order by schemaname, tablename, policyname)) from pg_policies))::text;`,
            ),
          ).pop(),
        );
      const without = startDatabase({ schedule: "confirmed", before: MIGRATION });
      seedIdempotencyFixtures(without); // the same test helper functions this suite installed, so only the migration differs
      try {
        const a = fingerprint(without);
        const b = fingerprint(db);
        const added = Object.keys(b.functions).filter((k) => !(k in a.functions));
        const changed = Object.keys(a.functions).filter((k) => a.functions[k] !== b.functions[k]);
        const removed = Object.keys(a.functions).filter((k) => !(k in b.functions));
        assert.deepEqual(added, ["admin.list_orders_page(p_search text, p_status text, p_year integer, p_month integer, p_from date, p_to date, p_sort text, p_page integer, p_page_size integer)"]);
        assert.deepEqual(changed, [], "no existing function was replaced (admin.list_orders included)");
        assert.deepEqual(removed, []);
        for (const k of ["columns", "indexes", "constraints", "triggers", "policies"]) assert.equal(b[k], a[k], `${k} are unchanged`);
      } finally {
        without.stop();
      }
    });

    it("the earlier admin.list_orders still answers as before (status, search, limit and offset), for the website that is live today", () => {
      const rows = JSON.parse(lines(db.ok("select admin.list_orders(null, 'carol', 3, 1)::text;", AS.sam)).pop());
      assert.equal(rows.length, 3);
      assert.ok(rows.every((r) => r.customer_name.startsWith("Carol")));
      assert.ok(!("rn" in rows[0]));
    });

    it("running the migration a second time succeeds and changes nothing (rerunnable)", () => {
      const sql = readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8");
      const before = query({ sort: "price_desc", size: 25 });
      const result = db.cluster.psql(sql);
      assert.ok(result.ok, result.err);
      assert.deepEqual(query({ sort: "price_desc", size: 25 }), before);
    });
  });
});
