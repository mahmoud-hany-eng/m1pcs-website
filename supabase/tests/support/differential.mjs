// The scripted earlier-workflow scenario and the read comparison shared by the DIFFERENTIAL compatibility tests
// (compat.differential.db.test.mjs for the workflow migrations, compat.pricing.differential.db.test.mjs for the pricing migrations).
// It runs ONE fixed script of the business operations the deployed website performs against a database, and records what happened.
import { AS, ID, json } from "../fixtures.mjs";

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TS = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?|Z)?/g;
export const norm = (s) => String(s).replace(UUID, "<uuid>").replace(TS, "<ts>");
export const lines = (out) => out.split("\n").filter((l) => l !== "");
export const one = (price) => [{ kind: "component", description: "Differential test item", quantity: 1, unit_price_minor: price }];

/** Runs the scripted earlier-workflow scenario against one database and returns what happened, in order. */
export function scenario(db) {
  const T = [];
  const run = (who, sql) => db.cluster.psql(`begin;\n${who}${sql}\ncommit;`);
  const firstError = (err) => (err.split("\n").find((l) => /ERROR:/.test(l)) ?? err.split("\n")[0]).replace(/^psql:<stdin>:\d+:\s*/, "");
  /** One step: records its outcome (normalised) and returns the raw last line of output on success, else null. */
  const step = (label, who, sql) => {
    const r = run(who, sql);
    const raw = r.ok ? (lines(r.out).pop() ?? "").trim() : null;
    T.push(`${label} => ${r.ok ? `OK ${norm(raw)}` : `ERR ${norm(firstError(r.err))}`}`);
    return raw;
  };
  const q = (sql, who = AS.superuser) => (lines(db.ok(sql.endsWith(";") ? sql : `${sql};`, who)).pop() ?? "").trim();

  const pay = (label, who, id, purpose, amount, method, extra = "") => step(label, who, `select admin.record_payment('${id}', '${purpose}', ${amount}, '${method}'${extra});`);
  const keyedPay = (label, who, id, amount, key, expected) =>
    step(label, who, `select admin.record_payment('${id}', 'deposit', ${amount}, 'cash', null, null, null, null, '${key}', ${expected});`);
  const move = (label, who, id, to) => step(label, who, `select admin.transition_order('${id}', '${to}', 'differential');`);
  const keyedOrder = (label, who, key, price) => step(label, who, `select admin.create_order('${ID.custA}', '${json(one(price))}'::jsonb, null, 'admin', null, null, '${key}');`);

  // ---- order A: the whole earlier path, money, loyalty ---------------------------------------------------------------------
  const a = keyedOrder("A create (keyed)", AS.sam, "diff-order-A-0001", 200000);
  keyedOrder("A create again, same key (a repeat)", AS.sam, "diff-order-A-0001", 200000);
  keyedOrder("A create, same key, different items (a conflict)", AS.sam, "diff-order-A-0001", 999900);
  step("A create as a customer", AS.alice, `select admin.create_order('${ID.custA}', '${json(one(1000))}'::jsonb, null, 'admin', null, null, 'diff-customer-key');`);
  step("A create as inactive staff", AS.dana, `select admin.create_order('${ID.custA}', '${json(one(1000))}'::jsonb, null, 'admin', null, null, 'diff-dana-key');`);
  step("A create without the second factor", AS.oliviaAal1, `select admin.create_order('${ID.custA}', '${json(one(1000))}'::jsonb, null, 'admin', null, null, 'diff-aal1-key');`);
  step("A create with no priced item", AS.sam, `select admin.create_order('${ID.custA}', '[]'::jsonb, null, 'admin', null, null, 'diff-empty-key');`);
  const keyless = step("A create (earlier key-less signature)", AS.sam, `select admin.create_order('${ID.custA}', '${json(one(100000))}'::jsonb);`);
  step("similar orders (read-only evidence)", AS.sam, `select count(*) from admin.similar_orders('${ID.custA}', '${json(one(200000))}'::jsonb, 'diff-similar-key');`);
  move("A awaiting_deposit", AS.sam, a, "awaiting_deposit");
  move("A skip to building (invalid)", AS.sam, a, "building");
  move("A deposit_received with nothing paid (gate)", AS.sam, a, "deposit_received");
  move("A move as a customer", AS.alice, a, "deposit_received");
  keyedPay("A pay 100.00 keyed", AS.olivia, a, 10000, "diff-pay-A-0001", 0);
  keyedPay("A pay again, same key (a repeat)", AS.olivia, a, 10000, "diff-pay-A-0001", 0);
  keyedPay("A pay, same key, other amount (a conflict)", AS.olivia, a, 12345, "diff-pay-A-0001", 0);
  keyedPay("A pay with a stale expected amount", AS.olivia, a, 5000, "diff-pay-A-0002", 0);
  pay("A pay as staff (no payments.record)", AS.sam, a, "deposit", 5000, "cash");
  pay("A pay as a customer", AS.alice, a, "deposit", 5000, "cash");
  pay("A pay beyond the total", AS.olivia, a, "balance", 999999999, "cash");
  pay("A pay zero", AS.olivia, a, "deposit", 0, "cash");
  pay("A pay 200.00 (earlier key-less 8-argument signature)", AS.olivia, a, "deposit", 20000, "fawran", ", now(), null, 'diff reference', 'diff note'");
  move("A deposit_received", AS.sam, a, "deposit_received");
  for (const to of ["sourcing", "in_transit", "building", "quality_check", "building", "quality_check", "ready_for_delivery"]) move(`A ${to}`, AS.sam, a, to);
  move("A delivered with a balance still due", AS.sam, a, "delivered");
  step("A loyalty ledger entries (expect none: balance due)", AS.superuser, `select count(*) from public.loyalty_ledger where order_id = '${a}';`);
  pay("A pay the balance", AS.olivia, a, "balance", 170000, "cash");
  step("A loyalty ledger after the balance (one award)", AS.superuser, `select string_agg(entry_type || ':' || points, ',') from public.loyalty_ledger where order_id = '${a}';`);
  step("A award by hand (idempotent)", AS.olivia, `select admin.award_loyalty_for_order('${a}') is null;`);
  step("A loyalty ledger after the second award", AS.superuser, `select count(*) from public.loyalty_ledger where order_id = '${a}';`);
  step("loyalty adjustment keyed", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', 50, 'goodwill', 'diff-loyalty-0001') is not null;`);
  step("loyalty adjustment again, same key", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', 50, 'goodwill', 'diff-loyalty-0001') is not null;`);
  step("loyalty adjustment, same key, other points", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', 70, 'goodwill', 'diff-loyalty-0001') is not null;`);
  step("loyalty adjustment as staff", AS.sam, `select admin.adjust_loyalty('${ID.custA}', 5, 'x', 'diff-loyalty-0002') is not null;`);
  step("loyalty adjustment below zero", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', -100000, 'too much', 'diff-loyalty-0003') is not null;`);
  step("A reverse the balance payment", AS.olivia, `select admin.reverse_payment((select id from public.payments where order_id = '${a}' and purpose = 'balance' and entry_type = 'payment'), 'differential reversal') is not null;`);
  step("A paid amount after the reversal", AS.superuser, `select amount_paid_minor from public.orders where id = '${a}';`);

  // ---- tracking (earlier signature) ---------------------------------------------------------------------------------------
  const ev = step("A publish tracking (earlier four-argument signature)", AS.sam, `select admin.publish_tracking_event('${a}', 'Differential update', 'message', 'in_transit');`);
  step("A publish tracking with an empty title", AS.sam, `select admin.publish_tracking_event('${a}', '', 'message', null);`);
  step("A publish tracking as a customer", AS.alice, `select admin.publish_tracking_event('${a}', 'x', null, null);`);
  step("A publish tracking as inactive staff", AS.dana, `select admin.publish_tracking_event('${a}', 'x', null, null);`);
  step("A publish tracking on an unknown order", AS.sam, `select admin.publish_tracking_event('00000000-0000-4000-8000-00000000ffff', 'x', null, null);`);
  step("A withdraw the update", AS.sam, `select admin.retract_tracking_event('${ev}', 'differential withdrawal');`);
  step("A withdraw it again", AS.sam, `select admin.retract_tracking_event('${ev}', 'again');`);
  step("A withdraw without a reason", AS.sam, `select admin.retract_tracking_event('${ev}', '');`);

  // ---- order B: hold, resume, cancel -------------------------------------------------------------------------------------------
  const b = keyless;
  move("B awaiting_deposit", AS.sam, b, "awaiting_deposit");
  pay("B pay the deposit", AS.olivia, b, "deposit", 15000, "cash");
  for (const to of ["deposit_received", "sourcing", "on_hold"]) move(`B ${to}`, AS.sam, b, to);
  move("B resume at the wrong status", AS.sam, b, "in_transit");
  move("B resume at the right status", AS.sam, b, "sourcing");
  move("B hold again", AS.sam, b, "on_hold");
  move("B cancel while held", AS.sam, b, "cancelled");
  pay("B pay on a cancelled order", AS.olivia, b, "balance", 100, "cash");
  move("B leave cancelled", AS.sam, b, "awaiting_deposit");
  move("B an unknown status", AS.sam, b, "no_such_status");

  // ---- order C: left on hold, for the read comparison ------------------------------------------------------------------------------
  const c = keyedOrder("C create (keyed)", AS.sam, "diff-order-C-0001", 50000);
  move("C awaiting_deposit", AS.sam, c, "awaiting_deposit");
  pay("C pay the deposit", AS.olivia, c, "deposit", 7500, "cash");
  for (const to of ["deposit_received", "sourcing", "in_transit", "on_hold"]) move(`C ${to}`, AS.sam, c, to);

  // ---- the rows that resulted (every id and timestamp normalised, every amount, reference, status and message kept) ------------------
  const digest = (label, sql) => T.push(`STATE ${label}: ${norm(q(sql))}`);
  digest("orders", "select string_agg(order_ref || ':' || status || ':' || total_minor || ':' || deposit_required_minor || ':' || amount_paid_minor || ':' || balance_due_minor || ':' || coalesce(deposit_rate_bps::text, '-') || ':' || coalesce(deposit_gate_status, '-'), ' | ' order by order_ref) from public.orders where order_ref in (select order_ref from public.orders where created_at > now() - interval '1 hour') and id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("payments", "select string_agg(o.order_ref || ':' || p.entry_type || ':' || p.purpose || ':' || p.amount_minor || ':' || p.method || ':' || p.receipt_number, ' | ' order by p.receipt_number, p.id) from public.payments p join public.orders o on o.id = p.order_id where o.id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("history", "select string_agg(o.order_ref || ':' || coalesce(h.from_status, '-') || '>' || h.to_status || ':' || coalesce(h.reason, '-'), ' | ' order by o.order_ref, h.id) from private.order_status_history h join public.orders o on o.id = h.order_id where o.id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("tracking", "select string_agg(o.order_ref || ':' || e.title || ':' || coalesce(e.status_code, '-') || ':' || (r.event_id is not null), ' | ' order by o.order_ref, e.published_at, e.id) from public.order_tracking_events e join public.orders o on o.id = e.order_id left join private.tracking_event_retractions r on r.event_id = e.id where o.id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("loyalty", "select string_agg(entry_type || ':' || points || ':' || coalesce(description, '-'), ' | ' order by created_at, id) from public.loyalty_ledger");
  digest("audit actions", "select string_agg(action || ':' || n, ' | ' order by action) from (select action, count(*) n from private.audit_log group by action) s");
  digest("idempotency keys", "select count(*) || ':' || count(distinct operation) from private.idempotency_keys");
  return { T, ids: { a, b, c } };
}

/** What the read functions answer, with the intentional wording and additive keys removed. */
export function reads(db, ids) {
  const json = (sql, who) => JSON.parse(lines(db.ok(`${sql}::text;`, who)).pop());
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) if (!["label", "status_label"].includes(k)) out[k] = strip(x);
      return out;
    }
    return v;
  };
  const view = (sql, who) => strip(json(sql, who));
  return {
    getA: view(`select admin.get_order('${ids.a}')`, AS.olivia),
    getB: view(`select admin.get_order('${ids.b}')`, AS.sam),
    getC: view(`select admin.get_order('${ids.c}')`, AS.sam),
    list: view("select admin.list_orders(null, null, 100, 0)", AS.sam),
    listHeld: view("select admin.list_orders('on_hold', null, 100, 0)", AS.sam),
    dash: view("select admin.dashboard_summary()", AS.olivia),
    dashStaff: view("select admin.dashboard_summary()", AS.sam),
  };
}

