import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { continueUrl } from "@/lib/accounts/shared/post-auth";
import { safeNextPath } from "@/lib/accounts/shared/redirect";
import { createSupabaseServerClient } from "@/lib/accounts/server/client";

/**
 * Where the link in a confirmation or password-recovery email lands. It completes the step on the server, so the session is
 * set in an HttpOnly cookie and never touches script on the page. There is no passwordless sign-in on this site: the only way in is an
 * email address and password, so a "magiclink" token is not accepted here (see ALLOWED_TYPES below).
 *
 * Two link formats are accepted, so it works with either email template in the auth dashboard:
 *   ?token_hash=...&type=...   the recommended template; works on any device the email is opened on
 *   ?code=...                  the default template (PKCE); works only in the browser that asked for it
 *
 * A link that does not work (used, expired or malformed) always ends at the same page with the same message. The
 * `next` address is checked, so this route cannot be used to send someone to another site.
 *
 * A link that works ends at the sign-in router (/auth/continue), which asks the server whether this verified session belongs to staff or to a
 * customer and sends the person to the right dashboard (see src/lib/accounts/shared/post-auth.ts). A recovery link goes to the new-password page
 * and nowhere else.
 */
export const dynamic = "force-dynamic";

// Only the kinds of email this feature sends: account confirmation ("email" is the type the confirmation template in supabase/templates carries,
// "signup" the older name for it) and password recovery. Invitations, address changes and sign-in (magic) links are not offered, so a link of
// those kinds ends at the same "That link did not work" page and creates no session.
const ALLOWED_TYPES: readonly EmailOtpType[] = ["signup", "email", "recovery"];
// A recovery link signs the person in for one purpose and always ends at the same page, whatever `next` says.

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  if (!customerAccountsGate(process.env).enabled) return new NextResponse(null, { status: 404 });

  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"), "");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return redirect("/auth/error?reason=unavailable");

  if (tokenHash && isAllowedType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && type === "recovery") return redirect("/auth/reset-password");
    if (!error) return redirect(continueUrl(next));
  } else if (code && code.length <= 512) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // The default (PKCE) recovery link carries no type; it is recognised by the reset page it asks to land on.
    if (!error && searchParams.get("next") === "/auth/reset-password") return redirect("/auth/reset-password");
    if (!error) return redirect(continueUrl(next));
  }
  return redirect("/auth/error?reason=link");
}
