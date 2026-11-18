// Database tests, run against a REAL PostgreSQL 16 server that the harness starts and removes. They execute the
// migrations, the row level security policies, the constraints and the staff functions for real.
//
// What this proves, and what it does not (details in supabase/README.md and REAL_SUPABASE_CHECKS.md):
//   PROVEN LOCALLY   migrations apply in order; constraints; RLS isolation between customers; the privilege model;
//                    finance data staying out of customer reach; status transitions; ledgers and idempotency;
//                    staff permissions; the MFA rule given an aal claim; claim codes.
//   NEEDS A REAL SUPABASE PROJECT   GoTrue issuing real tokens and the aal claim, PostgREST exposing the schemas,
//                    Realtime, the dashboard settings, the Supabase CLI. The shim only imitates the roles and
//                    auth.uid()/auth.jwt().
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, SENTINEL, itemsA, json, newOrder, startDatabase } from "./fixtures.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") {
  throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
}
const suite = haveServer ? describe : describe.skip;
if (!haveServer) console.warn("SKIPPED: no PostgreSQL server programs found; database tests need initdb, pg_ctl and psql");

const ledgerSql = (oid) => `(select count(*) from public.loyalty_ledger where order_id = :'${oid}')`;

/** Pays an order in full and walks it to a delivered status as the owner. Needs :'oid' (or another variable). */
function deliver(variable, total) {
  return `${AS.olivia}
    select admin.record_payment(:'${variable}', 'deposit', ${total}, 'cash');
    select admin.transition_order(:'${variable}', 'awaiting_deposit');
    select admin.transition_order(:'${variable}', 'deposit_received');
    select admin.transition_order(:'${variable}', 'sourcing');
    select admin.transition_order(:'${variable}', 'building');
    select admin.transition_order(:'${variable}', 'quality_check');
    select admin.transition_order(:'${variable}', 'ready_for_delivery');
    select admin.transition_order(:'${variable}', 'delivered');
  `;
}
const oneItem = (price, qty = 1, kind = "component") => [{ kind, description: "Test item", quantity: qty, unit_price_minor: price }];

