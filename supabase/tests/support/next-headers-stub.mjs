// Test stand-in for `next/headers`: the cookies and request headers the test installed on `globalThis.__M1_NAV__`.
export async function cookies() {
  const all = globalThis.__M1_NAV__?.cookies ?? [];
  return { getAll: () => all, get: (name) => all.find((c) => c.name === name), has: (name) => all.some((c) => c.name === name) };
}
export async function headers() {
  return new Headers(globalThis.__M1_NAV__?.headers ?? {});
}
