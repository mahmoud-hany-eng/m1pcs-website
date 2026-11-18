// HS256 tokens for the LOCAL EMULATOR only. The secret is generated fresh for every run and never stored, so no key
// exists in the repository. These tokens are accepted by nothing except the emulator.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const b64u = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function newSecret() {
  return randomBytes(32).toString("hex");
}

export function signJwt(payload, secret) {
  const head = b64u({ alg: "HS256", typ: "JWT" });
  const body = b64u(payload);
  const signature = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}

/** Returns { ok: true, payload } or { ok: false, reason: "malformed" | "signature" | "expired" }. */
export function verifyJwt(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: "signature" };
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, reason: "signature" };
  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export function sha256Base64Url(text) {
  return createHash("sha256").update(text).digest("base64url");
}
