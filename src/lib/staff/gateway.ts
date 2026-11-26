/**
 * The staff gateway: the ONLY place the website opens a database connection, and the only code that can run a staff
 * function. Server only: it is imported by server actions and server components of the admin area and by nothing
 * that reaches a browser (a static test enforces that).
 *
 * How it works (design and review in docs/project-memory/architecture/STAFF_GATEWAY.md):
 *   1. The caller has already authenticated the person on the server (`getUser()` asks the auth service) and read
 *      the assurance level and session id from the verified token. This module takes that identity as an argument.
 *   2. It connects with a dedicated login role (`m1_staff_gateway`) held in a server-only secret. That role is not
 *      `service_role`, not `postgres`, and not a member of any API role. It has NO table privilege and can execute
 *      only the functions of schema `admin`. It cannot become another role.
 *   3. In ONE transaction it sets the verified claims for that transaction and runs ONE call from the fixed list
 *      below, with every value as a bound parameter. No SQL text is ever built from request data.
 *   4. The database does not take the claims on trust: for a gateway connection it checks the sign-in session in the
 *      auth service's own table (it must exist, belong to that user, be unexpired and be second-factor), then applies
 *      the staff table, the permission and the MFA policy exactly as it does for any other caller.
 *
 * What a leak of the gateway secret would allow: running the listed staff functions as a person who is active staff
 * AND whose live second-factor session id is known. It would not allow reading a table, running other SQL, or acting
 * as a customer.
 */
import "server-only";
import { Pool, type PoolClient } from "pg";
import { gatewayConnection, GatewayConfigError } from "./gateway-tls";
import { classifyGatewayFailure, logStaffDiagnostic } from "./diagnostics";

/** Who is acting. Built by the session guard from verified claims; never from request input. */
export interface VerifiedStaff {
  userId: string;
  sessionId: string;
  email: string | null;
}

/** A person the staff table does not name, or without the permission. Shown as "you cannot do that". */
export class StaffPermissionError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "StaffPermissionError";
  }
}
/**
 * A refusal that carries a message written for staff (a business rule, a validation). Safe to show.
 * `retireKey` is true when the request's idempotency key already belongs to a finished or different request, so the form
 * must take a new key before it is sent again.
 */
export class StaffOperationError extends Error {
  readonly retireKey: boolean;
  constructor(message: string, options: { retireKey?: boolean } = {}) {
    super(message);
    this.name = "StaffOperationError";
    this.retireKey = options.retireKey === true;
  }
}
/**
 * The ONE case in which this module cannot say whether a change was saved: the COMMIT was sent and the connection failed
 * before the answer came back. Every other failure is either reported by the database (the transaction was rolled back) or
 * happened before COMMIT was sent (the transaction can only be rolled back), so "nothing was changed" is true for them.
 */
export class StaffOutcomeUnknownError extends Error {
  readonly repeatIsSafe: boolean;
  constructor(repeatIsSafe: boolean) {
    super(repeatIsSafe ? OUTCOME_UNKNOWN_REPEAT_SAFE : OUTCOME_UNKNOWN);
    this.name = "StaffOutcomeUnknownError";
    this.repeatIsSafe = repeatIsSafe;
  }
}
export const OUTCOME_UNKNOWN =
  "The connection was lost before we could confirm the result, so this may or may not have been saved. Reload the page and check before trying again.";
export const OUTCOME_UNKNOWN_REPEAT_SAFE =
  "The connection was lost before we could confirm the result, so this may or may not have been saved. Reload the page and look in the list before doing anything else; record it again only if it is not there. If instead you send this same form again without reloading, within the hour, it will not be saved twice.";
export const UNAVAILABLE_NOTHING_CHANGED = "The staff service is not available right now. Nothing was changed. Try again in a moment.";
export const TOO_SLOW = "This took too long and was cancelled. Nothing was changed. Try again in a moment.";
export const UNEXPECTED = "Something went wrong. Nothing was changed.";
/** The gateway is not configured or the database could not be reached. */
export class StaffUnavailableError extends Error {
  constructor(message = "The staff service is not available.") {
    super(message);
    this.name = "StaffUnavailableError";
  }
}

