/**
 * The environment-variable contract for the Supabase integration.
 *
 * This file holds NAMES and checks, never a value. Real values live only in the hosting provider's settings and in an
 * untracked local file (`.env.local`, which .gitignore excludes). Nothing here reads the process environment on its
 * own: the caller passes the variables in, so the dependency is visible at the call site and a test can pass a plain
 * object.
 *
 * Nothing in the public quotation flow reads this module. A website with no Supabase variables set behaves exactly as
 * it does today (REC-PLAT-001): the readers return `{ ok: false }` with the variable NAMES that are missing and never
 * throw for that reason.
 */

/** Safe to ship to a browser by design: the anon key only carries what row level security allows. */
export const PUBLIC_ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

/**
 * Server only. It bypasses row level security, so it must NEVER be given a NEXT_PUBLIC_ name, be imported by a client
 * component, or be committed. No code in this phase uses it.
 */
export const SERVER_ENV_NAMES = ["SUPABASE_SERVICE_ROLE_KEY"] as const;

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}
export interface SupabaseServerConfig extends SupabasePublicConfig {
  serviceRoleKey: string;
}

export type ConfigResult<T> = { ok: true; config: T } | { ok: false; problems: string[] };

/** Reads the role claim of a JWT without verifying it. Used only to refuse a key in the wrong variable. */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function checkUrl(value: string | undefined, problems: string[]): string | null {
  const name = "NEXT_PUBLIC_SUPABASE_URL";
  if (!value || !value.trim()) {
    problems.push(`${name} is not set`);
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    problems.push(`${name} is not a valid URL`);
    return null;
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    problems.push(`${name} must use https (http is allowed only for localhost)`);
    return null;
  }
  if (parsed.username || parsed.password) {
    problems.push(`${name} must not contain credentials`);
    return null;
  }
  return parsed.origin;
}

/** Validates the two public variables. Problems name the variable and the rule, never the value. */
export function readSupabasePublicConfig(env: EnvSource): ConfigResult<SupabasePublicConfig> {
  const problems: string[] = [];
  const url = checkUrl(env.NEXT_PUBLIC_SUPABASE_URL, problems);

  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anon) {
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  } else if (/\s/.test(anon)) {
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY must not contain whitespace");
  } else if (jwtRole(anon) === "service_role" || anon.startsWith("sb_secret_")) {
    // The most damaging mistake this module can catch: a privileged key in a variable that is sent to browsers.
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY holds a privileged key; use the anon or publishable key here");
  }

  if (problems.length > 0 || !url || !anon) return { ok: false, problems };
  return { ok: true, config: { url, anonKey: anon } };
}

/**
 * Validates the server configuration. Refuses to run in a browser. Returns problems rather than throwing when
 * variables are simply missing, so a deployment without Supabase keeps serving the public site.
 */
export function readSupabaseServerConfig(env: EnvSource): ConfigResult<SupabaseServerConfig> {
  if (typeof window !== "undefined") {
    throw new Error("readSupabaseServerConfig must never run in a browser");
  }
  const publicPart = readSupabasePublicConfig(env);
  const problems = publicPart.ok ? [] : [...publicPart.problems];

  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!service) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
  } else if (/\s/.test(service)) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY must not contain whitespace");
  } else if (publicPart.ok && service === publicPart.config.anonKey) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY must not be the same key as NEXT_PUBLIC_SUPABASE_ANON_KEY");
  } else {
    const role = jwtRole(service);
    if ((role !== null && role !== "service_role") || service.startsWith("sb_publishable_")) {
      problems.push("SUPABASE_SERVICE_ROLE_KEY does not hold a service-role key");
    }
  }

  if (problems.length > 0 || !publicPart.ok || !service) return { ok: false, problems };
  return { ok: true, config: { ...publicPart.config, serviceRoleKey: service } };
}

/** True when the public variables are present and valid. The public quotation flow never needs to ask. */
export function isSupabaseConfigured(env: EnvSource): boolean {
  return readSupabasePublicConfig(env).ok;
}
