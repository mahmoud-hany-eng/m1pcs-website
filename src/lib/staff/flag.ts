/**
 * The safety switch for the admin area. It is a server variable, off unless set to exactly `true`, and ignored on a
 * production deployment, exactly like the customer-account switch: staff tooling cannot be turned on in production by
 * setting a variable. With it off every /admin address answers the site's ordinary 404 and no database connection is
 * ever opened.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export type StaffGate =
  | { enabled: true; reason: "enabled" }
  | { enabled: false; reason: "flag_off" | "blocked_in_production" };

export function staffAdminGate(env: EnvSource): StaffGate {
  if (env.STAFF_ADMIN_ENABLED !== "true") return { enabled: false, reason: "flag_off" };
  if (env.VERCEL_ENV === "production") return { enabled: false, reason: "blocked_in_production" };
  return { enabled: true, reason: "enabled" };
}

export function isStaffAdminEnabled(env: EnvSource): boolean {
  return staffAdminGate(env).enabled;
}
