// THE STAFF MEMBER'S OWN DISPLAY NAME FOR THE PUBLIC HEADER, IN THE DATABASE. A real PostgreSQL 16, the real migrations, the real function
// (admin.my_staff_profile, migration 20261127120000) and the website's own gateway statement (read out of src/lib/staff/gateway.ts), run exactly as the website
// runs it: the gateway database role, the person's verified claims, and a live sign-in session row in the auth schema.
//
// What is proved:
//   * an active staff member gets their OWN display name from the staff table, and nothing else (no role, no permission, no other person), whether the call
//     comes through the gateway or straight from a signed-in session, and without the second factor (like admin.is_staff_member, it decides what to show);
//   * everyone else gets null: a customer, a person with no staff row, a deactivated staff member, forged claims (authorization never reads them), anonymous
//     callers (no right to call it at all), and, through the gateway, a sign-in session that is missing, ended, expired, someone else's, or not named;
//   * a staff member with no name set (or only blanks) gets {"display_name": null}: the header then shows its neutral label, never an invented name;
//   * it agrees with admin.is_staff_member() for every kind of caller, so the header and the dashboard guard can never disagree about who is staff;
//   * privileges: signed-in sessions and the gateway only (never anon, PUBLIC or service_role); a security definer with a fixed search path; the migration is
//     one additive function, rerunnable, and changes nothing that already exists.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { SESSION, lines, makeHelpers, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const MIGRATION = "20261127120000_staff_header_profile.sql";
const FN = "admin.my_staff_profile()";
const GATEWAY = readFileSync(join(ROOT, "src/lib/staff/gateway.ts"), "utf8");