/** Every call the website can make. Fixed text, bound parameters: this list IS the interface. */
const CALLS = {
  is_staff_member: "select admin.is_staff_member() as r",
  // The signed-in staff member's OWN display name for the public header (null for anyone who is not active staff). Read only; no role, permission or other person.
  my_staff_profile: "select admin.my_staff_profile() as r",
  my_permissions: "select coalesce(jsonb_agg(p), '[]'::jsonb) as r from admin.my_permissions() p",
  dashboard_summary: "select admin.dashboard_summary() as r",
  preview_deposit: "select admin.preview_deposit($1::bigint) as r",
  search_customers: "select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) as r from admin.search_customers($1::text, $2::integer) t",
  get_customer: "select admin.get_customer($1::uuid) as r",
  create_customer: "select admin.create_customer($1::text, $2::text, $3::text, $4::text, $5::text, $6::text) as r",
  issue_claim_code: "select admin.issue_claim_code($1::uuid, $2::integer) as r",
  revoke_claim_code: "select admin.revoke_claim_code($1::uuid, $2::text)::text as r",
  list_claim_codes: "select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) as r from admin.list_claim_codes($1::uuid) t",
  list_orders: "select admin.list_orders($1::text, $2::text, $3::integer, $4::integer) as r",
  // The Orders page: filter by search, status and the Qatar date an order was placed, sort, count and page, all in the database (admin.list_orders_page).
  list_orders_page: "select admin.list_orders_page($1::text, $2::text, $3::integer, $4::integer, $5::date, $6::date, $7::text, $8::integer, $9::integer) as r",
  get_order: "select admin.get_order($1::uuid) as r",
  // The simplified Orders page: one page of orders with the order price, and (by permission, decided by the database) cost, profit and the receipts.
  list_orders_overview: "select admin.list_orders_overview($1::text, $2::text, $3::integer, $4::integer, $5::date, $6::date, $7::text, $8::integer, $9::integer) as r",
  // PDF receipts on an order. The file travels as a bound bytea parameter, never as text in the statement. Adding is keyed by the receipt id the form chose.
  add_order_receipt: "with c as materialized (select admin.add_order_receipt($1::uuid, $2::uuid, $3::text, $4::bytea) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  remove_order_receipt: "with c as materialized (select admin.remove_order_receipt($1::uuid, $2::text) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  get_order_receipt: "select admin.get_order_receipt($1::uuid) as r",
  // The three keyed calls also report whether the answer is a REPEAT of an earlier request (the database sets the
  // transaction-local flag m1.replayed), so the screen can say "already recorded" instead of "recorded".
  create_order: "with c as materialized (select admin.create_order($1::uuid, $2::jsonb, null::uuid, 'admin'::text, $3::text, $4::text, $5::text) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  // The order form with a Pricing & Rewards section: the same order, plus its discount ($6, owner only), the points to redeem ($7, owner
  // only) and the net payable amount and deposit the screen showed ($8, $9), which the database checks against its own figures. The
  // idempotency key covers all of it: sending the form twice can neither create a second order nor spend the points twice. `create_order`
  // above is the earlier release's statement, kept until the contract step; the screens now use this one.
  create_order_priced: "with c as materialized (select admin.create_order($1::uuid, $2::jsonb, null::uuid, 'admin'::text, $3::text, $4::text, $5::text, $6::jsonb, $7::bigint, $8::bigint, $9::bigint) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  order_pricing_context: "select admin.order_pricing_context($1::uuid) as r",
  // The order with its Pricing & Rewards AND optional private costs ($10, a JSON list; owner only). Same checks and the same idempotency as `create_order_priced`.
  create_order_costed: "with c as materialized (select admin.create_order($1::uuid, $2::jsonb, null::uuid, 'admin'::text, $3::text, $4::text, $5::text, $6::jsonb, $7::bigint, $8::bigint, $9::bigint, $10::jsonb) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  // Private order costs (owner only: finance.read / finance.manage). The database checks the permission; none of these answers reaches a customer.
  order_costs: "select admin.order_costs($1::uuid) as r",
  add_order_cost: "with c as materialized (select admin.add_order_cost($1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::text, $7::text, $8::date, $9::text) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  edit_order_cost: "with c as materialized (select admin.edit_order_cost($1::uuid, $2::integer, $3::text, $4::text, $5::bigint, $6::text, $7::text, $8::date, $9::text, $10::text) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  void_order_cost: "with c as materialized (select admin.void_order_cost($1::uuid, $2::integer, $3::text) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  set_order_costs_complete: "select admin.set_order_costs_complete($1::uuid, $2::boolean, $3::text) as r",
  // Completion dates and reporting. The reporting date is completed_at in Asia/Qatar months, worked out in the database.
  order_completion: "select admin.order_completion($1::uuid) as r",
  verify_historical_completion: "select admin.verify_historical_completion($1::uuid, $2::timestamptz, $3::text)::text as r",
  financial_report: "select admin.financial_report($1::integer, $2::integer) as r",
  list_completed_orders: "select admin.list_completed_orders($1::integer, $2::integer, $3::integer, $4::integer) as r",
  overview_summary: "select admin.overview_summary($1::integer) as r",
  customer_orders: "select admin.customer_orders($1::uuid, $2::integer, $3::integer) as r",
  similar_orders: "select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) as r from admin.similar_orders($1::uuid, $2::jsonb, $3::text) t",
  transition_order: "select admin.transition_order($1::uuid, $2::text, $3::text)::text as r",
  publish_tracking_event: "select admin.publish_tracking_event($1::uuid, $2::text, $3::text, $4::text) as r",
  publish_tracking_update: "select admin.publish_tracking_update($1::uuid, $2::text, $3::text, $4::text, $5::timestamptz)::text as r",
  publish_tracking_correction: "select admin.publish_tracking_correction($1::uuid, $2::text, $3::text, $4::text, $5::timestamptz, $6::text, $7::uuid)::text as r",
  set_order_fulfillment_type: "select admin.set_order_fulfillment_type($1::uuid, $2::text, $3::text)::text as r",
  adopt_new_workflow: "select admin.adopt_new_workflow($1::uuid, $2::text, $3::text, $4::text) as r",
  retract_tracking_event: "select admin.retract_tracking_event($1::uuid, $2::text)::text as r",
  record_payment: "with c as materialized (select admin.record_payment($1::uuid, $2::text, $3::bigint, $4::text, null::timestamptz, null::text, $5::text, $6::text, $7::text, $8::bigint) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c",
  reverse_payment: "select admin.reverse_payment($1::uuid, $2::text) as r",
  list_payments: "select admin.list_payments($1::integer, $2::integer) as r",
  list_loyalty: "select admin.list_loyalty($1::uuid, $2::integer) as r",
  list_policies: "select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) as r from admin.list_policies() t",
  list_policy_versions: "select admin.list_policy_versions($1::text) as r",
  set_policy: "select admin.set_policy($1::text, $2::jsonb, $3::text, $4::text) as r",
  list_audit: "select admin.list_audit($1::integer) as r",
} as const;

export type StaffCallName = keyof typeof CALLS;

/** The calls that change data. For these, "nothing was changed" must be TRUE whenever the screen says it. */
const WRITE_CALLS: ReadonlySet<StaffCallName> = new Set<StaffCallName>([
  "create_customer", "issue_claim_code", "revoke_claim_code", "create_order", "create_order_priced", "create_order_costed", "add_order_cost", "edit_order_cost",
  "void_order_cost", "set_order_costs_complete", "verify_historical_completion", "transition_order", "publish_tracking_event",
  "publish_tracking_update", "publish_tracking_correction", "set_order_fulfillment_type", "adopt_new_workflow", "retract_tracking_event", "record_payment", "reverse_payment", "set_policy",
  "add_order_receipt", "remove_order_receipt",
]);
/** The writes that carry an idempotency key: sending the same form again within the replay window cannot save it twice. */
const KEYED_CALLS: ReadonlySet<StaffCallName> = new Set<StaffCallName>([
  "create_order", "create_order_priced", "create_order_costed", "record_payment", "add_order_cost", "edit_order_cost", "void_order_cost", "set_order_costs_complete",
  "add_order_receipt", "remove_order_receipt",
]);
export const isWriteCall = (name: StaffCallName): boolean => WRITE_CALLS.has(name);

/** Client-side limit for one query; the database's own statement_timeout (10 s) normally answers first. */
export const QUERY_TIMEOUT_MS = 12_000;

let pool: Pool | null = null;

/** True when the gateway secret is set. The value itself is never logged or returned. */
export function isGatewayConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.STAFF_GATEWAY_DATABASE_URL);
}

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.STAFF_GATEWAY_DATABASE_URL;
  if (!connectionString) {
    logStaffDiagnostic({ stage: "config", reason: "env_missing" });
    throw new StaffUnavailableError("The staff gateway is not configured.");
  }
  // The database connection is always TLS-verified unless it is a loopback address (see gateway-tls.ts).
  let connection;
  try {
    connection = gatewayConnection(connectionString);
  } catch (error) {
    if (error instanceof GatewayConfigError) {
      logStaffDiagnostic({ stage: "config", reason: error.problem });
      throw new StaffUnavailableError("The staff gateway is not configured correctly.");
    }
    throw error;
  }
  pool = new Pool({
    ...connection,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    // The database cancels a statement after 10 s (see staffCallMeta). This client-side limit, a little longer, is for a connection that
    // goes silent without closing (a half-open socket): without it the call would wait for the platform's own timeout and the person
    // would never be told honestly that the result is unknown.
    query_timeout: QUERY_TIMEOUT_MS,
    application_name: "m1-staff-gateway",
  });
  // A broken idle connection must not crash the server, and neither must a late socket error on a connection that was already released or
  // destroyed: every pooled client keeps a no-op listener for its whole life.
  pool.on("error", () => {});
  pool.on("connect", (connected) => {
    connected.on("error", () => {});
  });
  return pool;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Stage = "connect" | "call" | "commit";

