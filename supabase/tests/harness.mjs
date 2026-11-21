// A disposable local PostgreSQL server for the database tests. No npm dependency: it uses the PostgreSQL
// programs that are already installed (initdb, pg_ctl, psql). Nothing here touches a real Supabase project,
// the network, or any credential.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = resolve(HERE, "..");
export const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
export const SHIM_FILE = join(HERE, "support", "supabase_shim.sql");

/** Finds the directory that holds initdb, pg_ctl and psql, or null. PG_BIN overrides the search. */
export function findPgBin() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  const root = "/usr/lib/postgresql";
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) candidates.push(join(root, v, "bin"));
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl")) && existsSync(join(dir, "psql"))) return dir;
  }
  return null;
}

/** The PostgreSQL server refuses to run as root: when this process is root, the server runs as the `postgres` user. */
function serverUserPrefix() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return { prefix: [], owner: null };
  return { prefix: ["runuser", "-u", "postgres", "--"], owner: "postgres" };
}

function runAsServerUser(prefix, command, args, options = {}) {
  const full = [...prefix, command, ...args];
  return execFileSync(full[0], full.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

/**
 * Starts a throwaway cluster and returns a handle. The data directory is created under the system temporary
 * directory because the server user must be able to enter it.
 */
export function startCluster({ database = "m1test" } = {}) {
  const bin = findPgBin();
  if (!bin) throw new Error("PostgreSQL programs (initdb, pg_ctl, psql) were not found; set PG_BIN to their directory");
  const { prefix, owner } = serverUserPrefix();
  const dir = mkdtempSync(join(tmpdir(), "m1-pgtest-"));
  chmodSync(dir, 0o755);
  if (owner) execFileSync("chown", ["-R", owner, dir]);
  const data = join(dir, "data");
  const port = 55000 + Math.floor(Math.random() * 4000);

  runAsServerUser(prefix, join(bin, "initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C", "--no-sync"]);
  const options = [
    "-c listen_addresses=''",
    `-c unix_socket_directories=${dir}`,
    `-c port=${port}`,
    "-c fsync=off",
    "-c synchronous_commit=off",
    "-c full_page_writes=off",
    "-c max_connections=30",
  ].join(" ");
  runAsServerUser(prefix, join(bin, "pg_ctl"), ["-D", data, "-o", options, "-l", join(dir, "server.log"), "-w", "-t", "60", "start"]);

  const psqlArgs = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", dir, "-p", String(port), "-U", "postgres", "-t", "-A", "-F", "|"];

  /** Runs SQL text and returns { ok, status, out, err }. It never throws on a SQL error: tests inspect the result. */
  function psql(sql, { db = database } = {}) {
    const result = spawnSync(join(bin, "psql"), [...psqlArgs, "-d", db, "-f", "-"], { input: sql, encoding: "utf8" });
    return { ok: result.status === 0, status: result.status, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
  }

  function stop() {
    try {
      runAsServerUser(prefix, join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const created = psql(`create database ${database}`, { db: "postgres" });
  if (!created.ok) {
    stop();
    throw new Error(`could not create the test database: ${created.err}`);
  }
  return { dir, port, bin, database, psql, stop };
}

export function migrationFiles({ before = null } = {}) {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && (before === null || f < before))
    .sort()
    .map((f) => ({ name: f, path: join(MIGRATIONS_DIR, f), sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

/**
 * Applies the shim, then every migration in order, each in its own transaction. Throws with the SQL error text.
 * `before` (a migration file name) stops before that file: the release tests use it to build the database exactly as it is deployed,
 * i.e. without the migrations of the release under test.
 */
export function applyShimAndMigrations(cluster, { before = null } = {}) {
  const shim = cluster.psql(readFileSync(SHIM_FILE, "utf8"));
  if (!shim.ok) throw new Error(`shim failed: ${shim.err}`);
  for (const file of migrationFiles({ before })) {
    const result = cluster.psql(`begin;\n${file.sql}\ncommit;`);
    if (!result.ok) throw new Error(`migration ${file.name} failed: ${result.err}`);
  }
}

/** SQL prefix that makes the rest of a transaction run as a Supabase API role with the given JWT claims. */
export function asRole({ sub = null, role = "authenticated", aal = "aal1", claims = {} } = {}) {
  const body = { role, aal, ...(sub ? { sub } : {}), ...claims };
  const json = JSON.stringify(body).replaceAll("'", "''");
  return `reset role;\nset local role ${role};\ndo $$ begin perform set_config('request.jwt.claims', '${json}', true); end $$;\n`;
}
