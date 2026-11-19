import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { safeNextPath } from "@/lib/accounts/shared/redirect";
import { createSupabaseServerClient } from "@/lib/accounts/server/client";

/**
 * Where the link in a confirmation or sign-in email lands. It completes the sign-in on the server, so the session is
 * set in an HttpOnly cookie and never touches script on the page.
 *
 * Two link formats are accepted, so it works with either email template in the auth dashboard:
 *   ?token_hash=...&type=...   the recommended template; works on any device the email is opened on
 *   ?code=...                  the default template (PKCE); works only in the browser that asked for it
 *
 * A link that does not work (used, expired or malformed) always ends at the same page with the same message. The
 * `next` address is checked, so this route cannot be used to send someone to another site.
 */
export const dynamic = "force-dynamic";

// Only the kinds of email this feature sends. Password recovery, invitations and address changes are not offered.
const ALLOWED_TYPES: readonly EmailOtpType[] = ["signup", "email", "magiclink"];

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  if (!customerAccountsGate(process.env).enabled) return new NextResponse(null, { status: 404 });

  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return redirect("/auth/error?reason=unavailable");

  if (tokenHash && isAllowedType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return redirect(next);
  } else if (code && code.length <= 512) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirect(next);
  }
  return redirect("/auth/error?reason=link");
}