/**
 * Turns a failure into a message that is TRUE. The database's own messages for the business rules are written for staff; an
 * unknown error shows nothing about its cause. Where the message says "nothing was changed" it is because the failure came
 * from the database (which rolled the transaction back) or happened before COMMIT was sent (so the transaction can only
 * roll back). The one exception, a COMMIT whose answer never arrived, gets its own error that says so.
 */
function mapError(error: unknown, name: StaffCallName, stage: Stage): Error {
  const e = error as { code?: string; message?: string; severity?: string };
  const message = typeof e?.message === "string" ? e.message : "";
  const write = WRITE_CALLS.has(name);
  // Only an ordinary, non-fatal error report comes from the database answering us. A FATAL one, a reset socket or a
  // timeout means the connection itself failed.
  const reportedByDatabase = e?.severity === "ERROR" && stage !== "connect";
  if (reportedByDatabase) {
    switch (e?.code) {
      case "42501":
        return new StaffPermissionError();
      case "M1K01": // the key was used for a different request
      case "M1K02": // the key was used, and the original can no longer be confirmed (expired, reversed, cancelled)
        return new StaffOperationError(message.replace(/^.*?ERROR:\s*/, ""), { retireKey: true });
      case "M1K03": // the paid amount is not the one the person saw (the key was not used: the claim rolled back)
      case "P0002": // not found
      case "22023": // invalid parameter value (our validations)
      case "55000": // object not in the right state (our business rules)
      case "54000": // a limit
        // These are raised by our own functions with a message written for staff.
        return new StaffOperationError(message.replace(/^.*?ERROR:\s*/, ""));
      case "23505": // a unique index (a receipt reference already used, a second reversal)
        // The driver's text would name an index; the screen gets a fixed sentence instead.
        return new StaffOperationError("That value has already been used. Nothing was changed.");
      case "23514": // a check constraint
      case "23502": // a missing value
      case "23503": // a record that does not exist
        return new StaffOperationError("That change is not allowed. Nothing was changed.");
      case "57014": // statement_timeout: the database cancelled it and rolled back
        return new StaffUnavailableError(TOO_SLOW);
      default:
        // Never echo an unknown error to a screen: it could name a table or a column. The code goes to the server log.
        logStaffDiagnostic(classifyGatewayFailure(error));
        return new StaffUnavailableError(UNEXPECTED);
    }
  }
  logStaffDiagnostic(classifyGatewayFailure(error));
  // The connection failed. If COMMIT was already sent, the change may or may not have been saved.
  if (write && stage === "commit") return new StaffOutcomeUnknownError(KEYED_CALLS.has(name));
  // Before COMMIT was sent nothing can have been committed: the open transaction is rolled back when the connection ends.
  return new StaffUnavailableError(write ? UNAVAILABLE_NOTHING_CHANGED : "The staff service is not available right now. Try again in a moment.");
}

