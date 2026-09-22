/**
 * Types for the dynamic, multi-product "Request a Quote" form.
 *
 * The form's category-specific questions are driven entirely by the config
 * in `@/lib/quote-schema` rather than hardcoded per-category JSX — these
 * types describe that config plus the shape of the answers it produces.
 */

export const QUOTE_CATEGORIES = [
  "Complete Custom PC",
  "Graphics Card (GPU)",
  "Processor (CPU)",
  "Motherboard",
  "RAM / Memory",
  "SSD / Storage",
  "Power Supply",
  "CPU Cooling",
  "PC Case",
  "Case Fans / RGB Fans",
  "Monitor",
  "Keyboard",
  "Mouse",
  "Headset",
  "Mouse Pad",
  "Wi-Fi / Bluetooth Adapter",
  "Cables / PC Accessories",
  "Other Tech Product",
] as const;

export type QuoteCategory = (typeof QUOTE_CATEGORIES)[number];

export type QuoteFieldType = "text" | "textarea" | "url" | "select" | "multiselect";

/** Answers for the currently selected category's fields, keyed by field id. */
export type QuoteAnswers = Record<string, string | string[]>;

export interface QuoteFieldConfig {
  /** Key this field's answer is stored under in `QuoteAnswers`. */
  id: string;
  label: string;
  /** Shorter label used in the generated WhatsApp message; falls back to `label`. */
  waLabel?: string;
  type: QuoteFieldType;
  /** Required for "select" and "multiselect". */
  options?: readonly string[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Row count for "textarea" fields. */
  rows?: number;
  /** For "multiselect": selecting this option clears every other selection (e.g. "None"). */
  exclusiveOption?: string;
  /** When present, the field is only shown/validated/sent while this returns true. */
  showIf?: (answers: QuoteAnswers) => boolean;
}

export const PRODUCT_PREFERENCES = [
  "I want a specific model",
  "Find me the best option for my requirements",
  "Find me the best deal available",
  "Not sure",
] as const;

export type ProductPreference = (typeof PRODUCT_PREFERENCES)[number];

export interface QuoteGeneralData {
  fullName: string;
  mobile: string;
  email: string;
  /** Optional — the customer may not know their budget yet. */
  budgetQar: string;
  quantity: string;
  productPreference: ProductPreference | "";
  /** Only meaningful when productPreference === "I want a specific model". */
  specificModel: string;
  additionalRequirements: string;
}

export interface QuoteFormState {
  category: QuoteCategory | "";
  general: QuoteGeneralData;
  categoryData: QuoteAnswers;
}
