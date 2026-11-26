/**
 * The server half of "where does this person go after signing in" (the rules themselves are in ../shared/post-auth.ts, which is plain and tested
 * on its own). It asks the existing staff check about the VERIFIED session of this request and applies those rules. Every way of signing in ends
 * here: the sign-in page when a signed-in person opens it, and the router page /auth/continue that the password form, the e-mail link, the
 * confirmation link and the password-recovery page all send the person to.
 *
 * The staff check is the same one that guards /admin (getStaffState): the auth service confirms the session, the staff table is asked through the
 * gateway, and the second step is judged from the verified token. If that check cannot be completed the answer is `unavailable`, never "customer".
 */
import { getStaffState } from "@/lib/staff/session";
import { routeAfterSignIn, type PostAuthRoute } from "../shared/post-auth";

export async function resolveAfterSignIn(rawNext: unknown): Promise<PostAuthRoute> {
  const staff = await getStaffState();
  return routeAfterSignIn(staff.state, rawNext);
}