/**
 * Runs one listed staff function as the verified person, in one transaction. Returns the function's single result and
 * whether it was a repeat of an earlier request. Nothing is committed unless the function succeeds.
 */
export async function staffCallMeta<T>(staff: VerifiedStaff, name: StaffCallName, params: readonly unknown[] = []): Promise<{ value: T; replayed: boolean }> {
  if (!UUID.test(staff.userId) || !UUID.test(staff.sessionId)) throw new StaffPermissionError();
  const sql = CALLS[name];
  let client: PoolClient | null = null;
  let stage: Stage = "connect";
  let broken = false;
  // A connection that dies while a request is using it makes the driver emit an 'error' event on the checked-out client. With no
  // listener Node treats that as an uncaught exception and the whole server process goes down. The failure itself reaches us as the
  // rejected query below, so the event only needs to be absorbed.
  const absorb = () => {};
  try {
    client = await getPool().connect();
    client.on("error", absorb);
    await client.query("begin");
    await client.query("set local statement_timeout = '10s'");
    // The claims the staff functions read through auth.uid() and auth.jwt(): the person, the assurance level the
    // server verified, and the sign-in session the database will check against the auth service's own record.
    const claims = JSON.stringify({ sub: staff.userId, role: "authenticated", aal: "aal2", session_id: staff.sessionId, email: staff.email ?? undefined });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    stage = "call";
    const result = await client.query(sql, [...params]);
    stage = "commit";
    await client.query("commit");
    const row = result.rows[0] as { r?: unknown; replayed?: unknown } | undefined;
    return { value: row?.r as T, replayed: row?.replayed === true };
  } catch (error) {
    broken = (error as { severity?: string } | null)?.severity !== "ERROR";
    // After a database error the connection is healthy and must be rolled back. After a connection failure it is not: asking it to roll back
    // would wait for another answer that may never come, so it is destroyed instead (the database rolls back an open transaction when the
    // connection ends).
    if (client && !broken) {
      try {
        await client.query("rollback");
      } catch {
        broken = true; // the connection could not even roll back: it is destroyed, never returned to the pool
      }
    }
    throw error instanceof StaffUnavailableError ? error : mapError(error, name, stage);
  } finally {
    client?.removeListener("error", absorb);
    client?.release(broken ? true : undefined);
  }
}

/** As staffCallMeta, for the many calls where "was it a repeat" does not matter. */
export async function staffCall<T>(staff: VerifiedStaff, name: StaffCallName, params: readonly unknown[] = []): Promise<T> {
  return (await staffCallMeta<T>(staff, name, params)).value;
}

/** Closes the pool (used by tests and on shutdown). */
export async function closeGateway(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end().catch(() => {});
}
