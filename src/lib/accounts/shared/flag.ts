/**
 * The feature flag for customer accounts. It is OFF unless it is switched on explicitly, and it can never be switched
 * on in a production deployment from this code.
 *
 *   CUSTOMER_ACCOUNTS_ENABLED=true   turns the account routes on (anything else, or unset, leaves them off)
 *
 * With the flag off, every route under /account and /auth answers 404, the middleware does nothing, and the public
 * website and its WhatsApp quotation journey behave exactly as they did before this feature existed.
 *
 * The flag is a SERVER variable, never NEXT_PUBLIC_: it is read per request on the server and is not part of any
 * browser bundle. Nothing in the public pages reads it.
 *
 * Production guard. A deployment on Vercel's production environment reports VERCEL_ENV=production. There the flag is
 * ignored, whatever its value, so a stray environment variable cannot open public customer accounts. Activating
 * accounts in production is a deliberate, separately approved change that removes this guard; it is not done here.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type AccountsGate =
  | { enabled: true; reason: "enabled" }
  | { enabled: false; reason: "flag_off" | "blocked_in_production" };

export function customerAccountsGate(env: EnvSource): AccountsGate {
  if (env.CUSTOMER_ACCOUNTS_ENABLED !== "true") return { enabled: false, reason: "flag_off" };
  if (env.VERCEL_ENV === "production") return { enabled: false, reason: "blocked_in_production" };
  return { enabled: true, reason: "enabled" };
}

export function isCustomerAccountsEnabled(env: EnvSource): boolean {
  return customerAccountsGate(env).enabled;
}
