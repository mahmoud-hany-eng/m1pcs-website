/**
 * Claim codes. Staff issue a one-time code (shown as XXXXX-XXXXX-XXXXX-XXXXX, 20 letters and digits) so an existing
 * customer, for example one managed over WhatsApp, can join their history to a new account. This module only
 * normalises what a person typed; the database decides whether the code is real, unused and unexpired, and it
 * counts the failed attempts.
 */

/** Strips spaces and dashes and upper-cases. Returns null unless exactly 20 letters or digits remain. */
export function normalizeClaimCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{20}$/.test(compact) ? compact : null;
}

/** The same code in the grouped form people read aloud. */
export function groupClaimCode(normalized: string): string {
  return normalized.replace(/(.{5})(?=.)/g, "$1-");
}

/**
 * The one message for every claim that fails. It is deliberately the same whether the code is malformed, wrong,
 * expired, already used, or the account has made too many attempts, so it never reveals whether a customer or a code
 * exists.
 */
export const CLAIM_FAILED_MESSAGE =
  "That code did not work. Check it and try again, or ask M1 on WhatsApp to send you a new one.";
