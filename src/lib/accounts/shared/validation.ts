/**
 * Input validation for the account forms. It runs on the server, in the server actions, and never trusts the browser:
 * the form's own checks are a convenience. Messages are fixed text; they never echo what was typed.
 */

export interface FieldErrors {
  [field: string]: string | undefined;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The database check on customers.phone.
const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/;

export const PASSWORD_MIN_LENGTH = 10;
// The password hashing used by the auth service ignores everything past 72 bytes, so a longer password is refused.
export const PASSWORD_MAX_BYTES = 72;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function parseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function parseSignUp(formData: FormData): Parsed<{ email: string; password: string }> {
  const errors: FieldErrors = {};
  const email = parseEmail(text(formData, "email"));
  if (!email) errors.email = "Enter a valid email address.";
  const password = text(formData, "password");
  if (password.length < PASSWORD_MIN_LENGTH) errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) errors.password = "That password is too long.";
  else if (email && password.toLowerCase() === email) errors.password = "Choose a password that is not your email address.";
  if (Object.keys(errors).length > 0 || !email) return { ok: false, errors };
  return { ok: true, value: { email, password } };
}

export function parseSignIn(formData: FormData): Parsed<{ email: string; password: string }> {
  const errors: FieldErrors = {};
  const email = parseEmail(text(formData, "email"));
  if (!email) errors.email = "Enter a valid email address.";
  const password = text(formData, "password");
  if (password.length === 0) errors.password = "Enter your password.";
  else if (password.length > 1024) errors.password = "Enter your password.";
  if (Object.keys(errors).length > 0 || !email) return { ok: false, errors };
  return { ok: true, value: { email, password } };
}

export function parseEmailOnly(formData: FormData): Parsed<{ email: string }> {
  const email = parseEmail(text(formData, "email"));
  if (!email) return { ok: false, errors: { email: "Enter a valid email address." } };
  return { ok: true, value: { email } };
}

/** The new password on the reset page: the same rules as sign-up, typed twice. */
export function parseNewPassword(formData: FormData): Parsed<{ password: string }> {
  const errors: FieldErrors = {};
  const password = text(formData, "password");
  const confirm = text(formData, "confirm");
  if (password.length < PASSWORD_MIN_LENGTH) errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) errors.password = "That password is too long.";
  if (!errors.password && password !== confirm) errors.confirm = "The two passwords are not the same.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { password } };
}

export interface ProfileInput {
  full_name: string;
  phone: string | null;
  preferred_language: "en" | "ar";
  delivery_address: string | null;
  marketing_consent: boolean;
}

export function parseProfile(formData: FormData): Parsed<ProfileInput> {
  const errors: FieldErrors = {};
  const fullName = text(formData, "full_name").trim();
  if (fullName.length < 1 || fullName.length > 120) errors.full_name = "Enter your name (up to 120 characters).";
  const phoneRaw = text(formData, "phone").trim();
  let phone: string | null = null;
  if (phoneRaw.length > 0) {
    if (!PHONE_RE.test(phoneRaw)) errors.phone = "Enter a phone number using digits, spaces, + ( ) or -.";
    else phone = phoneRaw;
  }
  const language = text(formData, "preferred_language");
  if (language !== "en" && language !== "ar") errors.preferred_language = "Choose English or Arabic.";
  const addressRaw = text(formData, "delivery_address").trim();
  if (addressRaw.length > 500) errors.delivery_address = "Keep the address under 500 characters.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      full_name: fullName,
      phone,
      preferred_language: language as "en" | "ar",
      delivery_address: addressRaw.length > 0 ? addressRaw : null,
      marketing_consent: text(formData, "marketing_consent") === "on",
    },
  };
}
