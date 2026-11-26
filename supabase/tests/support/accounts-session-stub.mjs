// Test stand-in for src/lib/accounts/server/session.ts: the verified session the test installed on `globalThis.__M1_NAV__.session`
// (the same five states the real one reports). It counts the asks so a test can prove that a signed-out visitor costs no call to the auth service.
export async function getSession() {
  const nav = globalThis.__M1_NAV__;
  nav.sessionCalls = (nav.sessionCalls ?? 0) + 1;
  return nav.session;
}