suite("the staff member's own display name for the public header, in the database", () => {
  let db;
  let h;

  const scalar = (sql, who = "") => (lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "").trim();
  /** The answer of the function for a direct (signed-in session) caller: parsed JSON, or null when the database answers null. */
  const direct = (who) => {
    const text = scalar(`select ${FN}`, who);
    return text === "" ? null : JSON.parse(text);
  };
  /** The same call as the website makes it (the gateway's own statement), optionally after a change made as the superuser in the same transaction. */
  // (psql prints the claims the gateway call sets, then the answer; an answer of null prints nothing, so the answer is the line that holds the key.)
  const answerOf = (out) => {
    const line = lines(out).find((l) => l.includes('"display_name"'));
    return line ? JSON.parse(line.trim()) : null;
  };
  const gateway = (who, before = "") => answerOf(db.ok(`${before}\n${h.gatewayCall(who, "my_staff_profile", [])}`));
  const alice = (sid) => ({ sub: ID.alice, sid });
  const withSession = (sid, user, extra = "") => `insert into auth.sessions (id, user_id, aal${extra ? ", not_after" : ""}) values ('${sid}', '${user}', 'aal2'${extra ? `, ${extra}` : ""});`;
  const blankName = (user, value) => `set local session_replication_role = replica;\nupdate private.staff_members set display_name = ${value} where user_id = '${user}';\nset local session_replication_role = origin;`;

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db, { probes: false });
    h = makeHelpers(db);
  });
  after(() => db?.stop());

  describe("who gets a name", () => {
    it("an active staff member gets exactly their own display name, and nothing else, straight from a signed-in session", () => {
      assert.deepEqual(direct(AS.olivia), { display_name: "Owner (test)" });
      assert.deepEqual(direct(AS.sam), { display_name: "Staff (test)" });
      assert.deepEqual(Object.keys(direct(AS.olivia)), ["display_name"], "no role, no permission, no e-mail address, no identifier");
    });

    it("through the gateway, with a live sign-in session, the same: the owner's name and an ordinary staff member's name", () => {
      assert.deepEqual(gateway(h.OLIVIA), { display_name: "Owner (test)" });
      assert.deepEqual(gateway(h.SAM), { display_name: "Staff (test)" });
    });

    it("it does not need the second factor (it decides what to show before the second step) and still returns only the name", () => {
      assert.deepEqual(direct(AS.oliviaAal1), { display_name: "Owner (test)" });
      const aal1Session = randomUUID();
      const out = answerOf(db.ok(`insert into auth.sessions (id, user_id, aal) values ('${aal1Session}', '${ID.sam}', 'aal1');\n${h.gatewayCall({ sub: ID.sam, sid: aal1Session }, "my_staff_profile", [])}`));
      assert.deepEqual(out, { display_name: "Staff (test)" });
    });

    it("a staff member with no name set (or only blanks) gets {display_name: null}: the header shows its neutral label, never an invented name", () => {
      // (the database trims blanks; a name made only of tabs or direction marks is cleaned away by the website, see cleanDisplayName)
      for (const value of ["null", "'   '"]) {
        const out = scalar(`select ${FN}`, `${blankName(ID.sam, value)}\n${AS.sam}`);
        assert.deepEqual(JSON.parse(out), { display_name: null }, value);
      }
      assert.deepEqual(answerOf(db.ok(`${blankName(ID.olivia, "null")}\n${h.gatewayCall(h.OLIVIA, "my_staff_profile", [])}`)), { display_name: null });
    });

    it("surrounding blanks in a stored name are trimmed", () => {
      const out = scalar(`select ${FN}`, `${blankName(ID.sam, "'  Sam Ali  '")}\n${AS.sam}`);
      assert.deepEqual(JSON.parse(out), { display_name: "Sam Ali" });
    });
  });

  describe("who does not", () => {
    it("customers, a person with no staff row, and a deactivated staff member get null", () => {
      for (const [label, who] of [["alice (customer)", AS.alice], ["bob (customer)", AS.bob], ["eve (signed in, no records)", AS.eve], ["dana (staff, deactivated)", AS.dana]]) {
        assert.equal(direct(who), null, label);
      }
    });

    it("forged claims change nothing: a customer who claims to be an admin or an owner in their token gets null", () => {
      assert.equal(direct(AS.forgedAdmin), null);
    });

    it("anonymous callers and the service role have no right to call it at all", () => {
      db.denied(`select ${FN};`, AS.anon, /permission denied/);
      db.denied(`select ${FN};`, AS.service, /permission denied/);
    });

    it("through the gateway a customer's live session gets null, however the staff table reads", () => {
      const sid = randomUUID();
      assert.equal(gateway(alice(sid), withSession(sid, ID.alice)), null);
    });

    it("through the gateway, a sign-in session that is missing, ended, expired, someone else's, or not named gets null", () => {
      // ended (signing out deletes the row)
      assert.equal(gateway(h.OLIVIA, `delete from auth.sessions where id = '${SESSION.olivia}';`), null, "ended session");
      // expired
      assert.equal(gateway(h.OLIVIA, `update auth.sessions set not_after = now() - interval '1 hour' where id = '${SESSION.olivia}';`), null, "expired session");
      // somebody else's session id presented with the owner's user id
      assert.equal(gateway({ sub: ID.olivia, sid: SESSION.sam }), null, "another person's session");
      // an id that exists nowhere
      assert.equal(gateway({ sub: ID.olivia, sid: randomUUID() }), null, "a session id the auth service never issued");
      // no session id in the claims at all
      assert.equal(gateway({ sub: ID.olivia, sid: null }), null, "no session named");
    });

    it("a session that has not expired yet still counts", () => {
      assert.deepEqual(gateway(h.OLIVIA, `update auth.sessions set not_after = now() + interval '1 hour' where id = '${SESSION.olivia}';`), { display_name: "Owner (test)" });
    });
  });

  describe("it agrees with admin.is_staff_member for every caller", () => {
    it("a person has a profile exactly when the staff check says yes, direct and through the gateway", () => {
      for (const [label, who] of [["olivia", AS.olivia], ["sam", AS.sam], ["dana (inactive)", AS.dana], ["alice", AS.alice], ["eve", AS.eve], ["forged admin", AS.forgedAdmin], ["olivia without the second factor", AS.oliviaAal1]]) {
        const isStaff = scalar("select admin.is_staff_member()", who) === "t";
        assert.equal(direct(who) !== null, isStaff, label);
      }
      for (const who of [h.OLIVIA, h.SAM]) {
        const check = lines(db.ok(h.gatewayCall(who, "is_staff_member", []))).filter((l) => /^[tf]$/.test(l.trim())).pop().trim();
        assert.equal(check, "t");
        assert.notEqual(gateway(who), null);
      }
      const sid = randomUUID();
      const customerCheck = lines(db.ok(`${withSession(sid, ID.alice)}\n${h.gatewayCall(alice(sid), "is_staff_member", [])}`)).filter((l) => /^[tf]$/.test(l.trim())).pop().trim();
      assert.equal(customerCheck, "f");
      assert.equal(gateway(alice(sid), withSession(sid, ID.alice)), null);
    });
  });

  describe("privileges and the migration itself", () => {
    it("signed-in sessions and the gateway can execute it; anon, PUBLIC and service_role cannot", () => {
      const grant = (role) => scalar(`select has_function_privilege('${role}', '${FN}', 'execute')`);
      assert.equal(grant("authenticated"), "t");
      assert.equal(grant("m1_staff_gateway"), "t");
      for (const role of ["anon", "public", "service_role"]) assert.equal(grant(role), "f", role);
    });

    it("it is a security definer with a fixed, empty search path and a stable volatility, in schema admin", () => {
      const row = scalar(`select prosecdef::text || '|' || provolatile::text || '|' || coalesce(array_to_string(proconfig, ','), '') || '|' || pronamespace::regnamespace::text from pg_proc where oid = '${FN}'::regprocedure`);
      assert.equal(row, 'true|s|search_path=""|admin');
    });

    it("the gateway's statement is fixed text with no parameters, and the function is on the read list (it writes nothing)", () => {
      assert.match(GATEWAY, /my_staff_profile: "select admin\.my_staff_profile\(\) as r",/);
      const writes = /const WRITE_CALLS[\s\S]*?\]\);/.exec(GATEWAY)[0];
      assert.doesNotMatch(writes, /my_staff_profile/, "reading a name is not a write");
    });

    it("the migration is one additive function: nothing is dropped or altered, and nothing that exists is replaced", () => {
      const sql = readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8");
      const code = sql.replace(/--[^\n]*/g, "");
      assert.equal((code.match(/create or replace function /g) ?? []).length, 1);
      assert.match(code, /create or replace function admin\.my_staff_profile\(\)/);
      assert.doesNotMatch(code, /\bdrop\b|\balter\s+table\b|\bdelete\s+from\b|\btruncate\b|\binsert\s+into\b|\bupdate\s+private\b/i);
      assert.match(code, /revoke all on function admin\.my_staff_profile\(\) from public, anon, service_role/);
      assert.match(code, /grant execute on function admin\.my_staff_profile\(\) to authenticated, m1_staff_gateway/);
    });

    it("it is rerunnable: applying the migration again changes nothing and still passes its own checks", () => {
      const sql = readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8");
      const before = scalar(`select md5(prosrc || coalesce(proacl::text, '')) from pg_proc where oid = '${FN}'::regprocedure`);
      db.ok(sql);
      db.ok(`${sql}\n${sql}`);
      assert.equal(scalar(`select md5(prosrc || coalesce(proacl::text, '')) from pg_proc where oid = '${FN}'::regprocedure`), before);
    });

    it("every earlier admin function is untouched by it (the migration adds exactly one function to schema admin)", () => {
      const names = scalar("select count(*) from pg_proc where pronamespace = 'admin'::regnamespace and proname = 'my_staff_profile'");
      assert.equal(names, "1");
      assert.equal(scalar("select count(*) from pg_proc where pronamespace = 'admin'::regnamespace and proname in ('is_staff_member', 'my_permissions', 'list_orders_overview')"), "3");
    });
  });
});
