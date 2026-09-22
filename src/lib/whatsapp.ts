import { siteConfig } from "@/lib/site-config";
import { categoryWaHeading, getVisibleCategoryFields } from "@/lib/quote-schema";
import type { QuoteFormState } from "@/types/quote";

/**
 * Builds a wa.me deep link that opens WhatsApp with a pre-filled message.
 * The number always comes from the single centralized config value.
 * Returns `null` when no WhatsApp number is configured — callers must
 * handle that instead of linking to a broken/empty wa.me URL.
 */
export function buildWhatsAppLink(
  message: string,
  number: string | null = siteConfig.contact.whatsappNumber
): string | null {
  if (!number) return null;
  const digitsOnly = number.replace(/[^\d]/g, "");
  if (!digitsOnly) return null;
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

/** Trims a single answer to a display string, or null when it has no content worth sending. */
function formatAnswer(value: string | string[] | undefined | null): string | null {
  if (Array.isArray(value)) {
    const joined = value.map((v) => v.trim()).filter(Boolean).join(", ");
    return joined.length > 0 ? joined : null;
  }
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Formats a completed quote form into a clean, readable WhatsApp message.
 * The message adapts to whichever category was selected — it only ever
 * includes that category's questions (via `getVisibleCategoryFields`,
 * which also drops any question hidden by a `showIf`) and skips any field
 * left blank, so no undefined/null/empty lines are ever sent.
 */
export function buildQuoteMessage(state: QuoteFormState): string {
  const { category, general, categoryData } = state;

  const headerSection = ["*New M1 Quote Request*"];

  const categorySection = category ? [`Quote For: ${category}`] : [];

  const customerLines = [
    formatAnswer(general.fullName) && `Name: ${formatAnswer(general.fullName)}`,
    formatAnswer(general.mobile) && `Phone: ${formatAnswer(general.mobile)}`,
    formatAnswer(general.email) && `Email: ${formatAnswer(general.email)}`,
  ].filter((line): line is string => Boolean(line));
  const customerSection = customerLines.length > 0 ? ["Customer", ...customerLines] : [];

  const orderLines: string[] = [];
  const budget = formatAnswer(general.budgetQar);
  if (budget) orderLines.push(`Budget: QAR ${budget}`);
  const quantity = formatAnswer(general.quantity);
  if (quantity) orderLines.push(`Quantity: ${quantity}`);
  const preference = formatAnswer(general.productPreference);
  if (preference) {
    orderLines.push(`Preference: ${preference}`);
    if (general.productPreference === "I want a specific model") {
      const model = formatAnswer(general.specificModel);
      if (model) orderLines.push(`Preferred Model: ${model}`);
    }
  }

  const categoryFieldLines = getVisibleCategoryFields(category, categoryData)
    .map((field) => {
      const answer = formatAnswer(categoryData[field.id]);
      return answer ? `${field.waLabel ?? field.label}: ${answer}` : null;
    })
    .filter((line): line is string => Boolean(line));
  const categoryFieldSection =
    category && categoryFieldLines.length > 0
      ? [`${categoryWaHeading[category]} Requirements`, ...categoryFieldLines]
      : [];

  const notes = formatAnswer(general.additionalRequirements);
  const notesSection = notes ? ["Additional Notes:", notes] : [];

  const footerSection = ["(Submitted via m1pcs.qa — this is a quote request, not an order.)"];

  return [
    headerSection,
    categorySection,
    customerSection,
    orderLines,
    categoryFieldSection,
    notesSection,
    footerSection,
  ]
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}

/** Short, generic WhatsApp message used by "Request current price" CTAs on category cards. */
export function buildCategoryPriceMessage(categoryName: string): string {
  return [
    `Hi M1, I'd like the current price and availability for: *${categoryName}*.`,
    "",
    "(Sent via m1pcs.qa)",
  ].join("\n");
}

/** Message used by "Request a similar build" on a completed build card. */
export function buildSimilarBuildMessage(buildName: string): string {
  return [
    `Hi M1, I'm interested in a build similar to: *${buildName}*.`,
    "Could you share current pricing and availability for equivalent components?",
    "",
    "(Sent via m1pcs.qa)",
  ].join("\n");
}

/** Generic contact message used by the floating WhatsApp button. */
export function buildGeneralContactMessage(): string {
  return "Hi M1, I have a question about a custom PC build.";
}
