import { NextResponse } from "next/server";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { readHeaderIdentity } from "@/lib/accounts/server/header-identity";

/**
 * Who the public header should name. The header asks this after a public page has loaded (the page itself is built once and cached, so it can
 * never contain a person's name), and again when the visitor returns to the tab, changes page, or comes back through the browser's history.
 *
 * It is never cached anywhere (browser, CDN or proxy), varies with the sign-in cookie, is not indexed and may not be read by another site. The
 * answer is a label and one of three fixed addresses: no permission, no e-mail address, no identifier. Absent altogether (404) while the account
 * switch is off, which is also the case on a production deployment.
 */
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export async function GET() {
  if (!customerAccountsGate(process.env).enabled) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });
  const answer = await readHeaderIdentity();
  return NextResponse.json(answer, { headers: PRIVATE_HEADERS });
}
