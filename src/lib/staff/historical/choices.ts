/**
 * The fixed choices of the import forms: plain data with no imports, so a form in the browser can use them without pulling any server code
 * (the file readers in forms.ts use Node's crypto and must never reach a browser bundle).
 */
import type { AttachmentClass } from "./types";

/** The owner's date-order choice. "auto" lets the importer infer it, and ask when the file cannot say. */
export const DATE_FORMAT_CHOICES = [
  { value: "auto", label: "Work it out from the file (recommended)" },
  { value: "dmy", label: "Day first (31/12/2025)" },
  { value: "mdy", label: "Month first (12/31/2025)" },
  { value: "iso", label: "Year first (2025-12-31)" },
] as const;

export const ATTACHMENT_CLASSES: readonly { value: AttachmentClass; label: string }[] = [
  { value: "unclassified", label: "Not decided yet" },
  { value: "customer_receipt", label: "Customer receipt (what the customer was given)" },
  { value: "supplier_invoice", label: "Supplier invoice (internal, never shown to a customer)" },
];

/** Item lines the owner may type when describing an imported order later. */
export const MAX_ITEM_LINES = 6;
