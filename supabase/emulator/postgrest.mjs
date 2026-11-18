// A small subset of PostgREST's query language, translated to SQL, for the LOCAL EMULATOR.
//
// This is NOT PostgREST. It supports only what the customer-account code issues: select with column lists, simple
// filters, order, limit, a single-row update, and calls to the two customer functions. Anything else is refused. The
// translator is deliberately strict because it builds SQL from request text: identifiers are checked against a
// whitelist and a pattern, and every value is passed as a quoted literal. The SQL then runs as the caller's database
// role with the caller's claims, so row level security and column grants are enforced by PostgreSQL itself.

export class RestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Exactly the tables and views the customer API exposes (schema public).
export const EXPOSED_RELATIONS = new Set([
  "customers", "customer_accounts", "quote_categories", "quotations", "quotation_lines", "order_statuses",
  "orders", "order_items", "order_tracking_events", "payments", "loyalty_ledger", "loyalty_balances",
]);
// The only tables a customer session may update, and only through column grants in the database.
export const UPDATABLE_RELATIONS = new Set(["customers"]);
// The functions of schema public that a customer session may call.
export const EXPOSED_FUNCTIONS = new Set(["create_my_customer_profile", "claim_customer_profile"]);

const IDENT = /^[a-z_][a-z0-9_]*$/;
const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

/** A SQL string literal. Refuses NUL, which PostgreSQL cannot hold in text. */
export function quoteLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RestError(400, "PGRST100", "a number must be finite");
    return String(value);
  }
  if (typeof value !== "string") throw new RestError(400, "PGRST100", "unsupported value type");
  if (value.includes("\u0000")) throw new RestError(400, "PGRST100", "a value cannot contain NUL");
  return `'${value.replaceAll("'", "''")}'`;
}

function identifier(name, what) {
  if (typeof name !== "string" || !IDENT.test(name) || name.length > 63) throw new RestError(400, "PGRST100", `invalid ${what}`);
  return `"${name}"`;
}

function relation(name) {
  if (!EXPOSED_RELATIONS.has(name)) throw new RestError(404, "PGRST205", `relation ${name} is not exposed`);
  return `public.${identifier(name, "relation")}`;
}

function parseSelect(searchParams) {
  const raw = searchParams.get("select") ?? "*";
  if (raw === "*") return "*";
  const columns = raw.split(",");
  if (columns.length === 0 || columns.length > 40) throw new RestError(400, "PGRST100", "invalid select");
  // Embedded resources, aliases, casts and aggregates are not supported by the emulator.
  return columns.map((column) => identifier(column.trim(), "column")).join(", ");
}

const OPERATORS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function parseFilter(column, raw) {
  const col = identifier(column, "column");
  const dot = raw.indexOf(".");
  if (dot < 1) throw new RestError(400, "PGRST100", "invalid filter");
  const op = raw.slice(0, dot);
  const value = raw.slice(dot + 1);
  if (op in OPERATORS) return `${col} ${OPERATORS[op]} ${quoteLiteral(value)}`;
  if (op === "is") {
    if (value === "null") return `${col} is null`;
    if (value === "true" || value === "false") return `${col} is ${value}`;
    throw new RestError(400, "PGRST100", "invalid is filter");
  }
  if (op === "in") {
    if (!value.startsWith("(") || !value.endsWith(")")) throw new RestError(400, "PGRST100", "invalid in filter");
    const items = value.slice(1, -1).split(",").map((item) => item.trim().replace(/^"(.*)"$/, "$1"));
    if (items.length === 0 || items.length > 100) throw new RestError(400, "PGRST100", "invalid in filter");
    return `${col} in (${items.map(quoteLiteral).join(", ")})`;
  }
  throw new RestError(400, "PGRST100", `unsupported filter operator ${op}`);
}

function parseFilters(searchParams) {
  const clauses = [];
  for (const [key, raw] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue;
    clauses.push(parseFilter(key, raw));
  }
  return clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "";
}

function parseOrder(searchParams) {
  const raw = searchParams.get("order");
  if (!raw) return "";
  const parts = raw.split(",").map((part) => {
    const [column, direction = "asc", ...rest] = part.split(".");
    if (rest.length > 1 || (direction !== "asc" && direction !== "desc")) throw new RestError(400, "PGRST100", "invalid order");
    const nulls = rest[0] === "nullsfirst" ? " nulls first" : rest[0] === "nullslast" ? " nulls last" : rest.length ? (() => { throw new RestError(400, "PGRST100", "invalid order"); })() : "";
    return `${identifier(column, "column")} ${direction}${nulls}`;
  });
  return ` order by ${parts.join(", ")}`;
}

function parseLimit(searchParams) {
  const raw = searchParams.get("limit");
  if (raw === null) return " limit 1000";
  if (!/^[0-9]{1,4}$/.test(raw)) throw new RestError(400, "PGRST100", "invalid limit");
  return ` limit ${Math.min(Number(raw), 1000)}`;
}

/** SELECT ... as one JSON array. */
export function buildSelectSql(table, searchParams) {
  return `select coalesce(jsonb_agg(t), '[]'::jsonb) from (select ${parseSelect(searchParams)} from ${relation(table)}${parseFilters(searchParams)}${parseOrder(searchParams)}${parseLimit(searchParams)}) t;`;
}

/** UPDATE one table, returning the changed rows as a JSON array. A filter is mandatory: no unfiltered update. */
export function buildUpdateSql(table, searchParams, body) {
  if (!UPDATABLE_RELATIONS.has(table)) throw new RestError(403, "42501", `permission denied for table ${table}`);
  if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) throw new RestError(400, "PGRST102", "invalid body");
  const filters = parseFilters(searchParams);
  if (!filters) throw new RestError(400, "21000", "UPDATE requires a WHERE clause");
  const assignments = Object.entries(body).map(([column, value]) => `${identifier(column, "column")} = ${quoteLiteral(value)}`);
  return `with u as (update ${relation(table)} set ${assignments.join(", ")}${filters} returning *) select coalesce(jsonb_agg(u), '[]'::jsonb) from u;`;
}

/** SELECT to_json(public.fn(named => value, ...)). The function must be one of the two exposed ones. */
export function buildRpcSql(fn, args) {
  if (!EXPOSED_FUNCTIONS.has(fn)) throw new RestError(404, "PGRST202", `function ${fn} is not exposed`);
  const entries = args && typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [];
  const list = entries.map(([name, value]) => {
    if (!/^p_[a-z_]+$/.test(name)) throw new RestError(400, "PGRST100", "invalid argument name");
    return `${name} := ${quoteLiteral(value)}`;
  });
  return `select to_jsonb(public.${identifier(fn, "function")}(${list.join(", ")}));`;
}

/** Parses the error a psql run printed (with VERBOSITY verbose) into a PostgREST-style error. */
export function parsePgError(stderr) {
  const match = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr);
  const code = match ? match[1] : "XX000";
  const message = match ? match[2].trim() : "unexpected database error";
  let status = 400;
  if (code === "42501") status = 403;
  else if (code === "23505" || code === "23503") status = 409;
  else if (code === "42P01" || code === "42703") status = 404;
  else if (code.startsWith("XX")) status = 500;
  return { status, body: { code, details: null, hint: null, message } };
}
