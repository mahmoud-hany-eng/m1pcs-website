// Unit tests for the quote form's mandatory "Budget in QAR" validation.
//
// Run with Node's built-in test runner (no extra dependencies; Node 22.18+
// strips the TypeScript types itself):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/quote-budget.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_ERRORS, validateBudgetQar } from "../src/lib/quote-budget.ts";

function rejects(input, error) {
  assert.deepEqual(validateBudgetQar(input), { ok: false, error }, JSON.stringify(input));
}

function accepts(input, amount) {
  assert.deepEqual(validateBudgetQar(input), { ok: true, amount }, JSON.stringify(input));
}

describe("validateBudgetQar", () => {
  it("rejects an empty budget", () => {
    rejects("", BUDGET_ERRORS.missing);
  });

  it("rejects a whitespace-only budget", () => {
    for (const input of [" ", "   ", "\t", "\n", "   "]) rejects(input, BUDGET_ERRORS.missing);
  });

  it("rejects a zero budget", () => {
    for (const input of ["0", "00", "0.0", "0.00", " 0 ", "٠"]) rejects(input, BUDGET_ERRORS.notPositive);
  });

  it("rejects a negative budget", () => {
    for (const input of ["-1", "-5000", "-5,000", "- 5000", "−5000", "-0"]) {
      rejects(input, BUDGET_ERRORS.notPositive);
    }
  });

  it("rejects a non-numeric budget", () => {
    for (const input of [
      "abc",
      "five thousand",
      "5k",
      "5000 QAR",
      "QAR 5000",
      "5000-6000",
      "1e3",
      "0x10",
      "Infinity",
      "NaN",
      "5,00",
      "50,00,000",
      "5000.",
      ".5",
      "5000.123",
      "5 000",
      "--5000",
      "-abc",
      "1".repeat(400),
    ]) {
      rejects(input, BUDGET_ERRORS.notANumber);
    }
  });

  it("accepts valid positive QAR amounts", () => {
    accepts("5000", 5000);
    accepts(" 5000 ", 5000);
    accepts("1", 1);
    accepts("0.5", 0.5);
    accepts("4999.99", 4999.99);
    accepts("05000", 5000);
    accepts("5,000", 5000);
    accepts("12,500.50", 12500.5);
    accepts("1,000,000", 1000000);
  });

  it("accepts amounts typed with Arabic-Indic digits and separators", () => {
    accepts("٥٠٠٠", 5000);
    accepts("۵۰۰۰", 5000);
    accepts("٥٬٠٠٠", 5000);
    accepts("٤٩٩٩٫٥", 4999.5);
  });
});
