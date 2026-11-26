// Test stand-in for src/lib/accounts/server/client.ts: the Supabase client the test installed on `globalThis.__M1_NAV__.supabase` (a plain object with the `auth`
// calls the test cares about), or null when none was installed (the real function answers null when the service is not configured).
export async function createSupabaseServerClient() {
  return globalThis.__M1_NAV__?.supabase ?? null;
}