suite("database (real PostgreSQL, Supabase-compatible roles)", () => {
  let db;
  before(() => {
    db = startDatabase();
  });
  after(() => db?.stop());

  // =================================================================================================================
  describe("migrations and the security audit", () => {
    it("applies every migration in order and the security audit reports no violation", () => {
      assert.equal(db.ok("select count(*) from private.security_audit();"), "0");
    });

    it("the audit is not vacuous: an API role granted a private table is reported", () => {
      const out = db.ok("grant select on private.staff_members to authenticated; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /api_role_has_private_privilege authenticated on private\.staff_members/);
    });

    it("the audit reports a table without row level security", () => {
      const out = db.ok("alter table public.orders disable row level security; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /rls_disabled public\.orders/);
    });

    it("the audit reports a writable ledger", () => {
      const out = db.ok("grant insert on public.payments to service_role; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /ledger_or_order_table_writable service_role on public\.payments/);
    });

    it("the audit reports a definer function with no pinned search_path", () => {
      const out = db.ok("create function admin.leaky() returns int language sql security definer as $$ select 1 $$; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /definer_function_without_search_path admin\.leaky/);
    });

    it("the audit reports a function that anonymous visitors can execute", () => {
      const out = db.ok("create function admin.open_door() returns int language sql set search_path = '' as $$ select 1 $$; grant execute on function admin.open_door() to anon; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /anon_can_execute_function admin\.open_door/);
    });

    it("the audit reports a cost-like column in a customer-facing table", () => {
      const out = db.ok("alter table public.order_items add column supplier_price bigint; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /sensitive_column_in_public order_items\.supplier_price/);
    });

    it("the audit reports anonymous access to a customer table", () => {
      const out = db.ok("grant select on public.customers to anon; select check_name || ' ' || detail from private.security_audit();");
      assert.match(out, /anon_has_privilege public\.customers/);
    });

    it("every table in public and private has row level security enabled", () => {
      assert.equal(db.ok(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname in ('public','private') and not c.relrowsecurity;`), "0");
    });

    it("the whole customer-visible surface is exactly this set of tables and views", () => {
      assert.equal(
        db.ok("select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema = 'public';"),
        "customer_accounts,customers,loyalty_balances,loyalty_ledger,order_items,order_statuses,order_tracking_events,orders,payments,quotation_lines,quotations,quote_categories",
      );
    });

    it("the columns of each customer-facing table are exactly the reviewed contract (a new column needs a deliberate review)", () => {
      const expected = {
        customers: "created_at,customer_code,delivery_address,email,full_name,id,marketing_consent,phone,preferred_language,source,updated_at",
        customer_accounts: "customer_id,linked_at,linked_via,user_id",
        quotations: "additional_notes,category,created_at,customer_id,guest_email,guest_name,guest_phone,id,product_preference,quantity,quote_ref,quoted_total_minor,requested_budget_minor,requested_specs,source,specific_model,status,updated_at,valid_until",
        quotation_lines: "description,id,line_total_minor,position,quantity,quotation_id,unit_price_minor",
        orders: "amount_paid_minor,balance_due_minor,created_at,currency,customer_id,delivery_address,delivery_method,deposit_required_minor,id,order_ref,placed_via,quotation_id,status,total_minor,updated_at",
        order_items: "description,id,kind,line_total_minor,order_id,position,quantity,unit_price_minor",
        order_tracking_events: "id,message,order_id,published_at,status_code,title",
        payments: "amount_minor,created_at,currency,entry_type,id,method,order_id,purpose,receipt_number,received_at,reverses_payment_id",
        loyalty_ledger: "created_at,customer_id,description,entry_type,id,order_id,points,reverses_entry_id",
        loyalty_balances: "balance_points,customer_id,entries",
        order_statuses: "code,customer_description,customer_label,is_provisional,is_terminal,sort_order",
        quote_categories: "label,sort_order",
      };
      for (const [table, columns] of Object.entries(expected)) {
        assert.equal(
          db.ok(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = '${table}';`),
          columns,
          table,
        );
      }
    });

    it("the quote categories in the database are exactly the website's QUOTE_CATEGORIES", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(new URL("../../src/types/quote.ts", import.meta.url), "utf8");
      const block = source.match(/QUOTE_CATEGORIES = \[([\s\S]*?)\] as const/)[1];
      const labels = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const inDb = db.ok("select string_agg(label, '|' order by sort_order) from public.quote_categories;").split("|");
      assert.deepEqual(inDb, labels);
    });

    describe("typed interfaces match the database (src/lib/platform/database.types.ts)", () => {
      let source;
      before(async () => {
        const { readFileSync } = await import("node:fs");
        source = readFileSync(new URL("../../src/lib/platform/database.types.ts", import.meta.url), "utf8");
      });
      const interfaceProps = (name) => {
        const body = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
        assert.ok(body, `interface ${name} not found`);
        return [...body[1].matchAll(/^ {2}([a-z_]+)(\??): ([^;]+);/gm)].map((m) => ({ name: m[1], optional: m[2] === "?", type: m[3].trim() }));
      };
      const unionValues = (name) => {
        const m = source.match(new RegExp(`export type ${name} =\\s*([^;]+);`));
        assert.ok(m, `type ${name} not found`);
        return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
      };

      it("every public table and view has an interface with exactly the database's columns", () => {
        const map = source.match(/export interface PublicTables \{([\s\S]*?)\n\}/)[1];
        const tables = [...map.matchAll(/^ {2}([a-z_]+): ([A-Za-z]+);/gm)].map((m) => ({ table: m[1], iface: m[2] }));
        assert.equal(tables.length, 12);
        for (const { table, iface } of tables) {
          const typed = interfaceProps(iface).map((p) => p.name).sort().join(",");
          const real = db.ok(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = '${table}';`);
          assert.equal(typed, real, `${iface} vs public.${table}`);
        }
      });

      it("a column is nullable in TypeScript exactly when it is nullable in the database (generated columns are never null)", () => {
        const map = source.match(/export interface PublicTables \{([\s\S]*?)\n\}/)[1];
        for (const [, table, iface] of map.matchAll(/^ {2}([a-z_]+): ([A-Za-z]+);/gm)) {
          const real = db
            .ok(`select column_name || ':' || case when is_nullable = 'YES' and is_generated = 'NEVER' then 'null' else 'notnull' end
                 from information_schema.columns where table_schema = 'public' and table_name = '${table}' order by column_name;`)
            .split("\n");
          const typed = interfaceProps(iface)
            .map((p) => `${p.name}:${/\| null$/.test(p.type) ? "null" : "notnull"}`)
            .sort();
          assert.deepEqual(typed, real.sort(), `${iface} nullability vs public.${table}`);
        }
      });

      it("every money column is typed as MinorUnits, never as a bare number", () => {
        const map = source.match(/export interface PublicTables \{([\s\S]*?)\n\}/)[1];
        let seen = 0;
        for (const [, , iface] of map.matchAll(/^ {2}([a-z_]+): ([A-Za-z]+);/gm)) {
          for (const p of interfaceProps(iface).filter((x) => x.name.endsWith("_minor"))) {
            seen += 1;
            assert.match(p.type, /^MinorUnits( \| null)?$/, `${iface}.${p.name}`);
          }
        }
        assert.ok(seen >= 10, `expected to see at least ten money columns, saw ${seen}`);
      });

      it("each union type lists exactly the values the database CHECK constraint allows", () => {
        const pairs = [
          ["public.customers", "preferred_language", "PreferredLanguage"],
          ["public.customers", "source", "CustomerSource"],
          ["public.customer_accounts", "linked_via", "AccountLinkMethod"],
          ["public.quotations", "status", "QuotationStatus"],
          ["public.quotations", "source", "QuotationSource"],
          ["public.orders", "placed_via", "PlacedVia"],
          ["public.orders", "delivery_method", "DeliveryMethod"],
          ["public.order_items", "kind", "OrderItemKind"],
          ["public.payments", "entry_type", "PaymentEntryType"],
          ["public.payments", "purpose", "PaymentPurpose"],
          ["public.payments", "method", "PaymentMethod"],
          ["public.loyalty_ledger", "entry_type", "LoyaltyEntryType"],
          ["private.business_policies", "confirmation", "PolicyConfirmation"],
        ];
        for (const [table, column, typeName] of pairs) {
          // Only the CHECK that is about this one column: other, multi-column constraints mention it too.
          const defs = db.ok(`select string_agg(pg_get_constraintdef(c.oid), E'\\n') from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
            where c.conrelid = '${table}'::regclass and c.contype = 'c' and array_length(c.conkey, 1) = 1 and a.attname = '${column}';`);
          const match = defs.match(new RegExp(`\\b${column} = ANY \\(\\(?ARRAY\\[([^\\]]+)\\]`));
          assert.ok(match, `no CHECK ... ANY (ARRAY[...]) on ${table}.${column}`);
          const inDb = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
          assert.deepEqual(unionValues(typeName), inDb, `${typeName} vs ${table}.${column}`);
        }
      });

      it("the customer functions in TypeScript match the database signatures", () => {
        const block = source.match(/export interface CustomerFunctions \{([\s\S]*?)\n\}/)[1];
        const names = [...block.matchAll(/^ {2}([a-z_]+): \{/gm)].map((m) => m[1]).sort();
        const real = db
          .ok("select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';")
          .split(",");
        assert.deepEqual(names, real);
        for (const [fn, args] of [
          ["create_my_customer_profile", ["p_full_name", "p_phone", "p_email", "p_preferred_language"]],
          ["claim_customer_profile", ["p_code"]],
        ]) {
          const realArgs = db.ok(`select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${fn}';`);
          for (const arg of args) assert.match(realArgs, new RegExp(`\\b${arg}\\b`), `${fn}.${arg}`);
          assert.ok(source.includes(`${fn}: {`), fn);
          for (const arg of args) assert.ok(new RegExp(`\\b${arg}\\??:`).test(source), `types mention ${arg}`);
        }
      });
    });
  });

  // =================================================================================================================
  describe("constraints", () => {
    it("rejects bad customer data", () => {
      db.denied("insert into public.customers (full_name, phone) values ('A', 'not a phone');", AS.superuser, /customers_phone_check|check constraint/);
      db.denied("insert into public.customers (full_name, email) values ('A', 'no-at-sign');", AS.superuser, /customers_email_check|check constraint/);
      db.denied("insert into public.customers (full_name) values ('   ');", AS.superuser, /customers_full_name_check|check constraint/);
      db.denied("insert into public.customers (full_name, preferred_language) values ('A', 'fr');", AS.superuser, /check constraint/);
      db.denied("insert into public.customers (full_name, source) values ('A', 'carrier pigeon');", AS.superuser, /check constraint/);
    });

    it("customer_code and source never change after creation", () => {
      db.denied("update public.customers set customer_code = 'C-0000-00000' where id = :'custA';", AS.superuser, /cannot be changed/);
      db.denied("update public.customers set source = 'walk_in' where id = :'custA';", AS.superuser, /cannot be changed/);
    });

    it("a guest quotation must carry contact details", () => {
      db.denied("insert into public.quotations (category, product_preference) values ('Mouse', 'Not sure');", AS.superuser, /quotations_has_contact/);
      db.denied("insert into public.quotations (guest_name, category, product_preference) values ('G', 'Mouse', 'Not sure');", AS.superuser, /quotations_has_contact/);
    });

    it("a quotation asking for a specific model needs the model", () => {
      db.denied("insert into public.quotations (customer_id, category, product_preference) values (:'custA', 'Mouse', 'I want a specific model');", AS.superuser, /quotations_specific_model_required/);
    });

    it("a quotation price exists only once it is quoted, and a quoted quotation must have one", () => {
      db.denied("insert into public.quotations (customer_id, category, product_preference, quoted_total_minor) values (:'custA', 'Mouse', 'Not sure', 100);", AS.superuser, /quotations_price_only_when_quoted/);
      db.denied(`insert into public.quotations (id, customer_id, category, product_preference) values ('00000000-0000-4000-8000-0000000000e1', :'custA', 'Mouse', 'Not sure');
        update public.quotations set status = 'in_review' where id = '00000000-0000-4000-8000-0000000000e1';
        update public.quotations set status = 'quoted' where id = '00000000-0000-4000-8000-0000000000e1';`, AS.superuser, /quotations_quoted_needs_price/);
    });

    it("quotation statuses follow the allowed moves and 'converted' is never set by hand", () => {
      db.denied("update public.quotations set status = 'accepted' where id = '00000000-0000-4000-8000-0000000000d3';", AS.superuser, /cannot move from submitted to accepted/);
      db.denied("update public.quotations set status = 'converted' where id = '00000000-0000-4000-8000-0000000000d1';", AS.superuser, /cannot move from quoted to converted/);
      db.denied("insert into public.quotations (customer_id, category, product_preference, status) values (:'custA', 'Mouse', 'Not sure', 'quoted');", AS.superuser, /starts as submitted/);
    });

    it("quotation fields are bounded", () => {
      db.denied("insert into public.quotations (customer_id, category, product_preference, quantity) values (:'custA', 'Mouse', 'Not sure', 0);", AS.superuser, /check constraint/);
      db.denied("insert into public.quotations (customer_id, category, product_preference, requested_specs) values (:'custA', 'Mouse', 'Not sure', '[1]');", AS.superuser, /check constraint/);
      db.denied("insert into public.quotations (customer_id, category, product_preference) values (:'custA', 'Not A Category', 'Not sure');", AS.superuser, /foreign key/);
    });

    it("a quotation line total is computed, not supplied", () => {
      assert.equal(db.ok(`insert into public.quotation_lines (quotation_id, position, description, quantity, unit_price_minor)
        values ('00000000-0000-4000-8000-0000000000d3', 1, 'x', 3, 250) returning line_total_minor;`, AS.superuser).split("\n")[0], "750");
      db.denied("insert into public.quotation_lines (quotation_id, position, description, quantity, unit_price_minor, line_total_minor) values ('00000000-0000-4000-8000-0000000000d3', 1, 'x', 3, 250, 1);", AS.superuser, /generated column|cannot insert/);
    });

    it("orders only take QAR, never a negative total, and a deposit never exceeds the total", () => {
      const guard = "select private.set_write_ctx(true);\n";
      db.denied(`${guard}insert into public.orders (customer_id, currency) values (:'custA', 'USD');`, AS.superuser, /orders_currency_check/);
      db.denied(`${guard}insert into public.orders (customer_id, total_minor) values (:'custA', -1);`, AS.superuser, /orders_total_minor_check|orders_deposit_within_total/);
      db.denied(`${guard}insert into public.orders (customer_id, total_minor, deposit_required_minor) values (:'custA', 100, 101);`, AS.superuser, /orders_deposit_within_total/);
      db.denied(`${guard}insert into public.orders (customer_id, total_minor, amount_paid_minor) values (:'custA', 100, 101);`, AS.superuser, /orders_paid_within_total/);
    });

    it("the balance due is computed and always total minus paid", () => {
      assert.equal(db.ok("select balance_due_minor from public.orders where id = :'orderA';", AS.superuser), "300000");
    });

    it("an order item is a discount only with a price of zero or less, and any other kind never goes negative", () => {
      const out = db.ok(`${newOrder({ items: [...oneItem(100000), { kind: "discount", description: "Promo", quantity: 1, unit_price_minor: -10000 }], into: "d1" })}
        select total_minor from public.orders where id = :'d1';`);
      assert.equal(out.split("\n").pop(), "90000");
      db.denied(newOrder({ items: oneItem(-5) }), AS.olivia, /order_items_price_sign|check constraint/);
      db.denied(newOrder({ items: [{ kind: "discount", description: "x", quantity: 1, unit_price_minor: 5 }] }), AS.olivia, /order_items_price_sign|check constraint/);
    });

    it("payment entries have the right sign and every reversal points at a payment", () => {
      const guard = "select private.set_write_ctx(true);\n";
      db.denied(`${guard}insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderA', 'payment', 'deposit', -5, 'cash');`, AS.superuser, /payments_sign/);
      db.denied(`${guard}insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderA', 'reversal', 'deposit', -5, 'cash');`, AS.superuser, /payments_reversal_link/);
      db.denied(`${guard}insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderA', 'payment', 'deposit', 0, 'cash');`, AS.superuser, /amount_minor_check|payments_sign/);
      db.denied(`${guard}insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderA', 'payment', 'deposit', 5, 'bitcoin');`, AS.superuser, /payments_method_check/);
      db.denied(`${guard}insert into public.payments (order_id, entry_type, purpose, amount_minor, method, currency) values (:'orderA', 'payment', 'deposit', 5, 'cash', 'USD');`, AS.superuser, /payments_currency_check/);
    });

    it("the loyalty ledger enforces signs, an order on every award, and one award per order", () => {
      const guard = "select private.set_write_ctx(true);\n";
      db.denied(`${guard}insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values (:'custA', :'orderA', 'award', -3, 'x');`, AS.superuser, /loyalty_sign/);
      db.denied(`${guard}insert into public.loyalty_ledger (customer_id, entry_type, points, description) values (:'custA', 'award', 3, 'x');`, AS.superuser, /loyalty_award_has_order/);
      db.denied(`${guard}insert into public.loyalty_ledger (customer_id, entry_type, points, description) values (:'custA', 'adjustment', 0, 'x');`, AS.superuser, /points_check/);
      db.denied(`${guard}insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values (:'custA', :'orderA', 'award', 3, 'x');
        insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values (:'custA', :'orderA', 'award', 3, 'again');`, AS.superuser, /loyalty_one_award_per_order/);
    });

    it("business policies are validated when written", () => {
      db.denied(`insert into private.business_policies (key, value, description) values ('orders.deposit', '{"percent_bps": 20000, "minimum_minor": 0, "required_before_status": "x"}', 'twenty thousand basis points');`, AS.superuser, /duplicate key|business_policies_value_valid/);
      db.denied(`update private.business_policies set value = '{"percent_bps": 20000, "minimum_minor": 0, "required_before_status": "deposit_received"}', version = version + 1 where key = 'orders.deposit';`, AS.superuser, /business_policies_value_valid/);
      db.denied(`update private.business_policies set value = '{"percent_bps": "50", "minimum_minor": 0, "required_before_status": "deposit_received"}', version = version + 1 where key = 'orders.deposit';`, AS.superuser, /business_policies_value_valid/);
      db.denied(`update private.business_policies set value = '{"percent_bps": 5000, "minimum_minor": 0, "required_before_status": "deposit_received", "extra": 1}', version = version + 1 where key = 'orders.deposit';`, AS.superuser, /business_policies_value_valid/);
      db.denied(`insert into private.business_policies (key, value, description) values ('made.up', '{}', 'a policy nobody validates');`, AS.superuser, /business_policies_value_valid/);
    });

    it("every policy that the code reads exists, and only the two confirmed loyalty rates are marked confirmed", () => {
      assert.equal(db.ok("select string_agg(key, ',' order by key) from private.business_policies;", AS.superuser),
        "admin.mfa,loyalty.award_trigger,loyalty.earn_rate,loyalty.earning_base,loyalty.negative_balance,loyalty.point_value,orders.deposit,orders.full_payment");
      assert.equal(db.ok("select string_agg(key, ',' order by key) from private.business_policies where confirmation = 'confirmed_by_owner';", AS.superuser),
        "loyalty.earn_rate,loyalty.point_value");
    });

    it("every status named by a transition or a policy exists, and the status vocabulary is flagged provisional", () => {
      assert.equal(db.ok("select count(*) from private.order_status_transitions t left join public.order_statuses s on s.code = t.to_code where s.code is null;", AS.superuser), "0");
      assert.equal(db.ok("select count(*) from public.order_statuses where not is_provisional;", AS.superuser), "0");
    });
  });

  // =================================================================================================================
  describe("append-only ledgers and logs", () => {
    const cases = [
      ["payments", "update public.payments set amount_minor = 1;", "delete from public.payments;", "truncate public.payments;"],
      ["private.audit_log", "update private.audit_log set action = 'x';", "delete from private.audit_log;", "truncate private.audit_log;"],
      ["private.order_status_history", "update private.order_status_history set reason = 'x';", "delete from private.order_status_history;", "truncate private.order_status_history;"],
      ["private.business_policy_versions", "update private.business_policy_versions set reason = 'x';", "delete from private.business_policy_versions;", "truncate private.business_policy_versions;"],
      ["public.order_tracking_events", "update public.order_tracking_events set title = 'x';", "delete from public.order_tracking_events;", "truncate public.order_tracking_events;"],
      ["private.order_notes", "update private.order_notes set note = 'x';", "delete from private.order_notes;", null],
    ];
    for (const [table, update, del, truncate] of cases) {
      it(`${table} cannot be edited, deleted or truncated, even by the database owner`, () => {
        db.denied(update, AS.superuser, /append-only/);
        db.denied(del, AS.superuser, /append-only/);
        // A plain TRUNCATE may be refused earlier by a foreign key; the CASCADE form skips that rule, so it is the one
        // that proves the append-only trigger itself.
        if (truncate) {
          db.denied(truncate, AS.superuser, /append-only|cannot truncate a table referenced/);
          db.denied(truncate.replace(";", " cascade;"), AS.superuser, /append-only/);
        }
      });
    }

    it("the loyalty ledger cannot be edited or deleted, even by the database owner", () => {
      const make = `${newOrder({ items: oneItem(100000), into: "l1" })}${deliver("l1", 100000)}${AS.superuser}`;
      db.denied(`${make} update public.loyalty_ledger set points = 999;`, AS.superuser, /append-only/);
      db.denied(`${make} delete from public.loyalty_ledger;`, AS.superuser, /append-only/);
      db.denied(`${make} truncate public.loyalty_ledger cascade;`, AS.superuser, /append-only/);
    });
  });

  // =================================================================================================================
  describe("row level security: each customer sees only their own data", () => {
    const count = (table) => `select count(*) from ${table};`;

    it("a customer sees their own profile and no one else's", () => {
      assert.equal(db.ok("select string_agg(id::text, ',') from public.customers;", AS.alice), ID.custA);
      assert.equal(db.ok("select string_agg(id::text, ',') from public.customers;", AS.bob), ID.custB);
    });

    it("a signed-in user with no customer record sees nothing, even with the same contact email as a customer", () => {
      for (const table of ["customers", "customer_accounts", "orders", "order_items", "order_tracking_events", "payments", "quotations", "quotation_lines", "loyalty_ledger", "loyalty_balances"]) {
        assert.equal(db.ok(count(`public.${table}`), AS.eve), "0", table);
      }
    });

    it("a customer sees only their own orders, items, tracking updates and payments", () => {
      assert.equal(db.ok("select string_agg(id::text, ',') from public.orders;", AS.alice), db.vars.orderA);
      assert.equal(db.ok("select string_agg(id::text, ',') from public.orders;", AS.bob), db.vars.orderB);
      assert.equal(db.ok(count("public.order_items"), AS.alice), "2");
      assert.equal(db.ok(count("public.order_items"), AS.bob), "1");
      assert.equal(db.ok(count("public.order_tracking_events"), AS.alice), "1");
      assert.equal(db.ok(count("public.payments"), AS.alice), "1");
      assert.equal(db.ok(count("public.payments"), AS.bob), "0");
    });

    it("a customer cannot read another customer's order even by asking for its id", () => {
      assert.equal(db.ok("select count(*) from public.orders where id = :'orderB';", AS.alice), "0");
      assert.equal(db.ok("select count(*) from public.order_items where order_id = :'orderB';", AS.alice), "0");
      assert.equal(db.ok("select count(*) from public.order_tracking_events where order_id = :'orderB';", AS.alice), "0");
    });

    it("a customer sees their quotation, but its lines and price only once it has been quoted; never a guest or another customer's", () => {
      assert.equal(db.ok("select string_agg(status, ',' order by status) from public.quotations;", AS.alice), "in_review,quoted");
      assert.equal(db.ok("select string_agg(description, ',') from public.quotation_lines;", AS.alice), "Quoted build");
      assert.equal(db.ok("select count(*) from public.quotation_lines where description like 'Draft%';", AS.alice), "0");
      assert.equal(db.ok("select count(*) from public.quotations where customer_id is null;", AS.alice), "0");
      assert.equal(db.ok("select count(*) from public.quotations where id = '00000000-0000-4000-8000-0000000000d3';", AS.alice), "0");
    });

    it("anonymous visitors see nothing of the customer data", () => {
      for (const table of ["customers", "orders", "payments", "quotations", "loyalty_ledger", "loyalty_balances"]) {
        db.denied(count(`public.${table}`), AS.anon, /permission denied/);
      }
    });

    it("anonymous visitors can read only the status and category reference lists, and cannot change them", () => {
      assert.equal(db.ok(count("public.order_statuses"), AS.anon), "11");
      assert.equal(db.ok(count("public.quote_categories"), AS.anon), "18");
      db.denied("insert into public.quote_categories (label, sort_order) values ('Hack', 99);", AS.anon, /permission denied/);
      db.denied("update public.order_statuses set customer_label = 'x';", AS.anon, /permission denied/);
    });

    it("a customer cannot create, change or remove an order, an item, a payment, a tracking update or a loyalty entry", () => {
      db.denied("insert into public.orders (customer_id, total_minor) values (:'custA', 1);", AS.alice, /permission denied/);
      db.denied("update public.orders set total_minor = 1, status = 'delivered', amount_paid_minor = 0 where id = :'orderA';", AS.alice, /permission denied/);
      db.denied("delete from public.orders where id = :'orderA';", AS.alice, /permission denied/);
      db.denied("update public.order_items set unit_price_minor = 1;", AS.alice, /permission denied/);
      db.denied("insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderA', 'payment', 'deposit', 200000, 'cash');", AS.alice, /permission denied/);
      db.denied("insert into public.order_tracking_events (order_id, title) values (:'orderA', 'Delivered!');", AS.alice, /permission denied/);
      db.denied("insert into public.loyalty_ledger (customer_id, entry_type, points, description) values (:'custA', 'adjustment', 100000, 'free points');", AS.alice, /permission denied/);
      db.denied("update public.loyalty_ledger set points = 1;", AS.alice, /permission denied/);
    });

    it("a customer cannot create or change a quotation, a quotation line or a price", () => {
      db.denied("insert into public.quotations (customer_id, category, product_preference) values (:'custA', 'Mouse', 'Not sure');", AS.alice, /row-level security/);
      db.denied("insert into public.quotation_lines (quotation_id, position, description, unit_price_minor) values ('00000000-0000-4000-8000-0000000000d1', 9, 'free', 0);", AS.alice, /row-level security/);
      // An UPDATE is filtered by row level security: it touches no row and raises no error. Prove nothing changed.
      assert.equal(db.ok(`update public.quotations set status = 'accepted', quoted_total_minor = 1 where id = '00000000-0000-4000-8000-0000000000d1' returning id;
        update public.quotation_lines set unit_price_minor = 0 where quotation_id = '00000000-0000-4000-8000-0000000000d1' returning id;
        reset role; select status || ':' || quoted_total_minor || ':' || (select unit_price_minor from public.quotation_lines where quotation_id = '00000000-0000-4000-8000-0000000000d1') from public.quotations where id = '00000000-0000-4000-8000-0000000000d1';`, AS.alice), "quoted:400000:400000");
    });

    it("a customer may edit their own contact details", () => {
      assert.equal(db.ok("update public.customers set phone = '+97455559999', preferred_language = 'ar' where id = :'custA' returning phone || '/' || preferred_language;", AS.alice).split("\n")[0], "+97455559999/ar");
    });

    it("a customer cannot edit the customer code, the source, the id or another customer's profile", () => {
      db.denied("update public.customers set customer_code = 'C-1111-11111' where id = :'custA';", AS.alice, /permission denied/);
      db.denied("update public.customers set source = 'walk_in' where id = :'custA';", AS.alice, /permission denied/);
      db.denied("update public.customers set id = gen_random_uuid() where id = :'custA';", AS.alice, /permission denied/);
      assert.equal(db.ok(`update public.customers set full_name = 'Hacked' where id = :'custB' returning id;
        reset role; select full_name from public.customers where id = :'custB';`, AS.alice), "Bob Test");
    });

    it("a customer cannot create a customer record or link themselves to one", () => {
      db.denied("insert into public.customers (full_name) values ('Nope');", AS.alice, /row-level security/);
      db.denied("insert into public.customer_accounts (user_id, customer_id, linked_via) values (:'alice', :'custB', 'admin');", AS.alice, /permission denied/);
    });

    it("customers can neither read nor reach anything in the private schema, and neither can staff through the API role", () => {
      const tables = db.cluster.psql("select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'private';").out.split(",");
      assert.ok(tables.length >= 18, `expected at least 18 private tables, found ${tables.length}`);
      for (const who of [AS.alice, AS.eve, AS.sam, AS.olivia, AS.service, AS.anon]) {
        for (const table of tables) db.denied(`select count(*) from private.${table};`, who, /permission denied/);
      }
    });

    it("the loyalty balance view obeys row level security", () => {
      const make = `${newOrder({ items: oneItem(250000), into: "b1" })}${deliver("b1", 250000)}`;
      assert.equal(db.ok(`${make}${AS.alice}select string_agg(customer_id::text || ':' || balance_points, ',') from public.loyalty_balances;`).split("\n").pop(), `${ID.custA}:250`);
      assert.equal(db.ok(`${make}${AS.bob}select count(*) from public.loyalty_balances;`).split("\n").pop(), "0");
      assert.equal(db.ok(`${make}${AS.eve}select count(*) from public.loyalty_ledger;`).split("\n").pop(), "0");
    });
  });

  // =================================================================================================================
  describe("finance data and staff notes never reach a customer", () => {
    it("nothing a customer can read contains a supplier, a cost, an internal reference, a note or an internal reason", () => {
      const tables = ["customers", "customer_accounts", "quotations", "quotation_lines", "orders", "order_items", "order_tracking_events", "payments", "loyalty_ledger", "loyalty_balances", "order_statuses", "quote_categories"];
      const everything = tables.map((t) => `select to_jsonb(t)::text as x from public.${t} t`).join(" union all ");
      const out = db.ok(`select coalesce(string_agg(x, ' '), '') from (${everything}) s;`, AS.alice);
      assert.match(out, /Order confirmed/, "the scan must see the customer's own data");
      assert.match(out, /RCPT-TEST-1/, "the scan must see the customer's own receipt number");
      for (const secret of Object.values(SENTINEL)) assert.ok(!out.includes(secret), `leaked: ${secret}`);
      assert.ok(!/internal|supplier|margin|cost/i.test(out.replace(/customers?_|quotation|description/gi, "")), "no internal-sounding value");
    });

    it("the sentinels do exist in the private tables (so the scan above is meaningful)", () => {
      const out = db.ok(`select (select count(*) from private.order_notes where note like '%${SENTINEL.note}%')
        || ',' || (select count(*) from private.order_item_costs where supplier_name = '${SENTINEL.supplier}')
        || ',' || (select count(*) from private.payment_details where internal_reference = '${SENTINEL.reference}')
        || ',' || (select count(*) from private.order_status_history where reason = '${SENTINEL.reason}');`, AS.superuser);
      assert.equal(out, "1,1,1,1");
    });

    it("a customer cannot call any staff function", () => {
      db.denied("select admin.get_order_financials(:'orderA');", AS.alice, /permission denied: finance\.read/);
      db.denied("select * from admin.list_order_notes(:'orderA');", AS.alice, /permission denied: notes\.read/);
      db.denied("select admin.record_payment(:'orderA', 'deposit', 1, 'cash');", AS.alice, /permission denied: payments\.record/);
      db.denied("select admin.transition_order(:'orderA', 'delivered');", AS.alice, /(permission denied|cannot move)/);
      db.denied("select * from admin.list_policies();", AS.alice, /permission denied: policies\.read/);
      db.denied("select admin.issue_claim_code(:'custB');", AS.alice, /permission denied: customers\.manage/);
    });

    it("anonymous visitors cannot reach the staff schema or the customer functions", () => {
      db.denied("select admin.my_permissions();", AS.anon, /permission denied/);
      db.denied("select public.claim_customer_profile('AAAAA-AAAAA-AAAAA-AAAAA');", AS.anon, /permission denied/);
      db.denied("select public.create_my_customer_profile('x');", AS.anon, /permission denied/);
    });

    it("only a permission from finance.read shows costs and margins", () => {
      const out = db.ok("select revenue_minor || '/' || cost_usd_minor || '/' || items_without_cost || '/' || coalesce(margin_qar_minor::text, 'none') from admin.get_order_financials(:'orderA');", AS.olivia);
      assert.equal(out, `400000/${SENTINEL.cost}/1/none`);
      db.denied("select * from admin.get_order_financials(:'orderA');", AS.sam, /permission denied: finance\.read/);
    });

    it("a margin in QAR exists only when every cost is in QAR", () => {
      const out = db.ok(`${newOrder({ items: oneItem(100000), into: "m1" })}${AS.olivia}
        select admin.set_order_item_cost((select id from public.order_items where order_id = :'m1'), 'Local supplier', 60000, 'QAR');
        select revenue_minor || '/' || cost_qar_minor || '/' || margin_qar_minor from admin.get_order_financials(:'m1');`);
      assert.equal(out.split("\n").pop(), "100000/60000/40000");
    });

    it("staff with notes permissions can read notes; the customer never can", () => {
      assert.match(db.ok("select note from admin.list_order_notes(:'orderA');", AS.sam), new RegExp(SENTINEL.note));
      db.denied("select * from private.order_notes;", AS.sam, /permission denied/);
    });
  });

  // =================================================================================================================
  describe("staff authorization is decided on the server from the staff tables", () => {
    it("lists the permissions of a role", () => {
      assert.equal(db.ok("select count(*) from admin.my_permissions();", AS.olivia), "21");
      assert.equal(db.ok("select string_agg(p, ',' order by p) from admin.my_permissions() p;", AS.sam),
        "customers.manage,customers.read,notes.read,notes.write,orders.create,orders.read,orders.transition,quotations.manage,quotations.read,tracking.publish");
      assert.equal(db.ok("select count(*) from admin.my_permissions();", AS.alice), "0");
    });

    it("customers and signed-in strangers cannot create orders", () => {
      for (const who of [AS.alice, AS.eve]) db.denied(newOrder({ items: oneItem(100), who }), "", /permission denied: orders\.create/);
    });

    it("a deactivated staff member has no permission", () => {
      db.denied(newOrder({ items: oneItem(100), who: AS.dana }), "", /permission denied: orders\.create/);
      assert.equal(db.ok("select count(*) from admin.my_permissions();", AS.dana), "0");
    });

    it("forged token claims (admin, owner, permissions) grant nothing", () => {
      assert.equal(db.ok("select count(*) from admin.my_permissions();", AS.forgedAdmin), "0");
      db.denied("select admin.get_order_financials(:'orderA');", AS.forgedAdmin, /permission denied: finance\.read/);
      db.denied(newOrder({ items: oneItem(100), who: AS.forgedAdmin }), "", /permission denied/);
    });

    it("ordinary staff cannot touch money, costs, policies or loyalty points", () => {
      db.denied("select admin.record_payment(:'orderA', 'deposit', 1, 'cash');", AS.sam, /permission denied: payments\.record/);
      db.denied("select admin.reverse_payment((select id from public.payments limit 1), 'because');", AS.sam, /permission denied: payments\.reverse/);
      db.denied("select admin.set_order_item_cost((select id from public.order_items limit 1), 's', 1);", AS.sam, /permission denied: finance\.manage/);
      db.denied("select admin.set_policy('admin.mfa', '{\"required\": false}', 'unconfirmed_default', 'turn it off');", AS.sam, /permission denied: policies\.manage/);
      db.denied("select admin.adjust_loyalty(:'custA', 10, 'free points');", AS.sam, /permission denied: loyalty\.adjust/);
      db.denied("select * from admin.list_policies();", AS.sam, /permission denied: policies\.read/);
    });

    it("ordinary staff can create and move orders and publish tracking updates", () => {
      const out = db.ok(`${newOrder({ items: oneItem(100000), into: "s1", who: AS.sam })}${AS.sam}
        select admin.transition_order(:'s1', 'awaiting_deposit');
        select admin.publish_tracking_event(:'s1', 'Hello', 'Hi');
        select status from public.orders where id = :'s1';`);
      assert.equal(out.split("\n").pop(), "awaiting_deposit");
    });

    it("staff can read every customer-facing table through row level security", () => {
      assert.equal(db.ok("select count(*) from public.orders;", AS.sam), "2");
      assert.equal(db.ok("select count(*) from public.customers;", AS.sam), "2");
      assert.equal(db.ok("select count(*) from public.quotations;", AS.sam), "4");
      assert.equal(db.ok("select count(*) from public.payments;", AS.sam), "0", "ordinary staff lack payments.read");
      assert.equal(db.ok("select count(*) from public.payments;", AS.olivia), "1");
    });

    it("the second-factor rule: a staff session without aal2 has no permission while the policy requires it", () => {
      assert.equal(db.ok("select count(*) from admin.my_permissions();", AS.oliviaAal1), "0");
      db.denied(newOrder({ items: oneItem(100), who: AS.oliviaAal1 }), "", /permission denied: orders\.create/);
      assert.equal(db.ok("select count(*) from admin.my_permissions();", AS.olivia), "21");
    });

    it("the second-factor rule fails closed when its policy row is missing, and can be relaxed only by the owner's policy", () => {
      assert.equal(db.ok("delete from private.business_policies where key = 'admin.mfa'; reset role;" + AS.oliviaAal1 + "select count(*) from admin.my_permissions();", AS.superuser), "0");
      assert.equal(db.ok(`update private.business_policies set value = '{"required": false}', version = version + 1 where key = 'admin.mfa';${AS.oliviaAal1}select count(*) from admin.my_permissions();`, AS.superuser), "21");
    });

    it("a staff member row alone is what grants access: removing it removes every permission", () => {
      assert.equal(db.ok(`delete from private.staff_members where user_id = :'sam';${AS.sam}select count(*) from admin.my_permissions();`, AS.superuser), "0");
    });
  });

  // =================================================================================================================
  describe("orders, prices and the deposit rule", () => {
    const state = (v) => `select total_minor || ',' || deposit_required_minor || ',' || amount_paid_minor || ',' || status from public.orders where id = :'${v}';`;

    it("computes the total and the deposit on the server from the items and the deposit policy", () => {
      assert.equal(db.ok(`${newOrder({ into: "o1" })}${state("o1")}`).split("\n").pop(), "400000,200000,0,pending_confirmation");
    });

    it("rounds a deposit up and never above the total", () => {
      assert.equal(db.ok(`${newOrder({ items: oneItem(100001), into: "o1" })}${state("o1")}`).split("\n").pop(), "100001,50001,0,pending_confirmation");
    });

    it("accepts only item, never a total, status, paid amount or any other client-supplied value", () => {
      for (const bad of [{ total_minor: 1 }, { status: "delivered" }, { amount_paid_minor: 1000 }, { deposit_required_minor: 0 }, { supplier_cost_minor: 1 }]) {
        db.denied(newOrder({ items: [{ description: "x", unit_price_minor: 100, ...bad }] }), AS.olivia, /field that is not allowed/);
      }
    });

    it("rejects malformed items", () => {
      db.denied(newOrder({ items: [] }), AS.olivia, /1 to 200 items/);
      db.denied(`${AS.olivia}select admin.create_order(:'custA', '{"a":1}'::jsonb);`, "", /1 to 200 items|array/);
      db.denied(newOrder({ items: [{ description: "x", unit_price_minor: "12.5" }] }), AS.olivia, /invalid unit_price_minor/);
      db.denied(newOrder({ items: [{ description: "x", unit_price_minor: 100, quantity: 0 }] }), AS.olivia, /quantity/);
      db.denied(newOrder({ items: [{ description: "x", unit_price_minor: 100, quantity: 99999 }] }), AS.olivia, /invalid quantity/);
      db.denied(newOrder({ items: [{ description: "", unit_price_minor: 100 }] }), AS.olivia, /description_check|check constraint/);
      db.denied(newOrder({ items: [{ kind: "gift", description: "x", unit_price_minor: 1 }] }), AS.olivia, /kind_check|check constraint/);
    });

    it("rejects a negative order total", () => {
      db.denied(newOrder({ items: [{ kind: "discount", description: "Only a discount", unit_price_minor: -500 }] }), AS.olivia, /total cannot be negative/);
    });

    it("refuses an unknown customer", () => {
      db.denied(`${AS.olivia}select admin.create_order('00000000-0000-4000-8000-0000000000ff', '${json(oneItem(1))}'::jsonb);`, "", /customer not found/);
    });

    it("an order starts at pending_confirmation with nothing paid, and its history records its creation", () => {
      const out = db.ok(`${newOrder({ into: "o1" })}${AS.superuser}select count(*) || ':' || min(to_status) from private.order_status_history where order_id = :'o1';`);
      assert.equal(out.split("\n").pop(), "1:pending_confirmation");
    });

    it("an order with no priced items cannot leave pending_confirmation", () => {
      db.denied(`${newOrder({ items: oneItem(0), into: "z1" })}${AS.olivia}select admin.transition_order(:'z1', 'awaiting_deposit');`, "", /no priced items/);
    });

    it("a transition that is not in the rules is refused", () => {
      db.denied(`${newOrder({ into: "o1" })}${AS.olivia}select admin.transition_order(:'o1', 'sourcing');`, "", /cannot move from pending_confirmation to sourcing/);
      db.denied(`${newOrder({ into: "o1" })}${AS.olivia}select admin.transition_order(:'o1', 'not_a_status');`, "", /cannot move/);
    });

    it("the deposit is not paid merely because the order or the quotation exists: the gate blocks until the ledger says so", () => {
      db.denied(`${newOrder({ into: "o1" })}${AS.olivia}
        select admin.transition_order(:'o1', 'awaiting_deposit');
        select admin.transition_order(:'o1', 'deposit_received');`, "", /deposit has not been fully paid \(0 of 200000/);
    });

    it("a partial deposit is not enough, the full deposit is", () => {
      db.denied(`${newOrder({ into: "o1" })}${AS.olivia}
        select admin.transition_order(:'o1', 'awaiting_deposit');
        select admin.record_payment(:'o1', 'deposit', 199999, 'cash');
        select admin.transition_order(:'o1', 'deposit_received');`, "", /deposit has not been fully paid \(199999 of 200000/);
      assert.equal(db.ok(`${newOrder({ into: "o1" })}${AS.olivia}
        select admin.transition_order(:'o1', 'awaiting_deposit');
        select admin.record_payment(:'o1', 'deposit', 200000, 'cash');
        select admin.transition_order(:'o1', 'deposit_received');${state("o1")}`).split("\n").pop(), "400000,200000,200000,deposit_received");
    });

    it("an order converted from an accepted quotation is not paid and still needs its deposit", () => {
      const prepare = `insert into public.quotations (id, customer_id, category, product_preference) values ('00000000-0000-4000-8000-0000000000e2', :'custA', 'Complete Custom PC', 'Not sure');
        update public.quotations set status = 'in_review' where id = '00000000-0000-4000-8000-0000000000e2';
        update public.quotations set status = 'quoted', quoted_total_minor = 400000 where id = '00000000-0000-4000-8000-0000000000e2';
        update public.quotations set status = 'accepted' where id = '00000000-0000-4000-8000-0000000000e2';`;
      const out = db.ok(`${AS.superuser}${prepare}${newOrder({ extra: ", '00000000-0000-4000-8000-0000000000e2'", into: "q1" })}
        ${AS.superuser}select status || ',' || (select amount_paid_minor from public.orders where id = :'q1') from public.quotations where id = '00000000-0000-4000-8000-0000000000e2';`);
      assert.equal(out.split("\n").pop(), "converted,0");
      db.denied(`${AS.superuser}${prepare}${newOrder({ extra: ", '00000000-0000-4000-8000-0000000000e2'", into: "q1" })}${AS.olivia}
        select admin.transition_order(:'q1', 'awaiting_deposit');
        select admin.transition_order(:'q1', 'deposit_received');`, "", /deposit has not been fully paid/);
    });

    it("a quotation that is not accepted, or belongs to someone else, cannot become an order", () => {
      db.denied(newOrder({ extra: ", '00000000-0000-4000-8000-0000000000d1'" }), AS.olivia, /only an accepted quotation/);
      db.denied(newOrder({ customer: ID.custB, extra: ", '00000000-0000-4000-8000-0000000000d1'", items: itemsA }), AS.olivia, /different customer|only an accepted/);
    });

    it("walks the whole lifecycle in order, and the full history is recorded privately", () => {
      const steps = ["awaiting_deposit", "deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery", "delivered"]
        .map((status) => `select admin.transition_order(:'w1', '${status}');`).join("\n");
      const out = db.ok(`${newOrder({ into: "w1" })}${AS.olivia}select admin.record_payment(:'w1', 'deposit', 400000, 'cash');\n${steps}${AS.superuser}
        select (select status from public.orders where id = :'w1') || ',' || count(*) from private.order_status_history where order_id = :'w1';`);
      assert.equal(out.split("\n").pop(), "delivered,9");
    });

    it("a delivered or cancelled order is final", () => {
      db.denied(`${newOrder({ into: "w1" })}${deliver("w1", 400000)}${AS.olivia}select admin.transition_order(:'w1', 'building');`, "", /cannot move from delivered/);
      db.denied(`${newOrder({ into: "w1" })}${AS.olivia}select admin.transition_order(:'w1', 'cancelled'); select admin.transition_order(:'w1', 'awaiting_deposit');`, "", /cannot move from cancelled/);
    });

    it("a held order can only resume where it was held, or be cancelled", () => {
      const toSourcing = `${newOrder({ into: "h1" })}${AS.olivia}
        select admin.record_payment(:'h1', 'deposit', 400000, 'cash');
        select admin.transition_order(:'h1', 'awaiting_deposit'); select admin.transition_order(:'h1', 'deposit_received'); select admin.transition_order(:'h1', 'sourcing');
        select admin.transition_order(:'h1', 'on_hold', 'waiting for the customer');`;
      db.denied(`${toSourcing}select admin.transition_order(:'h1', 'building');`, "", /can only resume at sourcing/);
      assert.equal(db.ok(`${toSourcing}select admin.transition_order(:'h1', 'sourcing');${state("h1")}`).split("\n").pop(), "400000,200000,400000,sourcing");
      assert.equal(db.ok(`${toSourcing}select admin.transition_order(:'h1', 'cancelled');${state("h1")}`).split("\n").pop(), "400000,200000,400000,cancelled");
    });

    it("the deposit gate also applies when resuming from hold", () => {
      db.denied(`${newOrder({ into: "h2" })}${AS.olivia}
        select admin.transition_order(:'h2', 'awaiting_deposit'); select admin.transition_order(:'h2', 'on_hold');
        select admin.transition_order(:'h2', 'deposit_received');`, "", /deposit has not been fully paid|can only resume/);
    });

    it("nothing can write an order's status, total or paid amount directly: not a customer, not staff, not the service role, not even the database owner", () => {
      const sql = (set) => `update public.orders set ${set} where id = :'orderB';`;
      for (const who of [AS.alice, AS.sam, AS.olivia, AS.service]) {
        db.denied(sql("status = 'delivered'"), who, /permission denied/);
        db.denied(sql("total_minor = 1"), who, /permission denied/);
        db.denied(sql("amount_paid_minor = 100000"), who, /permission denied/);
      }
      db.denied(sql("status = 'delivered'"), AS.superuser, /only be changed through the staff functions/);
      db.denied("insert into public.order_items (order_id, position, description, unit_price_minor) values (:'orderB', 9, 'x', 1);", AS.superuser, /only be changed through the staff functions/);
      db.denied("delete from public.orders where id = :'orderB';", AS.superuser, /only be changed through the staff functions/);
    });

    it("a staff function that fails half-way leaves no half-written order and no open write flag", () => {
      const bad = json([...oneItem(100), { description: "bad", unit_price_minor: "x" }]);
      const out = db.ok(`${AS.olivia}do $$ begin
          begin perform admin.create_order('${ID.custA}', '${bad}'::jsonb); exception when others then null; end;
        end $$;
        select (select count(*) from public.orders) || ',' || private.write_ctx_on()::text;`);
      assert.equal(out.split("\n").pop(), "2,false");
    });

    it("tracking updates are published by staff and seen by the owning customer only; the status history stays private", () => {
      assert.equal(db.ok("select title from public.order_tracking_events;", AS.alice), "Order confirmed");
      assert.equal(db.ok("select title from public.order_tracking_events;", AS.bob), "Order received");
      db.denied("select * from private.order_status_history;", AS.alice, /permission denied/);
      db.denied(`select admin.publish_tracking_event(:'orderA', 'x', 'y');`, AS.alice, /permission denied: tracking\.publish/);
      db.denied(`select admin.publish_tracking_event(:'orderA', '', 'y');`, AS.olivia, /title_check|check constraint/);
    });

    it("a customer sees the readable status label of their order, never the internal rules", () => {
      assert.equal(db.ok("select s.customer_label from public.orders o join public.order_statuses s on s.code = o.status;", AS.alice), "Awaiting deposit");
      db.denied("select * from private.order_status_transitions;", AS.alice, /permission denied/);
    });

    it("an item price is changed only before the deposit stage, never directly", () => {
      db.denied("update public.order_items set unit_price_minor = 1 where order_id = :'orderB';", AS.sam, /permission denied/);
      db.denied("update public.order_items set unit_price_minor = 1 where order_id = :'orderB';", AS.superuser, /only be changed through the staff functions/);
    });
  });

  // =================================================================================================================
  describe("payments ledger in QAR", () => {
    const paid = (v) => `select amount_paid_minor from public.orders where id = :'${v}';`;

    it("records a payment, derives the paid amount from the ledger, and shows the customer only their own entries", () => {
      assert.equal(db.ok(`${newOrder({ into: "p1" })}${AS.olivia}select admin.record_payment(:'p1', 'deposit', 50000, 'card', now(), 'R-1', 'bank-ref', 'note');${paid("p1")}`).split("\n").pop(), "50000");
      assert.equal(db.ok("select string_agg(amount_minor || ':' || method || ':' || coalesce(receipt_number, '-'), ',') from public.payments;", AS.alice), "100000:bank_transfer:RCPT-TEST-1");
    });

    it("rejects a zero, a negative, a future-dated, an unknown-method or an over-paying payment", () => {
      const pay = (args) => `${newOrder({ into: "p1" })}${AS.olivia}select admin.record_payment(:'p1', ${args});`;
      db.denied(pay("'deposit', 0, 'cash'"), "", /greater than zero/);
      db.denied(pay("'deposit', -100, 'cash'"), "", /greater than zero/);
      db.denied(pay("'deposit', 100, 'cash', now() + interval '3 days'"), "", /future/);
      db.denied(pay("'deposit', 100, 'bitcoin'"), "", /method_check|check constraint/);
      db.denied(pay("'tip', 100, 'cash'"), "", /purpose_check|check constraint/);
      db.denied(pay("'deposit', 400001, 'cash'"), "", /exceed the order total/);
    });

    it("rejects a second payment that would exceed the total, and a payment on a cancelled order", () => {
      db.denied(`${newOrder({ into: "p1" })}${AS.olivia}select admin.record_payment(:'p1', 'deposit', 300000, 'cash'); select admin.record_payment(:'p1', 'balance', 100001, 'cash');`, "", /exceed the order total/);
      db.denied(`${newOrder({ into: "p1" })}${AS.olivia}select admin.transition_order(:'p1', 'cancelled'); select admin.record_payment(:'p1', 'deposit', 100, 'cash');`, "", /cancelled order/);
    });

    it("a mistake is reversed by a new negative entry, once, and the paid amount follows the ledger", () => {
      const base = `${newOrder({ into: "p1" })}${AS.olivia}select admin.record_payment(:'p1', 'deposit', 200000, 'cash') as pid \\gset\n`;
      assert.equal(db.ok(`${base}select admin.reverse_payment(:'pid', 'entered twice by mistake');${paid("p1")}`).split("\n").pop(), "0");
      assert.equal(db.ok(`${base}select admin.reverse_payment(:'pid', 'entered twice by mistake');${AS.superuser}select count(*) || ':' || sum(amount_minor) from public.payments where order_id = :'p1';`).split("\n").pop(), "2:0");
      db.denied(`${base}select admin.reverse_payment(:'pid', 'once'); select admin.reverse_payment(:'pid', 'twice');`, "", /already been reversed/);
      db.denied(`${base}select admin.reverse_payment(:'pid', '');`, "", /reason is required/);
      db.denied(`${base}${AS.sam}select admin.reverse_payment(:'pid', 'reason');`, "", /permission denied: payments\.reverse/);
    });

    it("a reversal cannot be reversed, and a reversal entry is not a payment that can be reversed", () => {
      db.denied(`${newOrder({ into: "p1" })}${AS.olivia}select admin.record_payment(:'p1', 'deposit', 1000, 'cash') as pid \\gset
        select admin.reverse_payment(:'pid', 'mistake') as rid \\gset
        select admin.reverse_payment(:'rid', 'undo the undo');`, "", /payment not found/);
    });

    it("after a reversal the deposit gate blocks again", () => {
      db.denied(`${newOrder({ into: "p1" })}${AS.olivia}
        select admin.transition_order(:'p1', 'awaiting_deposit');
        select admin.record_payment(:'p1', 'deposit', 200000, 'cash') as pid \\gset
        select admin.reverse_payment(:'pid', 'bounced');
        select admin.transition_order(:'p1', 'deposit_received');`, "", /deposit has not been fully paid \(0 of 200000/);
    });

    it("nobody can insert, change or remove a payment directly", () => {
      for (const who of [AS.alice, AS.sam, AS.olivia, AS.service]) {
        db.denied("insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderB', 'payment', 'deposit', 1, 'cash');", who, /permission denied/);
        db.denied("update public.payments set amount_minor = 1;", who, /permission denied/);
        db.denied("delete from public.payments;", who, /permission denied/);
      }
      db.denied("insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'orderB', 'payment', 'deposit', 1, 'cash');", AS.superuser, /only be changed through the staff functions/);
    });

    it("the order total and a snapshot of the deposit never move when the ledger changes", () => {
      assert.equal(db.ok(`${newOrder({ into: "p1" })}${AS.olivia}select admin.record_payment(:'p1', 'deposit', 400000, 'cash');select total_minor || ',' || deposit_required_minor || ',' || balance_due_minor from public.orders where id = :'p1';`).split("\n").pop(), "400000,200000,0");
    });
  });

  // =================================================================================================================
  describe("business policies are data and changeable by the owner only", () => {
    const setDeposit = (bps) => `select admin.set_policy('orders.deposit', '{"percent_bps": ${bps}, "minimum_minor": 0, "required_before_status": "deposit_received"}', 'confirmed_by_owner', 'owner decision for the test');`;

    it("a new deposit percentage applies to new orders only; existing orders keep their snapshot", () => {
      const out = db.ok(`${AS.olivia}${setDeposit(3000)}${newOrder({ into: "n1" })}select (select deposit_required_minor from public.orders where id = :'n1') || ',' || (select deposit_required_minor from public.orders where id = :'orderA');`);
      assert.equal(out.split("\n").pop(), "120000,200000");
    });

    it("a minimum deposit applies, and the deposit never exceeds the total", () => {
      const raise = `select admin.set_policy('orders.deposit', '{"percent_bps": 1000, "minimum_minor": 500000, "required_before_status": "deposit_received"}', 'unconfirmed_default', 'test');`;
      assert.equal(db.ok(`${AS.olivia}${raise}${newOrder({ into: "n1" })}select deposit_required_minor from public.orders where id = :'n1';`).split("\n").pop(), "400000");
    });

    it("the deposit can be moved to a later status by policy, with no code change", () => {
      const out = db.ok(`${AS.olivia}select admin.set_policy('orders.deposit', '{"percent_bps": 5000, "minimum_minor": 0, "required_before_status": "building"}', 'unconfirmed_default', 'test');
        ${newOrder({ into: "n1" })}${AS.olivia}
        select admin.transition_order(:'n1', 'awaiting_deposit'); select admin.transition_order(:'n1', 'deposit_received'); select admin.transition_order(:'n1', 'sourcing');
        select status from public.orders where id = :'n1';`);
      assert.equal(out.split("\n").pop(), "sourcing");
    });

    it("a full-payment rule can be switched on for a status", () => {
      db.denied(`${AS.olivia}select admin.set_policy('orders.full_payment', '{"required_before_status": "ready_for_delivery"}', 'unconfirmed_default', 'test');
        ${newOrder({ into: "f1" })}${AS.olivia}
        select admin.record_payment(:'f1', 'deposit', 200000, 'cash');
        select admin.transition_order(:'f1', 'awaiting_deposit'); select admin.transition_order(:'f1', 'deposit_received'); select admin.transition_order(:'f1', 'sourcing');
        select admin.transition_order(:'f1', 'building'); select admin.transition_order(:'f1', 'quality_check'); select admin.transition_order(:'f1', 'ready_for_delivery');`, "", /must be paid in full before ready_for_delivery/);
    });

    it("a missing deposit policy stops orders from being created and from advancing instead of letting them through", () => {
      db.denied(`${newOrder({ into: "n1" })}${AS.superuser}delete from private.business_policies where key = 'orders.deposit';${AS.olivia}select admin.transition_order(:'n1', 'awaiting_deposit');`, "", /deposit policy is missing/);
      db.denied(`delete from private.business_policies where key = 'orders.deposit';${newOrder({ into: "n1" })}`, AS.superuser, /deposit policy is missing/);
    });

    it("rejects invalid values, unknown keys, unknown statuses and a missing reason; keeps the old value", () => {
      db.denied(`${AS.olivia}${setDeposit(20000)}`, "", /invalid policy value: percent_bps must be/);
      db.denied(`${AS.olivia}select admin.set_policy('made.up', '{}', 'unconfirmed_default', 'test');`, "", /unknown policy key/);
      db.denied(`${AS.olivia}select admin.set_policy('orders.full_payment', '{"required_before_status": "not_a_status"}', 'unconfirmed_default', 'test');`, "", /unknown order status/);
      db.denied(`${AS.olivia}select admin.set_policy('admin.mfa', '{"required": true}', 'unconfirmed_default', '');`, "", /reason is required/);
      db.denied(`${AS.olivia}select admin.set_policy('admin.mfa', '{"required": true}', 'trusted', 'test');`, "", /confirmation must be/);
    });

    it("each change bumps the version and keeps the previous value", () => {
      const out = db.ok(`${AS.olivia}${setDeposit(3000)}${setDeposit(4000)}${AS.superuser}
        select (select version from private.business_policies where key = 'orders.deposit') || ',' || count(*) || ',' || max(changed_by::text) from private.business_policy_versions where key = 'orders.deposit';`);
      // v1 is the Phase 1 placeholder, v2 the migration that withdrew it, v3 the test fixture, v4 and v5 this test.
      assert.equal(out.split("\n").pop(), `5,5,${ID.olivia}`);
    });

    it("the policy list tells the owner which values are still unconfirmed placeholders", () => {
      assert.equal(db.ok("select count(*) from admin.list_policies() where confirmation = 'unconfirmed_default';", AS.olivia), "6");
      assert.equal(db.ok("select string_agg(key, ',' order by key) from admin.list_policies() where open_question is not null;", AS.olivia),
        "loyalty.earn_rate,loyalty.earning_base,loyalty.award_trigger,loyalty.negative_balance,loyalty.point_value,orders.full_payment".split(",").sort().join(","));
    });
  });

  describe("the deposit policy is unconfigured by default, and can be a percentage, a fixed amount or tiers", () => {
    const setPolicy = (value, reason = "test") => `select admin.set_policy('orders.deposit', '${json(value)}'::jsonb, 'unconfirmed_default', '${reason}');`;
    const tiered = {
      mode: "tiered",
      minimum_minor: 25000,
      required_before_status: "deposit_received",
      tiers: [{ up_to_minor: 100000, fixed_minor: 20000 }, { up_to_minor: 500000, percent_bps: 3000 }, { percent_bps: 2500 }],
    };
    const depositFor = (total, variable) => `${newOrder({ items: oneItem(total), into: variable })}select deposit_required_minor from public.orders where id = :'${variable}';`;

    it("the migration withdrew the flat 50 percent placeholder: version 1 is kept, version 2 is unconfigured", () => {
      const out = db.ok("select version || ' ' || coalesce(value ->> 'mode', 'none') || ' ' || coalesce(value ->> 'percent_bps', '-') || ' ' || coalesce((reason ~ 'PLAT-0002')::text, 'no-reason') from private.business_policy_versions where key = 'orders.deposit' and version <= 2 order by version;", AS.superuser);
      assert.deepEqual(out.split("\n"), ["1 none 5000 no-reason", "2 unconfigured - true"]);
    });

    it("while unconfigured, no order can be created and no existing order can advance", () => {
      const unconfigure = `${AS.olivia}${setPolicy({ mode: "unconfigured" })}`;
      db.denied(`${unconfigure}${newOrder({ into: "n1" })}`, "", /has not been configured by the owner/);
      db.denied(`${newOrder({ into: "n1" })}${unconfigure}select admin.transition_order(:'n1', 'awaiting_deposit');`, "", /has not been configured by the owner/);
    });

    it("an unconfigured policy carries no other setting, and an unknown mode is refused", () => {
      db.denied(`${AS.olivia}${setPolicy({ mode: "unconfigured", percent_bps: 5000 })}`, "", /carries no other setting/);
      db.denied(`${AS.olivia}${setPolicy({ mode: "sometimes", required_before_status: "deposit_received" })}`, "", /mode must be/);
      db.denied(`${AS.olivia}${setPolicy({ mode: 5 })}`, "", /mode must be/);
    });

    it("a tiered schedule picks the tier by order total, applies the minimum, and never exceeds the total", () => {
      const out = db.ok(`${AS.olivia}${setPolicy(tiered)}${[10000, 100000, 100001, 500000, 500001].map((t, i) => depositFor(t, `t${i}`)).join("")}`);
      // 10 000: tier 1 fixed 20 000, minimum 25 000, capped at the total. 100 000: still tier 1, minimum 25 000 wins.
      // 100 001: tier 2, 30 % = 30 000.3 rounds up to 30 001. 500 000: tier 2, 150 000. 500 001: tier 3, 25 % rounds up to 125 001.
      assert.deepEqual(out.split("\n").slice(-5), ["10000", "25000", "30001", "150000", "125001"]);
    });

    it("a fixed schedule is a flat amount capped at the total", () => {
      const out = db.ok(`${AS.olivia}${setPolicy({ mode: "fixed", fixed_minor: 30000, required_before_status: "deposit_received" })}${depositFor(10000, "f0")}${depositFor(400000, "f1")}`);
      assert.deepEqual(out.split("\n").slice(-2), ["10000", "30000"]);
    });

    it("a tiered snapshot is taken when the order is priced and the deposit gate then uses it", () => {
      const out = db.ok(`${AS.olivia}${setPolicy(tiered)}${newOrder({ items: oneItem(200000), into: "g1" })}${AS.olivia}
        select deposit_required_minor from public.orders where id = :'g1';
        ${setPolicy({ mode: "fixed", fixed_minor: 1, required_before_status: "deposit_received" })}
        select deposit_required_minor from public.orders where id = :'g1';`).split("\n");
      // 200 000 falls in tier 2: 30 % = 60 000. A later change of schedule does not rewrite the order.
      assert.deepEqual([out[out.length - 3], out[out.length - 1]], ["60000", "60000"]);
      db.denied(`${AS.olivia}${setPolicy(tiered)}${newOrder({ items: oneItem(200000), into: "g1" })}${AS.olivia}
        select admin.record_payment(:'g1', 'deposit', 59999, 'cash');
        select admin.transition_order(:'g1', 'awaiting_deposit'); select admin.transition_order(:'g1', 'deposit_received');`, "", /deposit has not been fully paid \(59999 of 60000/);
    });

    it("rejects malformed tiered schedules", () => {
      const bad = (override, message) => db.denied(`${AS.olivia}${setPolicy({ ...tiered, ...override })}`, "", new RegExp(`invalid policy value: ${message}`));
      bad({ tiers: [] }, "a tiered deposit policy needs between 1 and 12 tiers");
      bad({ tiers: Array.from({ length: 13 }, (_, i) => (i < 12 ? { up_to_minor: (i + 1) * 1000, fixed_minor: 1 } : { fixed_minor: 1 })) }, "a tiered deposit policy needs between 1 and 12 tiers");
      bad({ tiers: [{ up_to_minor: 500, fixed_minor: 1 }, { up_to_minor: 500, fixed_minor: 2 }, { fixed_minor: 3 }] }, "up_to_minor must increase");
      bad({ tiers: [{ up_to_minor: 500, fixed_minor: 1 }, { up_to_minor: 100, fixed_minor: 2 }, { fixed_minor: 3 }] }, "up_to_minor must increase");
      bad({ tiers: [{ up_to_minor: 500, fixed_minor: 1 }, { up_to_minor: 900, fixed_minor: 2 }] }, "the last tier must have no up_to_minor");
      bad({ tiers: [{ up_to_minor: 0, fixed_minor: 1 }, { fixed_minor: 3 }] }, "every tier except the last needs a positive up_to_minor");
      bad({ tiers: [{ up_to_minor: 500, fixed_minor: 1, percent_bps: 10 }, { fixed_minor: 3 }] }, "every tier needs exactly one of percent_bps and fixed_minor");
      bad({ tiers: [{ up_to_minor: 500 }, { fixed_minor: 3 }] }, "every tier needs exactly one of percent_bps and fixed_minor");
      bad({ tiers: [{ up_to_minor: 500, percent_bps: 10001 }, { fixed_minor: 3 }] }, "percent_bps must be an integer from 0 to 10000");
      bad({ tiers: [{ up_to_minor: 500, fixed_minor: -1 }, { fixed_minor: 3 }] }, "fixed_minor must be a non-negative integer");
      bad({ tiers: [{ up_to_minor: 500, fixed_minor: 1, secret: 1 }, { fixed_minor: 3 }] }, "a tier allows only");
      bad({ tiers: "all" }, "tiers must be a list");
      bad({ minimum_minor: -5 }, "minimum_minor must be a non-negative integer");
      bad({ required_before_status: undefined }, "required_before_status must be a status code");
      bad({ extra: 1 }, "a tiered deposit policy allows only");
      db.denied(`${AS.olivia}${setPolicy({ mode: "fixed", required_before_status: "deposit_received" })}`, "", /fixed_minor must be a non-negative integer/);
      db.denied(`${AS.olivia}${setPolicy({ mode: "fixed", fixed_minor: 1, percent_bps: 5, required_before_status: "deposit_received" })}`, "", /allows only fixed_minor/);
      db.denied(`${AS.olivia}${setPolicy({ mode: "tiered", required_before_status: "nonexistent_status", tiers: [{ fixed_minor: 1 }] })}`, "", /unknown order status/);
    });

    it("the Phase 1 percent shape without a mode still works and means percent", () => {
      const out = db.ok(`${AS.olivia}select admin.set_policy('orders.deposit', '{"percent_bps": 2500, "minimum_minor": 0, "required_before_status": "deposit_received"}', 'unconfirmed_default', 'test');${depositFor(80000, "p0")}`);
      assert.equal(out.split("\n").pop(), "20000");
    });

    it("a single-tier schedule that is open-ended is valid", () => {
      assert.equal(db.ok(`${AS.olivia}${setPolicy({ mode: "tiered", required_before_status: "deposit_received", tiers: [{ percent_bps: 1000 }] })}${depositFor(50000, "s0")}`).split("\n").pop(), "5000");
    });
  });

  // =================================================================================================================
  describe("a wrongly published tracking update can be withdrawn without being deleted", () => {
    const eventA = `${AS.superuser}select id as evid from public.order_tracking_events where order_id = :'orderA' order by published_at limit 1 \\gset\n`;
    const countAs = (who) => `${who}select count(*) from public.order_tracking_events where order_id = :'orderA';`;

    it("the customer stops seeing a retracted update; staff and the database still hold it", () => {
      const out = db.ok(`${eventA}${countAs(AS.alice)}${AS.olivia}select admin.retract_tracking_event(:'evid', 'published on the wrong order');${countAs(AS.alice)}${countAs(AS.olivia)}
        ${AS.superuser}select (select count(*) from public.order_tracking_events where order_id = :'orderA') || ':' || (select count(*) from private.tracking_event_retractions);`);
      assert.deepEqual(out.split("\n").filter((l) => l !== ""), ["1", "0", "1", "1:1"]);
    });

    it("the reason, the author and the time are kept, and the action is audited", () => {
      const out = db.ok(`${eventA}${AS.sam}select admin.retract_tracking_event(:'evid', 'wrong customer');${AS.superuser}
        select reason || ':' || retracted_by || ':' || (retracted_at is not null)::text || ':' || (select count(*) from private.audit_log where action = 'tracking.retracted') from private.tracking_event_retractions;`);
      assert.equal(out.split("\n").pop(), `wrong customer:${ID.sam}:true:1`);
    });

    it("a customer, a visitor and an unlinked user cannot retract anything", () => {
      db.denied(`${eventA}${AS.alice}select admin.retract_tracking_event(:'evid', 'I do not like it');`, "", /permission denied: tracking\.publish/);
      db.denied(`${eventA}${AS.eve}select admin.retract_tracking_event(:'evid', 'nope');`, "", /permission denied/);
      db.denied(`${eventA}${AS.anon}select admin.retract_tracking_event(:'evid', 'nope');`, "", /permission denied/);
      db.denied(`${eventA}${AS.dana}select admin.retract_tracking_event(:'evid', 'deactivated staff');`, "", /permission denied/);
    });

    it("a reason is required, an unknown update is refused, and an update cannot be retracted twice", () => {
      db.denied(`${eventA}${AS.olivia}select admin.retract_tracking_event(:'evid', '');`, "", /a reason is required/);
      db.denied(`${AS.olivia}select admin.retract_tracking_event('00000000-0000-4000-8000-00000000ffff', 'unknown');`, "", /tracking update not found/);
      db.denied(`${eventA}${AS.olivia}select admin.retract_tracking_event(:'evid', 'first');select admin.retract_tracking_event(:'evid', 'second');`, "", /already been retracted/);
    });

    it("nothing is deleted or edited: the update and the retraction stay append-only", () => {
      db.denied(`${eventA}${AS.olivia}select admin.retract_tracking_event(:'evid', 'first');${AS.superuser}delete from public.order_tracking_events where id = :'evid';`, "", /append-only|cannot be (updated|deleted)/i);
      db.denied(`${eventA}${AS.olivia}select admin.retract_tracking_event(:'evid', 'first');${AS.superuser}delete from private.tracking_event_retractions;`, "", /append-only|cannot be (updated|deleted)/i);
      db.denied(`${eventA}${AS.olivia}select admin.retract_tracking_event(:'evid', 'first');${AS.superuser}update private.tracking_event_retractions set reason = 'edited';`, "", /append-only|cannot be (updated|deleted)/i);
    });

    it("the retraction record is private, and a retraction on one order does not touch another customer's updates", () => {
      db.denied(`${AS.alice}select * from private.tracking_event_retractions;`, "", /permission denied/);
      db.denied(`${AS.sam}select * from private.tracking_event_retractions;`, "", /permission denied/);
      const out = db.ok(`${eventA}${AS.olivia}select admin.retract_tracking_event(:'evid', 'wrong order');${AS.bob}select count(*) from public.order_tracking_events where order_id = :'orderB';`);
      assert.equal(out.split("\n").pop(), "1");
    });
  });

  // =================================================================================================================
  describe("what the ledger protection does NOT prevent: a privileged database operator", () => {
    // The append-only and write-guard triggers stop every API role, every staff function and every ordinary SQL
    // statement, superuser included. They are not a defence against an operator who can change the schema: such a person
    // can disable a trigger, drop it, or switch the session to replica mode, and the data is then editable. These tests
    // state that limit on purpose, so no document is read as promising more. The controls against that person are
    // organisational (who holds database ownership, audit logs, backups), listed in the architecture document.
    it("the database owner can disable the append-only trigger on the payments ledger", () => {
      db.denied(`${AS.superuser}update public.payments set amount_minor = 1 where order_id = :'orderA';`, "", /append-only/i);
      const out = db.ok(`${AS.superuser}alter table public.payments disable trigger payments_append_only;
        update public.payments set amount_minor = 1 where order_id = :'orderA'; select amount_minor from public.payments where order_id = :'orderA';`);
      assert.equal(out.split("\n").pop(), "1");
    });

    it("the database owner can bypass the triggers for a session with replica mode", () => {
      const out = db.ok(`${AS.superuser}set local session_replication_role = replica;
        update public.payments set amount_minor = 1 where order_id = :'orderA'; select amount_minor from public.payments where order_id = :'orderA';`);
      assert.equal(out.split("\n").pop(), "1");
    });

    it("but no API role, however privileged its token, can do either", () => {
      for (const who of [AS.service, AS.olivia, AS.alice]) {
        db.denied(`${who}alter table public.payments disable trigger payments_append_only;`, "", /must be owner|permission denied/);
        db.denied(`${who}set local session_replication_role = replica;`, "", /permission denied/);
        db.denied(`${who}update public.payments set amount_minor = 1 where order_id = :'orderA';`, "", /permission denied/);
      }
    });
  });

  // =================================================================================================================
  describe("loyalty rewards ledger", () => {
    it("awards one point per QAR 10 when a fully paid order is delivered, in the same transaction", () => {
      const out = db.ok(`${newOrder({ items: oneItem(123450), into: "l1" })}${deliver("l1", 123450)}${AS.superuser}
        select points || ':' || entry_type || ':' || (description ~ '^Points earned on order O-[0-9]{4}-[0-9]{5}$')::text from public.loyalty_ledger where order_id = :'l1';`);
      assert.equal(out.split("\n").pop(), "123:award:true");
    });

    it("awards nothing before the order is delivered, and nothing for a cancelled order", () => {
      assert.equal(db.ok(`${newOrder({ into: "l1" })}${AS.olivia}select admin.record_payment(:'l1', 'deposit', 400000, 'cash');select ${ledgerSql("l1")};`).split("\n").pop(), "0");
      assert.equal(db.ok(`${newOrder({ into: "l1" })}${AS.olivia}select admin.transition_order(:'l1', 'cancelled');${AS.superuser}select ${ledgerSql("l1")};`).split("\n").pop(), "0");
    });

    it("with the placeholder policy, a delivered order that is not fully paid earns nothing until the last payment arrives", () => {
      const partial = `${newOrder({ into: "l1" })}${AS.olivia}
        select admin.record_payment(:'l1', 'deposit', 200000, 'cash');
        select admin.transition_order(:'l1', 'awaiting_deposit'); select admin.transition_order(:'l1', 'deposit_received'); select admin.transition_order(:'l1', 'sourcing');
        select admin.transition_order(:'l1', 'building'); select admin.transition_order(:'l1', 'quality_check'); select admin.transition_order(:'l1', 'ready_for_delivery'); select admin.transition_order(:'l1', 'delivered');`;
      assert.equal(db.ok(`${partial}${AS.superuser}select ${ledgerSql("l1")};`).split("\n").pop(), "0");
      assert.equal(db.ok(`${partial}${AS.olivia}select admin.record_payment(:'l1', 'balance', 200000, 'cash');${AS.superuser}select points from public.loyalty_ledger where order_id = :'l1';`).split("\n").pop(), "400");
    });

    it("never awards twice: repeating the award returns the same entry, and a second award row is impossible", () => {
      const base = `${newOrder({ items: oneItem(100000), into: "l1" })}${deliver("l1", 100000)}${AS.olivia}select admin.award_loyalty_for_order(:'l1') as e1 \\gset\nselect admin.award_loyalty_for_order(:'l1') as e2 \\gset\n`;
      assert.equal(db.ok(`${base}select (:'e1' = :'e2')::text || ',' || ${ledgerSql("l1")};`).split("\n").pop(), "true,1");
      db.denied(`${base}${AS.superuser}select private.set_write_ctx(true); insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values (:'custA', :'l1', 'award', 10, 'dup');`, "", /loyalty_one_award_per_order/);
    });

    it("an order that earns less than one point earns no entry", () => {
      assert.equal(db.ok(`${newOrder({ items: oneItem(900), into: "l1" })}${deliver("l1", 900)}${AS.superuser}select ${ledgerSql("l1")};`).split("\n").pop(), "0");
    });

    it("reads the earn rate and the rounding from policy", () => {
      const rate = `${AS.olivia}select admin.set_policy('loyalty.earn_rate', '{"qar_per_point_minor": 500}', 'unconfirmed_default', 'test');`;
      assert.equal(db.ok(`${rate}${newOrder({ items: oneItem(123450), into: "l1" })}${deliver("l1", 123450)}${AS.superuser}select points from public.loyalty_ledger where order_id = :'l1';`).split("\n").pop(), "246");
      for (const [rounding, expected] of [["floor", "123"], ["ceil", "124"], ["round", "123"]]) {
        const policy = `${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "order_total", "rounding": "${rounding}"}', 'unconfirmed_default', 'test');`;
        assert.equal(db.ok(`${policy}${newOrder({ items: oneItem(123450), into: "l1" })}${deliver("l1", 123450)}${AS.superuser}select points from public.loyalty_ledger where order_id = :'l1';`).split("\n").pop(), expected, rounding);
      }
    });

    it("can award on the amount paid, and when the order is delivered without full payment if the policy allows", () => {
      const relaxed = `${AS.olivia}select admin.set_policy('loyalty.award_trigger', '{"on_status": "delivered", "require_full_payment": false}', 'unconfirmed_default', 'test');
        select admin.set_policy('loyalty.earning_base', '{"base": "amount_paid", "rounding": "floor"}', 'unconfirmed_default', 'test');
        ${newOrder({ into: "l1" })}${AS.olivia}
        select admin.record_payment(:'l1', 'deposit', 200000, 'cash');
        select admin.transition_order(:'l1', 'awaiting_deposit'); select admin.transition_order(:'l1', 'deposit_received'); select admin.transition_order(:'l1', 'sourcing');
        select admin.transition_order(:'l1', 'building'); select admin.transition_order(:'l1', 'quality_check'); select admin.transition_order(:'l1', 'ready_for_delivery'); select admin.transition_order(:'l1', 'delivered');`;
      assert.equal(db.ok(`${relaxed}${AS.superuser}select points from public.loyalty_ledger where order_id = :'l1';`).split("\n").pop(), "200");
    });

    it("an award can be reversed once, and the reason stays private", () => {
      const base = `${newOrder({ items: oneItem(100000), into: "l1" })}${deliver("l1", 100000)}${AS.olivia}`;
      assert.equal(db.ok(`${base}select admin.reverse_loyalty_award(:'l1', 'order refunded');${AS.superuser}select sum(points) || ':' || count(*) from public.loyalty_ledger where order_id = :'l1';`).split("\n").pop(), "0:2");
      db.denied(`${base}select admin.reverse_loyalty_award(:'l1', 'once'); select admin.reverse_loyalty_award(:'l1', 'twice');`, "", /already been reversed/);
      db.denied(`${newOrder({ into: "x1" })}${AS.olivia}select admin.reverse_loyalty_award(:'x1', 'nothing to reverse');`, "", /no loyalty award to reverse/);
      assert.equal(db.ok(`${base}select admin.reverse_loyalty_award(:'l1', 'order refunded');${AS.superuser}select reason from private.loyalty_entry_reasons where reason = 'order refunded';`).split("\n").pop(), "order refunded");
    });

    it("a customer sees their points and a generic description, never the reason", () => {
      const base = `${newOrder({ items: oneItem(100000), into: "l1" })}${deliver("l1", 100000)}${AS.olivia}select admin.reverse_loyalty_award(:'l1', '${SENTINEL.reason}');`;
      const out = db.ok(`${base}${AS.alice}select string_agg(entry_type || ':' || points || ':' || description, '|' order by created_at, points desc) from public.loyalty_ledger;`);
      assert.match(out.split("\n").pop(), /^award:100:Points earned on order O-\d{4}-\d{5}\|reversal:-100:Points reversed$/);
      assert.ok(!out.includes(SENTINEL.reason));
    });

    it("manual adjustments need a reason and permission, and are refused when they would make the balance negative", () => {
      const award = `${newOrder({ items: oneItem(100000), into: "l1" })}${deliver("l1", 100000)}${AS.olivia}`;
      assert.equal(db.ok(`${award}select admin.adjust_loyalty(:'custA', 25, 'goodwill gesture');${AS.superuser}select sum(points) from public.loyalty_ledger where customer_id = :'custA';`).split("\n").pop(), "125");
      db.denied(`${award}select admin.adjust_loyalty(:'custA', -101, 'too much');`, "", /negative; whether that is allowed is undecided \(OQ-0010\)/);
      db.denied(`${award}select admin.adjust_loyalty(:'custA', 5, '');`, "", /reason is required/);
      db.denied(`${award}select admin.adjust_loyalty(:'custA', 0, 'nothing');`, "", /non-zero/);
      assert.equal(db.ok(`${award}select admin.set_policy('loyalty.negative_balance', '{"allowed": true}', 'unconfirmed_default', 'test');select admin.adjust_loyalty(:'custA', -101, 'allowed now');${AS.superuser}select sum(points) from public.loyalty_ledger where customer_id = :'custA';`).split("\n").pop(), "-1");
    });

    it("no balance can be supplied: there is no balance column to write, only the ledger", () => {
      assert.equal(db.ok("select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('customers','loyalty_ledger') and column_name ~* 'balance|points_total';", AS.superuser), "0");
      db.denied("insert into public.loyalty_balances (customer_id, balance_points, entries) values (:'custA', 99999, 1);", AS.alice, /permission denied|cannot insert/);
    });

    it("redemption does not exist yet: no entry type and no function spends points", () => {
      db.denied("select private.set_write_ctx(true); insert into public.loyalty_ledger (customer_id, entry_type, points, description) values (:'custA', 'redemption', -10, 'x');", AS.superuser, /loyalty_ledger_entry_type_check/);
      assert.equal(db.ok("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('admin','public','private') and p.proname ~* 'redeem|redemption|spend';", AS.superuser), "0");
    });
  });

  // =================================================================================================================
  describe("customer accounts: claim codes and self sign-up", () => {
    const issue = `${AS.sam}select admin.issue_claim_code(:'custA') as code \\gset\n`;

    it("issues a code that is shown once and stored only as a hash", () => {
      const out = db.ok(`${issue}select :'code';`);
      const code = out.split("\n").pop();
      assert.match(code, /^[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}$/);
      const stored = db.ok(`${issue}${AS.superuser}select octet_length(code_hash) || ':' || (select count(*) from private.customer_claim_codes where code_hash = sha256(convert_to(replace(:'code', '-', ''), 'UTF8'))) from private.customer_claim_codes order by created_at desc limit 1;`);
      assert.equal(stored.split("\n").pop(), "32:1");
      assert.equal(db.ok("select count(*) from information_schema.columns where table_schema = 'private' and table_name = 'customer_claim_codes' and data_type in ('text', 'character varying');", AS.superuser), "0", "no column can hold the code in clear");
    });

    it("all 20 characters of a code are random: no position is fixed or confined to a few values", () => {
      const out = db.ok("select admin.issue_claim_code(:'custA') from generate_series(1, 200);", AS.sam);
      const codes = out.split("\n").filter((l) => /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/.test(l)).map((c) => c.replaceAll("-", ""));
      assert.equal(codes.length, 200);
      assert.equal(new Set(codes).size, 200, "codes must not repeat");
      for (let position = 0; position < 20; position += 1) {
        const seen = new Set(codes.map((c) => c[position]));
        // A hex digit has 16 values; 200 samples cover almost all of them. A fixed digit (such as the version digit of a
        // UUID) or a two-bit one would show 1 or 4 values here.
        assert.ok(seen.size >= 10, `position ${position + 1} showed only ${seen.size} different characters`);
      }
    });

    it("lets a signed-in person join the customer record with the code, exactly once", () => {
      const claim = `${issue}${AS.eve}select public.claim_customer_profile(:'code') as got \\gset\n`;
      assert.equal(db.ok(`${claim}select :'got';`).split("\n").pop(), ID.custA);
      assert.equal(db.ok(`${claim}select string_agg(id::text, ',') from public.customers;`).split("\n").pop(), ID.custA);
      assert.equal(db.ok(`${claim}${AS.dana}select coalesce(public.claim_customer_profile(:'code')::text, 'null');`).split("\n").pop(), "null", "a used code is dead");
    });

    it("answers a wrong, malformed, expired or reused code the same way: null", () => {
      assert.equal(db.ok(`${AS.eve}select coalesce(public.claim_customer_profile('AAAAA-AAAAA-AAAAA-AAAAA')::text, 'null');`).split("\n").pop(), "null");
      assert.equal(db.ok(`${AS.eve}select coalesce(public.claim_customer_profile('short')::text, 'null');`).split("\n").pop(), "null");
      assert.equal(db.ok(`${AS.eve}select coalesce(public.claim_customer_profile(null)::text, 'null');`).split("\n").pop(), "null");
      assert.equal(db.ok(`${issue}${AS.superuser}update private.customer_claim_codes set expires_at = now() - interval '1 minute';${AS.eve}select coalesce(public.claim_customer_profile(:'code')::text, 'null');`).split("\n").pop(), "null");
    });

    it("rate limits guessing: after five failures even the right code is refused", () => {
      const tries = Array.from({ length: 5 }, (_, i) => `select public.claim_customer_profile('0000${i}-00000-00000-00000');`).join("\n");
      assert.equal(db.ok(`${issue}${AS.eve}${tries}\nselect coalesce(public.claim_customer_profile(:'code')::text, 'null');`).split("\n").pop(), "null");
      assert.equal(db.ok(`${issue}${AS.eve}${tries}${AS.superuser}select count(*) from private.claim_attempts where not success;`).split("\n").pop(), "5", "every failure is counted");
    });

    it("never links an account to an existing customer because their email or phone looks the same", () => {
      assert.equal(db.ok("select count(*) from public.customers;", AS.eve), "0");
      assert.equal(db.ok("select count(*) from public.customer_accounts;", AS.eve), "0");
    });

    it("refuses a code from someone who already has a customer record", () => {
      db.denied(`${issue}${AS.bob}select public.claim_customer_profile(:'code');`, "", /already has a customer profile/);
    });

    it("a signed-in person can create their own customer profile once, and sees only that", () => {
      const out = db.ok(`${AS.eve}select public.create_my_customer_profile('Eve Test', '+97455550003', 'eve@example.test', 'ar') as mine \\gset\nselect full_name || ':' || preferred_language || ':' || source from public.customers where id = :'mine';`);
      assert.equal(out.split("\n").pop(), "Eve Test:ar:website");
      db.denied(`${AS.eve}select public.create_my_customer_profile('Eve');select public.create_my_customer_profile('Eve again');`, "", /already has a customer profile/);
      assert.equal(db.ok(`${AS.eve}select public.create_my_customer_profile('Eve');select count(*) from public.customers;`).split("\n").pop(), "1");
    });

    it("an administrator can link an account explicitly", () => {
      assert.equal(db.ok(`${AS.sam}select admin.link_customer_account(:'eve', :'custB');${AS.eve}select string_agg(id::text, ',') from public.customers;`).split("\n").pop(), ID.custB);
      db.denied(`${AS.alice}select admin.link_customer_account(:'eve', :'custB');`, "", /permission denied: customers\.manage/);
    });

    it("customer notes are staff only", () => {
      db.ok(`${AS.sam}select admin.add_customer_note(:'custA', 'prefers evening calls');`);
      db.denied("select * from private.customer_notes;", AS.alice, /permission denied/);
    });
  });

  // =================================================================================================================
  describe("quotations stay open to guests and never depend on an account", () => {
    it("a guest quotation (no account, no customer) can be stored by the server and is invisible to every customer", () => {
      const out = db.ok(`insert into public.quotations (guest_name, guest_phone, category, product_preference, requested_specs)
        values ('Visitor Test', '+97455550010', 'Complete Custom PC', 'Not sure', '{"use": "gaming"}') returning status || ':' || (customer_id is null)::text;`, AS.service);
      assert.equal(out.split("\n")[0], "submitted:true");
      assert.equal(db.ok("select count(*) from public.quotations where guest_name is not null;", AS.alice), "0");
      assert.equal(db.ok("select count(*) from public.quotations where guest_name is not null;", AS.sam), "1");
    });

    it("anonymous visitors cannot write a quotation directly: the endpoint must run on the server with the service role", () => {
      db.denied("insert into public.quotations (guest_name, guest_phone, category, product_preference) values ('V', '+97455550011', 'Mouse', 'Not sure');", AS.anon, /permission denied/);
    });

    it("staff price a quotation: in_review, then quoted with a price and lines that the customer then sees", () => {
      const out = db.ok(`${AS.sam}insert into public.quotations (id, customer_id, category, product_preference) values ('00000000-0000-4000-8000-0000000000e3', :'custA', 'Monitor', 'Not sure');
        update public.quotations set status = 'in_review' where id = '00000000-0000-4000-8000-0000000000e3';
        insert into public.quotation_lines (quotation_id, position, description, unit_price_minor) values ('00000000-0000-4000-8000-0000000000e3', 1, 'Monitor', 150000);
        ${AS.alice}select count(*) from public.quotation_lines where quotation_id = '00000000-0000-4000-8000-0000000000e3';
        ${AS.sam}update public.quotations set status = 'quoted', quoted_total_minor = 150000 where id = '00000000-0000-4000-8000-0000000000e3';
        ${AS.alice}select count(*) from public.quotation_lines where quotation_id = '00000000-0000-4000-8000-0000000000e3';`);
      assert.deepEqual(out.split("\n"), ["0", "1"]);
    });

    it("a signed-in person without the permission cannot move a quotation, and a deactivated staff member cannot either", () => {
      for (const who of [AS.eve, AS.dana]) {
        assert.equal(db.ok(`update public.quotations set status = 'in_review' where id = '00000000-0000-4000-8000-0000000000d3' returning id;
          reset role; select status from public.quotations where id = '00000000-0000-4000-8000-0000000000d3';`, who), "submitted");
      }
    });
  });
});
