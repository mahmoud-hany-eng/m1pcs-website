/**
 * How the staff gateway secures its database connection. Pure and server-side: no driver, no network, no secrets.
 *
 * The rule: a connection to anything other than this machine's own loopback address ALWAYS verifies the server's
 * certificate chain against the pinned Supabase root CA (supabase-root-ca.ts) and ALWAYS verifies the host name.
 * Nothing the `STAFF_GATEWAY_DATABASE_URL` secret contains can change that:
 *   - every TLS parameter in it (`sslmode`, `ssl`, `sslrootcert`, ...) is removed, never obeyed;
 *   - a parameter that would re-route the connection (`host`, `hostaddr`, `service`) is refused, because it could
 *     point a "loopback" URL at a remote server and skip TLS;
 *   - the object passed to the driver sets `rejectUnauthorized: true` explicitly, so the process-wide
 *     NODE_TLS_REJECT_UNAUTHORIZED switch and the PGSSLMODE variable have no effect on it, and the default host-name
 *     check is never replaced.
 * The local development stack (loopback, no TLS) keeps working: loopback addresses are the only exception, and only
 * a plain `localhost`, `127.0.0.1` or `[::1]` host qualifies.
 *
 * Error messages never contain any part of the value. The tests are in supabase/tests/gateway-tls.test.mjs; they
 * run against a LOCAL private certificate authority and say nothing about the hosted pooler (see STAFF_GATEWAY.md).
 */
import type { ConnectionOptions } from "node:tls";
import { SUPABASE_ROOT_CA_PEM } from "./supabase-root-ca";

export interface GatewayConnection {
  connectionString: string;
  /** Present for every non-loopback host. Verification cannot be switched off from the connection string. */
  ssl?: ConnectionOptions;
}

export type GatewayConfigProblem = "not_a_url" | "unsupported_scheme" | "missing_host" | "host_override";

/** An unusable secret. Carries a fixed problem code, never the value. */
export class GatewayConfigError extends Error {
  readonly problem: GatewayConfigProblem;
  constructor(problem: GatewayConfigProblem) {
    super("The staff gateway connection setting is not a usable database URL.");
    this.name = "GatewayConfigError";
    this.problem = problem;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Parameters that choose TLS behaviour. Removed from the URL (compared case-insensitively), never obeyed. */
const TLS_PARAMETERS = new Set([
  "ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslcrl", "sslpassword", "sslnegotiation", "sslcompression",
  "sslsni", "ssl_min_protocol_version", "ssl_max_protocol_version", "uselibpqcompat",
]);
/** Parameters that would choose another server than the URL's host. Refused. */
const ROUTING_PARAMETERS = new Set(["host", "hostaddr", "service"]);

function parseGatewayUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new GatewayConfigError("not_a_url");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new GatewayConfigError("unsupported_scheme");
  if (!url.hostname) throw new GatewayConfigError("missing_host");
  for (const key of url.searchParams.keys()) if (ROUTING_PARAMETERS.has(key.toLowerCase())) throw new GatewayConfigError("host_override");
  return url;
}

function withoutTlsParameters(url: URL): string {
  for (const key of [...url.searchParams.keys()]) if (TLS_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  return url.toString();
}

/**
 * Always enforced, whatever the host. `ca` defaults to the pinned Supabase root; the parameter exists so the tests can
 * run a real handshake against a local private CA. The gateway itself calls `gatewayConnection`, never this.
 */
export function enforcedTlsConnection(rawUrl: string, ca: string = SUPABASE_ROOT_CA_PEM): GatewayConnection {
  const url = parseGatewayUrl(rawUrl);
  return {
    connectionString: withoutTlsParameters(url),
    ssl: { ca, rejectUnauthorized: true, minVersion: "TLSv1.2" },
  };
}

/** What the gateway uses: loopback (the local development stack) as it was, everything else enforced. */
export function gatewayConnection(rawUrl: string): GatewayConnection {
  const url = parseGatewayUrl(rawUrl);
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return { connectionString: url.toString() };
  return enforcedTlsConnection(rawUrl);
}
