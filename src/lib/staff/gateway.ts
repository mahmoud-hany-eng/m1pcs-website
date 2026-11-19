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
/** A refusal that carries a message written for staff (a business rule, a validation). Safe to show. */
export class StaffOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffOperationError";
  }
}
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
  get_order: "select admin.get_order($1::uuid) as r",
  create_order: "select admin.create_order($1::uuid, $2::jsonb, null, 'admin', $3::text, $4::text) as r",
  transition_order: "select admin.transition_order($1::uuid, $2::text, $3::text)::text as r",
  publish_tracking_event: "select admin.publish_tracking_event($1::uuid, $2::text, $3::text, $4::text) as r",
  retract_tracking_event: "select admin.retract_tracking_event($1::uuid, $2::text)::text as r",
  record_payment: "select admin.record_payment($1::uuid, $2::text, $3::bigint, $4::text, now(), null, $5::text, $6::text) as r",
  reverse_payment: "select admin.reverse_payment($1::uuid, $2::text) as r",
  list_payments: "select admin.list_payments($1::integer, $2::integer) as r",
  list_loyalty: "select admin.list_loyalty($1::uuid, $2::integer) as r",
  list_policies: "select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) as r from admin.list_policies() t",
  list_policy_versions: "select admin.list_policy_versions($1::text) as r",
  set_policy: "select admin.set_policy($1::text, $2::jsonb, $3::text, $4::text) as r",
  list_audit: "select admin.list_audit($1::integer) as r",
} as const;

export type StaffCallName = keyof typeof CALLS;

let pool: Pool | null = null;

/** True when the gateway secret is set. The value itself is never logged or returned. */
export function isGatewayConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.STAFF_GATEWAY_DATABASE_URL);
}

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.STAFF_GATEWAY_DATABASE_URL;
  if (!connectionString) throw new StaffUnavailableError("The staff gateway is not configured.");
  pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: "m1-staff-gateway",
  });
  // A broken idle connection must not crash the server.
  pool.on("error", () => {});
  return pool;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database's own messages for the business rules are written for staff; an unexpected error shows nothing. */
function mapError(error: unknown): Error {
  const e = error as { code?: string; message?: string };
  const message = typeof e?.message === "string" ? e.message : "";
  switch (e?.code) {
    case "42501":
      return new StaffPermissionError();
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
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "ETIMEDOUT":
    case "57P03":
    case "08006":
    case "08001":
      return new StaffUnavailableError();
    default:
      // Never echo an unknown error to a screen: it could name a table or a column. The code goes to the server log.
      console.error(`[staff] unexpected database error (${e?.code ?? "no code"})`);
      return new StaffUnavailableError("Something went wrong. Nothing was changed.");
  }
}

/**
 * Runs one listed staff function as the verified person, in one transaction. Returns the function's single result.
 * Nothing is committed unless the function succeeds.
 */
export async function staffCall<T>(staff: VerifiedStaff, name: StaffCallName, params: readonly unknown[] = []): Promise<T> {
  if (!UUID.test(staff.userId) || !UUID.test(staff.sessionId)) throw new StaffPermissionError();
  const sql = CALLS[name];
  let client: PoolClient | null = null;
  try {
    client = await getPool().connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '10s'");
    // The claims the staff functions read through auth.uid() and auth.jwt(): the person, the assurance level the
    // server verified, and the sign-in session the database will check against the auth service's own record.
    const claims = JSON.stringify({ sub: staff.userId, role: "authenticated", aal: "aal2", session_id: staff.sessionId, email: staff.email ?? undefined });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const result = await client.query(sql, [...params]);
    await client.query("commit");
    return result.rows[0]?.r as T;
  } catch (error) {
    if (client) await client.query("rollback").catch(() => {});
    throw error instanceof StaffUnavailableError ? error : mapError(error);
  } finally {
    client?.release();
  }
}

/** Closes the pool (used by tests and on shutdown). */
export async function closeGateway(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end().catch(() => {});
}
