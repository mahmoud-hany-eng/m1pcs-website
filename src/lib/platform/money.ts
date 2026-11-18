/**
 * Money helpers for the business platform.
 *
 * Every amount in the database is an integer count of minor units of Qatari riyal (1 QAR = 100 dirhams): no floats,
 * no rounding surprises (REC-PLAT-008). This is the one shared helper; it only converts between that integer and
 * text for display or form input.
 *
 * It never decides a price, a deposit, a balance or a loyalty balance. Those are computed by the database from its
 * own rows, and a number typed in a browser is never trusted. Use it for DISPLAY and for validating what a person
 * typed, nothing else.
 *
 * Plain TypeScript with no imports so it also runs, unchanged, under the local test runner.
 */

export const CURRENCY = "QAR" as const;
export const MINOR_UNITS_PER_QAR = 100;

/** True for a whole number that JavaScript can hold exactly. */
export function isMinorUnits(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Reads an amount a person typed ("1250", "1,250.50", "QAR 99.9", "QR 5") into minor units.
 * Returns null for anything that is not an exact amount with at most two decimals: negatives, letters, "1.234",
 * "1,2,3", scientific notation, empty text. A null is a form error to show, never a value to guess at.
 */
export function parseQarToMinor(input: string): number | null {
  if (typeof input !== "string") return null;
  const match = /^\s*(?:QAR|QR)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*$/i.exec(input);
  if (!match) return null;
  const whole = match[1].replace(/,/g, "");
  if (whole.length > 13) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const minor = Number(whole) * MINOR_UNITS_PER_QAR + Number(fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Formats minor units for display: 125050 -> "QAR 1,250.50", -500 -> "-QAR 5.00". Throws on a non-integer. */
export function formatQar(minor: number): string {
  if (!isMinorUnits(minor)) throw new RangeError("an amount must be a whole number of minor units");
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_UNITS_PER_QAR);
  const fraction = String(abs % MINOR_UNITS_PER_QAR).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${CURRENCY} ${grouped}.${fraction}`;
}

/** Adds amounts and fails loudly if the result is not exact, instead of drifting into floating point. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!isMinorUnits(amount)) throw new RangeError("an amount must be a whole number of minor units");
    total += amount;
    if (!Number.isSafeInteger(total)) throw new RangeError("the total is too large to hold exactly");
  }
  return total;
}
