// Test stand-in for `next/navigation`. `redirect` and `notFound` THROW, exactly as in Next.js, so a test can see where a server page or route sent the visitor;
// the hooks return what the test installed on `globalThis.__M1_NAV__` (the address being shown).
export class RedirectSignal extends Error {
  constructor(url) {
    super("NEXT_REDIRECT");
    this.url = url;
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}
export function redirect(url) {
  throw new RedirectSignal(url);
}
export function notFound() {
  const error = new Error("NEXT_NOT_FOUND");
  error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
  throw error;
}
export const usePathname = () => globalThis.__M1_NAV__?.pathname ?? "/";
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} });
export const useSearchParams = () => new URLSearchParams(globalThis.__M1_NAV__?.search ?? "");
