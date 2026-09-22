import { siteConfig } from "@/lib/site-config";
import type { QuoteFormData } from "@/types";

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

function line(label: string, value?: string | null) {
  return `${label}: ${value && value.trim().length > 0 ? value.trim() : "-"}`;
}

/**
 * Formats a completed quote form into a clean, readable WhatsApp message
 * matching the structure requested for the "Build My PC" flow.
 */
export function buildQuoteMessage(data: QuoteFormData): string {
  const accessories =
    data.accessories.length > 0 ? data.accessories.join(", ") : "None";

  const rows = [
    "*New M1 PC Quote Request*",
    "",
    line("Name", data.fullName),
    line("Mobile/WhatsApp", data.mobile),
    line("Email", data.email),
    line("Budget (QAR)", data.budgetQar),
    line("Main use", data.mainUse),
    line("Games", data.games),
    line("Resolution", data.resolution),
    line("Target FPS", data.targetFps),
    line("CPU preference", data.cpuPreference),
    line("GPU preference", data.gpuPreference),
    line("Storage", data.storage),
    line("Build color", data.buildColor),
    line("RGB", data.rgb),
    line("Wi-Fi", data.wifi),
    line("Monitor", data.monitor),
    line("Accessories", accessories),
    line("Additional requirements", data.additionalRequirements || "None"),
  ];

  if (data.referenceBuild) {
    rows.push(line("Reference build", data.referenceBuild));
  }

  rows.push(
    "",
    "(Submitted via m1pcs.qa — this is a quote request, not an order.)"
  );

  return rows.join("\n");
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
