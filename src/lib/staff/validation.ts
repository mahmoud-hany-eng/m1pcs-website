/**
 * Parsing and checking what staff type into admin forms. Pure functions, no server imports, so they are unit tested
 * directly. Money is parsed from QAR text into integer minor units by the shared helper (never floating point), and
 * every list of allowed values is fixed here. The database checks everything again.
 */
import { parseQarToMinor } from "@/lib/platform/money";
import type { StaffFieldErrors } from "./form-state";

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: StaffFieldErrors };

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};
const optional = (form: FormData, name: string, max: number, errors: StaffFieldErrors, label: string): string | null => {
  const value = text(form, name);
  if (value === "") return null;
  if (value.length > max) errors[name] = `${label} is too long (at most ${max} characters).`;
  return value;
};

export const CUSTOMER_SOURCES = ["whatsapp", "instagram", "walk_in", "other"] as const;
export const PAYMENT_METHODS = ["cash", "fawran"] as const;
export const PAYMENT_PURPOSES = ["deposit", "balance", "other"] as const;
export const ITEM_KINDS = ["component", "build_service", "delivery", "discount", "other"] as const;
export const MAX_ORDER_ITEMS = 30;
const PHONE = /^\+?[0-9 ()-]{6,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CustomerInput {
  fullName: string;
  phone: string | null;
  email: string | null;
  source: string;
  language: string;
  address: string | null;
}

export function parseCustomer(form: FormData): Parsed<CustomerInput> {
  const errors: StaffFieldErrors = {};
  const fullName = text(form, "full_name");
  if (fullName.length < 1 || fullName.length > 120) errors.full_name = "Enter the customer's name (up to 120 characters).";
  const phone = optional(form, "phone", 24, errors, "The phone number");
  if (phone && !PHONE.test(phone)) errors.phone = "Enter a phone number with digits, spaces, + or brackets only.";
  const email = optional(form, "email", 254, errors, "The email address");
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address.";
  const source = text(form, "source") || "whatsapp";
  if (!(CUSTOMER_SOURCES as readonly string[]).includes(source)) errors.source = "Choose where the customer came from.";
  const language = text(form, "preferred_language") || "en";
  if (language !== "en" && language !== "ar") errors.preferred_language = "Choose English or Arabic.";
  const address = optional(form, "delivery_address", 500, errors, "The address");
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { fullName, phone, email, source, language, address } };
}

export interface OrderItemInput {
  kind: (typeof ITEM_KINDS)[number];
  description: string;
  quantity: number;
  unit_price_minor: number;
}
export interface OrderInput {
  customerId: string;
  items: OrderItemInput[];
  deliveryMethod: string | null;
  deliveryAddress: string | null;
}

/**
 * Item rows arrive as item_description_N, item_quantity_N, item_price_N, item_kind_N. A row with no description and no
 * price is an unused row and is skipped. A negative price is allowed only for a discount, and a discount is always
 * stored as a negative amount. Staff must tick that they checked the prices.
 */
export function parseOrder(form: FormData, customerId: string): Parsed<OrderInput> {
  const errors: StaffFieldErrors = {};
  const items: OrderItemInput[] = [];
  for (let i = 0; i < MAX_ORDER_ITEMS; i += 1) {
    const description = text(form, `item_description_${i}`);
    const priceText = text(form, `item_price_${i}`);
    if (description === "" && priceText === "") continue;
    const kind = (text(form, `item_kind_${i}`) || "component") as OrderItemInput["kind"];
    if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
      errors[`item_kind_${i}`] = "Choose a type.";
      continue;
    }
    if (description.length < 1 || description.length > 200) errors[`item_description_${i}`] = "Describe the item (up to 200 characters).";
    const quantityText = text(form, `item_quantity_${i}`) || "1";
    if (!/^[0-9]{1,4}$/.test(quantityText) || Number(quantityText) < 1) errors[`item_quantity_${i}`] = "Enter a whole quantity from 1 to 9999.";
    const unsigned = priceText.replace(/^-/, "");
    const minor = parseQarToMinor(unsigned);
    if (minor === null) {
      errors[`item_price_${i}`] = "Enter an exact amount in QAR, like 1250 or 1,250.50.";
      continue;
    }
    const negative = priceText.startsWith("-");
    if (negative && kind !== "discount") errors[`item_price_${i}`] = "Only a discount can be a negative amount.";
    items.push({ kind, description, quantity: Number(quantityText), unit_price_minor: kind === "discount" ? -Math.abs(minor) : minor });
  }
  if (items.length === 0 && !Object.keys(errors).length) errors.items = "Add at least one item.";
  if (text(form, "prices_verified") !== "yes") errors.prices_verified = "Confirm that you have checked the prices.";
  const deliveryMethod = text(form, "delivery_method") || null;
  if (deliveryMethod && deliveryMethod !== "delivery" && deliveryMethod !== "collection") errors.delivery_method = "Choose delivery or collection.";
  const deliveryAddress = optional(form, "delivery_address", 500, errors, "The address");
  if (!errors.items && items.length && items.reduce((sum, item) => sum + item.quantity * item.unit_price_minor, 0) <= 0) errors.items = "The order total must be greater than zero.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { customerId, items, deliveryMethod, deliveryAddress } };
}

export interface PaymentInput {
  purpose: string;
  amountMinor: number;
  method: string;
  reference: string | null;
  notes: string | null;
}

