/**
 * Validation for the quote form's mandatory "Budget in QAR" field.
 *
 * Deliberately self-contained (no `@/` imports, no framework code) so it can
 * be unit-tested directly with Node's built-in test runner — see
 * `tests/quote-budget.test.mjs`.
 */

export type BudgetValidation = { ok: true; amount: number } | { ok: false; error: string };

export const BUDGET_ERRORS = {
  missing: "Please enter your budget in QAR — an approximate amount is fine.",
  notANumber: "Please enter your budget in QAR as a number only, e.g. 5000.",
  notPositive: "Please enter a budget greater than 0 QAR.",
} as const;

/**
 * Plain digits ("5000") or comma-grouped thousands ("5,000"), optionally
 * with up to two decimal places. Anything else — letters, currency text,
 * "5k", exponents, hex — is rejected rather than guessed at.
 */
const AMOUNT_PATTERN = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

/**
 * Phones set to Arabic can type Arabic-Indic digits (and the Arabic
 * thousands/decimal separators) into a numeric field. Those are valid
 * amounts, so read them as their ASCII equivalents before checking.
 */
function toAsciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

/**
 * Checks a raw "Budget in QAR" input. Empty, whitespace-only, non-numeric,
 * zero and negative values are rejected with a customer-facing message;
 * any positive amount is accepted.
 */
export function validateBudgetQar(raw: string): BudgetValidation {
  const value = toAsciiDigits(raw.trim());
  if (!value) return { ok: false, error: BUDGET_ERRORS.missing };

  // A leading minus sign is recognised only so a negative amount gets the
  // more helpful "greater than 0" message instead of "not a number".
  const isNegative = /^[-−]/.test(value);
  const unsigned = isNegative ? value.slice(1).trim() : value;
  if (!AMOUNT_PATTERN.test(unsigned)) return { ok: false, error: BUDGET_ERRORS.notANumber };

  const amount = Number(unsigned.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return { ok: false, error: BUDGET_ERRORS.notANumber };
  if (isNegative || amount <= 0) return { ok: false, error: BUDGET_ERRORS.notPositive };

  return { ok: true, amount };
}
