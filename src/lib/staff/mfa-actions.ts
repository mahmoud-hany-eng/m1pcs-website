"use server";
import "server-only";

/**
 * The second factor for staff: an authenticator app (TOTP) through Supabase Auth. Enrolment and verification run on
 * the server with the person's own session; the browser never holds a Supabase client. A session reaches `aal2` only
 * when the auth service accepts the code, and only an `aal2` session is accepted by the staff functions.
 */
import { requireStaffCandidate } from "./session";
import { isUuid } from "./validation";
import type { StaffFormState } from "./form-state";

const CODE = /^[0-9]{6}$/;
const WRONG_CODE = "That code did not work. Check the time on your phone and try again with the newest code.";
const UNAVAILABLE = "The sign-in service is not available right now. Please try again in a moment.";

/** Only an active staff member may set up or use the second step; anyone else gets the ordinary 404. */
async function signedIn() {
  return requireStaffCandidate("/admin/mfa");
}

/** Creates a new authenticator factor for the signed-in person and returns its QR code once. */
export async function enrolTotpAction(): Promise<StaffFormState> {
  const { supabase } = await signedIn();
  try {
    // A factor that was started and never confirmed would otherwise block a new attempt.
    const existing = await supabase.auth.mfa.listFactors();
    for (const factor of existing.data?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `M1 staff ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) return { status: "error", message: UNAVAILABLE };
    return {
      status: "success",
      message: "Scan the picture with an authenticator app, then enter the 6-digit code it shows.",
      enrol: { factorId: data.id, qr: data.totp.qr_code, setupKey: data.totp.secret },
    };
  } catch {
    return { status: "error", message: UNAVAILABLE };
  }
}

/** Checks a code against the person's factor and, when it is right, upgrades this session to the second level. */
export async function verifyTotpAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const { supabase } = await signedIn();
  const factorId = typeof formData.get("factor_id") === "string" ? String(formData.get("factor_id")) : "";
  const code = typeof formData.get("code") === "string" ? String(formData.get("code")).replace(/\s+/g, "") : "";
  if (!isUuid(factorId)) return { status: "error", message: WRONG_CODE };
  if (!CODE.test(code)) return { status: "error", fieldErrors: { code: "Enter the 6-digit code." } };
  try {
    // The factor must belong to this person: the auth service enforces it, and the code is checked there too.
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) return { status: "error", message: WRONG_CODE };
    const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    if (verified.error) return { status: "error", message: WRONG_CODE };
    return { status: "success", message: "Verified. Opening the dashboard…", href: "/admin" };
  } catch {
    return { status: "error", message: UNAVAILABLE };
  }
}
