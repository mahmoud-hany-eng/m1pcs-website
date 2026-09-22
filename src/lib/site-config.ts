/**
 * Centralized site configuration.
 *
 * Everything that might change (contact details, social links, legal
 * identity) lives here so the rest of the codebase never hardcodes it.
 *
 * IMPORTANT — no fake fallbacks: contact fields that come from the
 * environment (WhatsApp, phone, email) resolve to `null` when unset, never
 * to a placeholder-looking value. Every place in the UI that displays one
 * of these must check for `null` and hide that item gracefully rather than
 * rendering fake contact info.
 */

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

const whatsappNumber = readEnv("NEXT_PUBLIC_WHATSAPP_NUMBER");

/** Formats a digits-only Qatar number like "97471084710" as "+974 71084710". */
function formatQatarNumber(digits: string | null): string | null {
  if (!digits) return null;
  const cleaned = digits.replace(/[^\d]/g, "");
  if (cleaned.startsWith("974") && cleaned.length > 3) {
    return `+974 ${cleaned.slice(3)}`;
  }
  return `+${cleaned}`;
}
const contactEmail = readEnv("NEXT_PUBLIC_CONTACT_EMAIL");
const contactPhone = readEnv("NEXT_PUBLIC_CONTACT_PHONE");
const siteUrl = readEnv("NEXT_PUBLIC_SITE_URL");
const ecommerceLicenceNumber = readEnv("NEXT_PUBLIC_ECOMMERCE_LICENCE_NUMBER");

export const siteConfig = {
  brand: {
    name: "M1 Gaming PCs",
    shortName: "M1",
    tagline: "Custom PCs. Built Around You.",
  },

  /** Official registered business identity — do not alter without the CR document. */
  legal: {
    registeredName: "M One Computer and Accessories Retail",
    commercialRegistration: "252034",
    country: "State of Qatar",
    activities: [
      { code: "474110", label: "Retail sale of computers and accessories, including printers and ink" },
      { code: "479120", label: "Retail sale via Internet" },
    ],
    /**
     * The Qatar e-Commerce Licence number. `null` until a real value is
     * configured via NEXT_PUBLIC_ECOMMERCE_LICENCE_NUMBER — the UI must
     * only render this field when it is non-null.
     */
    ecommerceLicenceNumber,
  },

  /**
   * Contact fields are `null` (not a placeholder string) when not
   * configured via environment variables. Consuming components must
   * branch on that and hide the corresponding UI rather than show
   * anything fake.
   */
  contact: {
    /** Digits-ish, used to build the wa.me link. */
    whatsappNumber,
    /** Human-readable form of the same number, for display only. */
    whatsappDisplay: formatQatarNumber(whatsappNumber),
    email: contactEmail,
    phoneDisplay: contactPhone,
    /** Displayed alongside contact methods; not environment-configurable. */
    serviceHours: "3:00 PM – 10:00 PM",
  },

  social: {
    instagram: {
      handle: "@m1pcs.qa",
      url: "https://www.instagram.com/m1pcs.qa/",
    },
  },

  /** Business operations facts used in copy across Home/Contact/Policies. */
  operations: {
    homeDeliveryAvailable: true,
    deliveryTimeframe: "7–10 business days",
    deliveryNote:
      "Typical delivery time is 7–10 business days, although this may vary depending on the requested products and sourcing requirements.",
    depositNote:
      "For some orders, a deposit may be required depending on the requested products and total order value. The remaining balance is paid upon delivery.",
    paymentMethodsActive: ["Cash", "Fawran"] as const,
    paymentMethodsComingSoon: ["Debit / Credit Card", "PayLater"] as const,
    returnWindowDays: 30,
    warrantyNote:
      "Manufacturer warranty is available on products where applicable. Warranty periods vary by product, and many products come with warranties starting from 3 years.",
  },

  /** Canonical production URL, no trailing slash. Falls back to a safe
   * default for metadata generation even before a real domain is
   * connected — this never needs to resolve over DNS for the site itself
   * to build and run correctly. */
  siteUrl: siteUrl || "https://m1pcs.qa",
} as const;

export type SiteConfig = typeof siteConfig;

// Server-only heads-up (never logged to the browser console) so a
// deployment that forgot to set contact details is obvious in the
// Vercel build/runtime logs, instead of silently hiding "Get a Quote" /
// WhatsApp functionality with no explanation anywhere.
if (typeof window === "undefined") {
  const missing = [
    !whatsappNumber && "NEXT_PUBLIC_WHATSAPP_NUMBER",
    !contactEmail && "NEXT_PUBLIC_CONTACT_EMAIL",
    !contactPhone && "NEXT_PUBLIC_CONTACT_PHONE",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.warn(
      `[m1-config] Missing environment variable(s): ${missing.join(
        ", "
      )} — the corresponding contact UI will be hidden rather than show placeholder data. Set these before going live.`
    );
  }
}