/**
 * The idempotency key of one intended action (record this payment, create this order). The page chooses it, the form carries
 * it, and every retry of the same action sends the same one; the database makes a repeat harmless. The shape is the one the
 * database enforces. A form without a valid key is stale or tampered with, so the action refuses it before any call.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
export function parseIdempotencyKey(form: FormData): string | null {
  const value = form.get("idempotency_key");
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value.trim()) ? value.trim() : null;
}
export const STALE_FORM_MESSAGE = "This form is out of date. Reload the page and try again. Nothing was changed.";

/** A new key for the NEXT action. Keys only need to be unique per staff member, so a page without crypto.randomUUID still gets one. */
export function freshIdempotencyKey(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * The amount already paid on the order, in minor units, that the person was looking at when they filled in the payment form.
 * The database compares it with the order's real balance in the same transaction as the insert and refuses the payment if
 * they differ. A form without a valid value is stale or tampered with, so the action refuses it before any call.
 */
export function parseExpectedPaid(form: FormData): number | null {
  const value = form.get("expected_paid_minor");
  if (typeof value !== "string" || !/^[0-9]{1,12}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** A payment is recorded by a person confirming receipt: the form says so, and the person must tick it. */
export function parsePayment(form: FormData): Parsed<PaymentInput> {
  const errors: StaffFieldErrors = {};
  const amountMinor = parseQarToMinor(text(form, "amount"));
  if (amountMinor === null || amountMinor <= 0) errors.amount = "Enter the amount received in QAR, like 1000 or 1,000.50.";
  const purpose = text(form, "purpose") || "deposit";
  if (!(PAYMENT_PURPOSES as readonly string[]).includes(purpose)) errors.purpose = "Choose what the payment is for.";
  const method = text(form, "method");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) errors.method = "Choose cash or Fawran.";
  const reference = optional(form, "reference", 120, errors, "The reference");
  const notes = optional(form, "notes", 1000, errors, "The note");
  if (text(form, "received_confirmed") !== "yes") errors.received_confirmed = "Confirm that you have received this payment.";
  if (Object.keys(errors).length || amountMinor === null) return { ok: false, errors };
  return { ok: true, value: { purpose, amountMinor, method, reference, notes } };
}

export function parseReason(form: FormData, field = "reason"): Parsed<string> {
  const reason = text(form, field);
  if (reason.length < 3 || reason.length > 500) return { ok: false, errors: { [field]: "Give a reason of 3 to 500 characters." } };
  return { ok: true, value: reason };
}

export interface TrackingInput {
  title: string;
  message: string | null;
}
export function parseTracking(form: FormData): Parsed<TrackingInput> {
  const errors: StaffFieldErrors = {};
  const title = text(form, "title");
  if (title.length < 1 || title.length > 120) errors.title = "Write a short title (up to 120 characters).";
  const message = optional(form, "message", 1000, errors, "The message");
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { title, message } };
}

export const CLAIM_CODE_HOURS = [24, 72, 168] as const;

/** A percentage with at most two decimals, as basis points (15 -> 1500, 12.5 -> 1250). */
export function parsePercentToBps(input: string): number | null {
  const match = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps >= 0 && bps <= 10000 ? bps : null;
}

export interface DepositScheduleInput {
  firstUpToMinor: number;
  secondUpToMinor: number;
  percentBps: [number, number, number];
  gate: string;
  reason: string;
}

/**
 * The deposit schedule as three tiers by the whole order total: up to the first limit, above it up to the second,
 * and above that. The percentages apply to the entire total. The gate status is carried over from the current policy.
 */
export function parseDepositSchedule(form: FormData, gate: string): Parsed<DepositScheduleInput> {
  const errors: StaffFieldErrors = {};
  const first = parseQarToMinor(text(form, "first_up_to"));
  const second = parseQarToMinor(text(form, "second_up_to"));
  if (first === null || first <= 0) errors.first_up_to = "Enter the first limit in QAR, like 3000.";
  if (second === null || second <= 0) errors.second_up_to = "Enter the second limit in QAR, like 5000.";
  if (first !== null && second !== null && second <= first) errors.second_up_to = "The second limit must be higher than the first.";
  const bps: number[] = [];
  for (const [index, name] of ["percent_1", "percent_2", "percent_3"].entries()) {
    const value = parsePercentToBps(text(form, name));
    if (value === null) errors[name] = "Enter a percentage from 0 to 100, with at most two decimals.";
    else bps[index] = value;
  }
  const reason = parseReason(form);
  if (!reason.ok) errors.reason = reason.errors.reason;
  if (text(form, "confirmed_by_owner") !== "yes") errors.confirmed_by_owner = "Only a schedule the owner has confirmed can be saved here.";
  if (text(form, "typed_confirmation") !== "CHANGE DEPOSIT SCHEDULE") errors.typed_confirmation = "Type CHANGE DEPOSIT SCHEDULE to confirm.";
  if (Object.keys(errors).length || first === null || second === null || !reason.ok) return { ok: false, errors };
  return {
    ok: true,
    value: { firstUpToMinor: first, secondUpToMinor: second, percentBps: [bps[0], bps[1], bps[2]], gate, reason: reason.value },
  };
}

/** The policy value for the three-tier schedule, in the shape the database validates. */
export function depositPolicyValue(input: DepositScheduleInput): Record<string, unknown> {
  return {
    mode: "tiered",
    minimum_minor: 0,
    required_before_status: input.gate,
    tiers: [
      { up_to_minor: input.firstUpToMinor, percent_bps: input.percentBps[0] },
      { up_to_minor: input.secondUpToMinor, percent_bps: input.percentBps[1] },
      { percent_bps: input.percentBps[2] },
    ],
  };
}

/** Two ids that must be UUIDs before they go anywhere near a database call. */
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
