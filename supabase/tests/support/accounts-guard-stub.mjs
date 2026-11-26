// Test stand-in for src/lib/accounts/server/guard.ts (the route guards): the signed-in customer context the test installed on `globalThis.__M1_NAV__.customerContext`
// ({ user, supabase, customer, customers }), as the real requireCustomerContext returns it for a verified session.
export class AccountsUnavailableError extends Error {
  constructor(reason) {
    super(`customer accounts are unavailable (${reason})`);
    this.name = "AccountsUnavailableError";
  }
}
export function assertAccountsEnabled() {}
export async function requireSignedIn() {
  const context = globalThis.__M1_NAV__?.customerContext;
  if (!context) throw new Error("the test did not install a customer context");
  return { user: context.user, supabase: context.supabase };
}
export async function requireCustomerContext() {
  const context = globalThis.__M1_NAV__?.customerContext;
  if (!context) throw new Error("the test did not install a customer context");
  return context;
}
export async function requireCustomer() {
  return requireCustomerContext();
}
