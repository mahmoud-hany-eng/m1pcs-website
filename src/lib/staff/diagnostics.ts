/**
 * Diagnostics for the staff area. The ONLY place that writes to the server log about why the admin area is
 * unavailable, and it can say only three things: a stage, and either a fixed reason word or a validated error code.
 * It never receives or prints a message, a host, a user name, a URL, a password, a cookie, a token or a claim.
 *
 * Why it exists: every infrastructure failure (variable missing, malformed value, DNS, refused connection, TLS,
 * pooler login, timeout) reaches the page as the same "customer accounts are unavailable (unavailable)", and several of
 * them used to write nothing at all. One line per failed request, in a fixed vocabulary, tells them apart.
 */
export type FailureStage = "network" | "tls" | "login" | "timeout" | "authz" | "other";

export type DiagnosticEvent =
  | { stage: "config"; reason: "env_missing" | "not_a_url" | "unsupported_scheme" | "missing_host" | "host_override" }
  | { stage: "auth"; reason: "unavailable" | "not_configured" }
  | { stage: "authz"; reason: "permission_refused" }
  | { stage: FailureStage; code: string };

const CODE = /^[A-Z0-9_]{3,40}$/;
const NETWORK = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET", "EPIPE", "57P03", "08000", "08001", "08003", "08004", "08006"]);
const TLS = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "HOSTNAME_MISMATCH", "EPROTO"]);

/** Maps a driver or database error to a stage and a safe code. Anything unrecognised is "other" with a fixed code word. */
export function classifyGatewayFailure(error: unknown): { stage: FailureStage; code: string } {
  const e = error as { code?: unknown; message?: unknown } | null;
  const raw = typeof e?.code === "string" && CODE.test(e.code) ? e.code : null;
  const message = typeof e?.message === "string" ? e.message : "";
  if (raw === null) {
    if (message === "timeout exceeded when trying to connect") return { stage: "timeout", code: "POOL_CONNECT_TIMEOUT" };
    if (message === "Connection terminated due to connection timeout") return { stage: "timeout", code: "CLIENT_CONNECT_TIMEOUT" };
    if (message.startsWith("Connection terminated")) return { stage: "network", code: "CONNECTION_TERMINATED" };
    if (message === "The server does not support SSL connections") return { stage: "tls", code: "SERVER_REFUSED_TLS" };
    return { stage: "other", code: "NO_CODE" };
  }
  if (NETWORK.has(raw)) return { stage: "network", code: raw };
  if (TLS.has(raw) || raw.startsWith("ERR_TLS_") || raw.startsWith("ERR_SSL_")) return { stage: "tls", code: raw };
  if (raw.startsWith("28") || raw === "XX000") return { stage: "login", code: raw };
  if (raw === "42501") return { stage: "authz", code: raw };
  return { stage: "other", code: raw };
}

export function logStaffDiagnostic(event: DiagnosticEvent): void {
  const detail = "reason" in event ? `reason=${event.reason}` : `code=${event.code}`;
  console.error(`[staff] diag stage=${event.stage} ${detail}`);
}
