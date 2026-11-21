/** What an admin form's server action hands back. Messages are fixed text or a business-rule message written for staff. */
export type StaffFieldErrors = Record<string, string>;

/** What the duplicate-order warning shows about one earlier order. */
export interface DuplicateOrderEvidence {
  id: string;
  ref: string;
  status: string;
  totalMinor: number;
  createdAt: string;
}

export type StaffFormState =
  | { status: "idle" }
  // `values` hands back what was typed (never a code, a password or a confirmation word) because React clears an
  // uncontrolled form after every submit, which would otherwise wipe a long form on a validation error.
  | {
      status: "error";
      message?: string;
      fieldErrors?: StaffFieldErrors;
      values?: Record<string, string>;
      /** True when the request's idempotency key already belongs to a finished or different request: the form must take a new one. */
      keyRetired?: boolean;
      /** Recent orders for the same customer with the same items. A warning only: the person may confirm and create the order anyway. */
      duplicates?: DuplicateOrderEvidence[];
    }
  | {
      status: "success";
      message: string;
      /** An internal admin path to open next (a record that was just created). Checked again in the browser. */
      href?: string;
      /** A secret shown exactly once, such as a claim code. It is never stored or logged. */
      secret?: string;
      /** The authenticator-app enrolment: a QR image and the factor it belongs to (shown only to the person enrolling). */
      enrol?: { factorId: string; qr: string; setupKey: string };
    };

const NEVER_ECHOED = new Set(["code", "typed_confirmation", "password", "confirm"]);

/** The submitted text fields, to put back into the form after an error. Secrets and confirmation words are left out. */
export function echoValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !NEVER_ECHOED.has(key) && value.length <= 1000) out[key] = value;
  }
  return out;
}

export const staffIdleState: StaffFormState = { status: "idle" };

/** Only an address inside /admin may be followed after a form succeeds. */
export function safeAdminHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  return /^\/admin(\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}){0,3}$/.test(href) ? href : null;
}
