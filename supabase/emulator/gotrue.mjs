// A mock of the parts of Supabase Auth (GoTrue) that the customer-account code uses, for the LOCAL EMULATOR.
//
// This is NOT Supabase Auth. It reproduces the response shapes, the error codes and the behaviours the app depends on
// (confirmation by email, password sign-in, single-use refresh tokens, revocable sessions, PKCE exchange, one-time
// email links), so the real @supabase/ssr code can be exercised end to end. It proves nothing about the real service:
// real token issuance, rate limits, email delivery and dashboard settings need a real Supabase project.
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { sha256Base64Url, signJwt, verifyJwt } from "./jwt.mjs";

const REFRESH_REUSE_SECONDS = 10;

function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function checkPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const fail = (status, errorCode, msg) => ({ status, body: { code: status, error_code: errorCode, msg } });

export function createAuth({ secret, accessTtl = 3600, onUserCreated = () => {}, emailLimitPerHour = 100 } = {}) {
  const users = new Map(); // id -> user
  const byEmail = new Map(); // email -> id
  const sessions = new Map(); // id -> { userId, revoked, current, tokens: Map<token, { used, childToken, usedAt }> }
  const refreshIndex = new Map(); // refresh token -> session id
  const otps = new Map(); // token hash -> { type, userId, expiresAt, used }
  const codes = new Map(); // pkce code -> { userId, challenge, method, expiresAt, used, confirms }
  const outbox = [];
  const emailCounts = new Map(); // email -> [timestamps]
  const control = { mode: "up", accessTtl, emailLimitPerHour };

  function userView(user) {
    return {
      id: user.id, aud: "authenticated", role: "authenticated", email: user.email,
      email_confirmed_at: user.confirmed ? user.confirmedAt : null, phone: "", confirmed_at: user.confirmed ? user.confirmedAt : null,
      last_sign_in_at: user.lastSignInAt ?? null,
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: user.metadata ?? {},
      identities: [{ identity_id: user.id, id: user.id, user_id: user.id, provider: "email", identity_data: { email: user.email, sub: user.id } }],
      created_at: user.createdAt, updated_at: user.createdAt, is_anonymous: false,
    };
  }

  function addUser({ email, password, confirmed = false, id = randomUUID(), metadata = {} }) {
    const user = { id, email, passwordHash: hashPassword(password), confirmed, confirmedAt: confirmed ? new Date().toISOString() : null, createdAt: new Date().toISOString(), metadata };
    users.set(id, user);
    byEmail.set(email, id);
    onUserCreated(user);
    return user;
  }

  function issueSession(user) {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(12).toString("hex");
    sessions.set(sessionId, { userId: user.id, revoked: false, current: refreshToken, tokens: new Map([[refreshToken, { used: false }]]) });
    refreshIndex.set(refreshToken, sessionId);
    user.lastSignInAt = new Date().toISOString();
    return sessionBody(user, sessionId, refreshToken);
  }

  function sessionBody(user, sessionId, refreshToken) {
    const iat = nowSeconds();
    const exp = iat + control.accessTtl;
    const accessToken = signJwt({
      iss: "m1-local-emulator/auth/v1", sub: user.id, aud: "authenticated", role: "authenticated", aal: "aal1", email: user.email,
      session_id: sessionId, is_anonymous: false, app_metadata: { provider: "email" }, user_metadata: user.metadata ?? {}, iat, exp,
    }, secret);
    return { access_token: accessToken, token_type: "bearer", expires_in: control.accessTtl, expires_at: exp, refresh_token: refreshToken, user: userView(user) };
  }

  function rotate(refreshToken) {
    const sessionId = refreshIndex.get(refreshToken);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || session.revoked) return fail(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    const record = session.tokens.get(refreshToken);
    const user = users.get(session.userId);
    if (record.used) {
      // Like the real service, a token that was just used may be used again for a short window (parallel requests).
      if (record.childToken && nowSeconds() - record.usedAt <= REFRESH_REUSE_SECONDS) return { status: 200, body: sessionBody(user, sessionId, record.childToken) };
      session.revoked = true;
      return fail(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
    }
    const child = randomBytes(12).toString("hex");
    record.used = true;
    record.childToken = child;
    record.usedAt = nowSeconds();
    session.tokens.set(child, { used: false });
    session.current = child;
    refreshIndex.set(child, sessionId);
    return { status: 200, body: sessionBody(user, sessionId, child) };
  }

  function authenticate(headers) {
    const header = headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const verified = verifyJwt(token, secret);
    if (!verified.ok) return { error: fail(401, "bad_jwt", `invalid JWT: ${verified.reason}`) };
    const session = sessions.get(verified.payload.session_id);
    if (!session || session.revoked) return { error: fail(403, "session_not_found", "Session from session_id claim in JWT does not exist") };
    const user = users.get(session.userId);
    if (!user) return { error: fail(403, "user_not_found", "User from sub claim in JWT does not exist") };
    return { user, sessionId: verified.payload.session_id };
  }

  function emailAllowed(email) {
    const hourAgo = Date.now() - 3600 * 1000;
    const recent = (emailCounts.get(email) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= control.emailLimitPerHour) return false;
    recent.push(Date.now());
    emailCounts.set(email, recent);
    return true;
  }

  /** "Sends" an email by recording it. The link is the one the recommended template produces (token_hash), plus the PKCE form. */
  function sendEmail({ user, type, redirectTo, challenge, method }) {
    const tokenHash = randomBytes(16).toString("hex");
    otps.set(tokenHash, { type, userId: user.id, expiresAt: nowSeconds() + 3600, used: false });
    const origin = redirectTo ? new URL(redirectTo).origin : "http://localhost:3000";
    const next = redirectTo ? new URL(redirectTo).searchParams.get("next") : null;
    const tokenHashLink = `${origin}/auth/confirm?token_hash=${tokenHash}&type=${type}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    let codeLink = null;
    if (challenge) {
      const code = randomBytes(12).toString("hex");
      codes.set(code, { userId: user.id, challenge, method: method ?? "s256", expiresAt: nowSeconds() + 3600, used: false, confirms: type === "signup" });
      codeLink = `${redirectTo ?? `${origin}/auth/confirm`}${(redirectTo ?? "").includes("?") ? "&" : "?"}code=${code}`;
    }
    outbox.push({ to: user.email, type, tokenHash, tokenHashLink, codeLink, at: new Date().toISOString() });
  }

  const ok = (body, status = 200) => ({ status, body });

  function handle({ method, path, query, headers, body }) {
    if (control.mode === "down") return { status: 503, body: { message: "service unavailable" } };
    const route = `${method} ${path}`;

    if (route === "POST /auth/v1/signup") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      if (!email || !password) return fail(422, "validation_failed", "Anonymous sign-ins are disabled");
      if (password.length < 6) return { status: 422, body: { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters.", weak_password: { reasons: ["length"] } } };
      if (!emailAllowed(email)) return fail(429, "over_email_send_rate_limit", "email rate limit exceeded");
      const existing = byEmail.has(email) ? users.get(byEmail.get(email)) : null;
      if (existing && control.revealExistingAddress) {
        // A project with email confirmation switched OFF: the real service says so plainly (HTTP 422, user_already_exists).
        return fail(422, "user_already_exists", "User already registered");
      }
      if (existing) {
        // With email confirmation on, the real service answers exactly as it does for a new address.
        return ok({ id: randomUUID(), aud: "authenticated", role: "", email, phone: "", confirmation_sent_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      const user = addUser({ email, password, metadata: body?.data ?? {} });
      sendEmail({ user, type: "signup", redirectTo: query.get("redirect_to"), challenge: body?.code_challenge, method: body?.code_challenge_method });
      return ok({ ...userView(user), confirmation_sent_at: new Date().toISOString(), identities: userView(user).identities });
    }

    if (route === "POST /auth/v1/token") {
      const grant = query.get("grant_type");
      if (grant === "password") {
        const email = String(body?.email ?? "").trim().toLowerCase();
        const user = byEmail.has(email) ? users.get(byEmail.get(email)) : null;
        if (!user || !checkPassword(String(body?.password ?? ""), user.passwordHash)) return fail(400, "invalid_credentials", "Invalid login credentials");
        if (!user.confirmed) return fail(400, "email_not_confirmed", "Email not confirmed");
        return ok(issueSession(user));
      }
      if (grant === "refresh_token") return rotate(String(body?.refresh_token ?? ""));
      if (grant === "pkce") {
        const record = codes.get(String(body?.auth_code ?? ""));
        if (!record || record.used || record.expiresAt <= nowSeconds()) return fail(400, "flow_state_not_found", "invalid flow state, no valid flow state found");
        const verifier = String(body?.code_verifier ?? "");
        const challenge = record.method === "plain" ? verifier : sha256Base64Url(verifier);
        if (challenge !== record.challenge) return fail(400, "bad_code_verifier", "code challenge does not match previously saved code verifier");
        record.used = true;
        const user = users.get(record.userId);
        if (record.confirms && !user.confirmed) { user.confirmed = true; user.confirmedAt = new Date().toISOString(); }
        return ok(issueSession(user));
      }
      return fail(400, "validation_failed", "unsupported grant type");
    }

    if (route === "GET /auth/v1/user") {
      const result = authenticate(headers);
      return result.error ?? ok(userView(result.user));
    }

    // Choosing a new password (what the page after a recovery link does). Like the real service it refuses a weak password and the same one again.
    if (route === "PUT /auth/v1/user") {
      const result = authenticate(headers);
      if (result.error) return result.error;
      if (typeof body?.password === "string") {
        if (body.password.length < 6) return { status: 422, body: { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters.", weak_password: { reasons: ["length"] } } };
        if (checkPassword(body.password, result.user.passwordHash)) return fail(422, "same_password", "New password should be different from the old password.");
        result.user.passwordHash = hashPassword(body.password);
      }
      return ok(userView(result.user));
    }

    if (route === "POST /auth/v1/logout") {
      const result = authenticate(headers);
      if (result.error) return { status: 204, body: null };
      const scope = query.get("scope") ?? "global";
      for (const [id, session] of sessions) if (session.userId === result.user.id && (scope === "global" || (scope === "local" && id === result.sessionId) || (scope === "others" && id !== result.sessionId))) session.revoked = true;
      return { status: 204, body: null };
    }

    if (route === "POST /auth/v1/verify") {
      const record = otps.get(String(body?.token_hash ?? ""));
      if (!record || record.used || record.expiresAt <= nowSeconds() || (body?.type && record.type !== body.type && !(record.type === "signup" && body.type === "email"))) {
        return fail(403, "otp_expired", "Email link is invalid or has expired");
      }
      record.used = true;
      const user = users.get(record.userId);
      if (!user.confirmed) { user.confirmed = true; user.confirmedAt = new Date().toISOString(); }
      return ok(issueSession(user));
    }

    if (route === "POST /auth/v1/otp") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!emailAllowed(email)) return fail(429, "over_email_send_rate_limit", "email rate limit exceeded");
      const user = byEmail.has(email) ? users.get(byEmail.get(email)) : null;
      if (!user) {
        if (body?.create_user === false) return fail(422, "otp_disabled", "Signups not allowed for otp");
        // Without create_user: false the real service signs the address up and emails it a link. This is exactly what
        // the application must never allow from the sign-in page, so the emulator does it for the tests to catch.
        const created = addUser({ email, password: randomBytes(18).toString("base64url") + "-Aa1", metadata: {} });
        sendEmail({ user: created, type: "magiclink", redirectTo: query.get("redirect_to"), challenge: body?.code_challenge, method: body?.code_challenge_method });
        return ok({});
      }
      sendEmail({ user, type: "magiclink", redirectTo: query.get("redirect_to"), challenge: body?.code_challenge, method: body?.code_challenge_method });
      return ok({});
    }

    // "Forgot password": like the real service it answers the same for an address with an account and one without, and only the first gets an email.
    if (route === "POST /auth/v1/recover") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!emailAllowed(email)) return fail(429, "over_email_send_rate_limit", "email rate limit exceeded");
      const user = byEmail.has(email) ? users.get(byEmail.get(email)) : null;
      if (user) sendEmail({ user, type: "recovery", redirectTo: query.get("redirect_to"), challenge: body?.code_challenge, method: body?.code_challenge_method });
      return ok({});
    }

    if (route === "POST /auth/v1/resend") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!emailAllowed(email)) return fail(429, "over_email_send_rate_limit", "email rate limit exceeded");
      const user = byEmail.has(email) ? users.get(byEmail.get(email)) : null;
      if (user && !user.confirmed) sendEmail({ user, type: "signup", redirectTo: query.get("redirect_to"), challenge: body?.code_challenge, method: body?.code_challenge_method });
      return ok({ message_id: null });
    }

    return fail(404, "not_found", `no such endpoint: ${route}`);
  }

  return {
    handle,
    outbox,
    control,
    users,
    addUser,
    revokeAllSessions: () => { for (const session of sessions.values()) session.revoked = true; },
    findUserByEmail: (email) => (byEmail.has(email) ? users.get(byEmail.get(email)) : null),
    verifyAccessToken: (token) => verifyJwt(token, secret),
    sessionRevoked: (sessionId) => !sessions.has(sessionId) || sessions.get(sessionId).revoked,
  };
}
