/**
 * Parsing and checking what staff type into admin forms. Pure functions, no server imports, so they are unit tested
 * directly. Money is parsed from QAR text into integer minor units by the shared helper (never floating point), and
 * every list of allowed values is fixed here. The database checks everything again.
 */
import { parseQarToMinor } from "@/lib/platform/money";
import { COST_CATEGORIES, COST_KINDS, MAX_NEW_ORDER_COSTS } from "./finance";
import type { StaffFieldErrors } from "./form-state";
import type { NewOrderCost } from "./types";

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
/** Every kind an order line can have in the database, including the legacy discount line that older orders may carry (for DISPLAY). */
export const ITEM_KINDS = ["component", "build_service", "delivery", "discount", "other"] as const;
/**
 * The kinds the order form offers and the server accepts for a NEW order. A discount is not an item: it is entered, authorized and recorded
 * under Pricing & Rewards (owner only), where it cannot lower the deposit. The database refuses a discount line on the same ground.
 */
export const NEW_ORDER_ITEM_KINDS = ["component", "build_service", "delivery", "other"] as const;
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
  kind: (typeof NEW_ORDER_ITEM_KINDS)[number];
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
 * price is an unused row and is skipped. A price is never negative: a discount is entered under Pricing & Rewards, not as a line.
 * Staff must tick that they checked the prices.
 */
export function parseOrder(form: FormData, customerId: string): Parsed<OrderInput> {
  const errors: StaffFieldErrors = {};
  const items: OrderItemInput[] = [];
  for (let i = 0; i < MAX_ORDER_ITEMS; i += 1) {
    const description = text(form, `item_description_${i}`);
    const priceText = text(form, `item_price_${i}`);
    if (description === "" && priceText === "") continue;
    const kind = (text(form, `item_kind_${i}`) || "component") as OrderItemInput["kind"];
    if (kind === ("discount" as string)) {
      errors[`item_kind_${i}`] = "A discount is not an item. Enter it under Pricing & Rewards.";
      continue;
    }
    if (!(NEW_ORDER_ITEM_KINDS as readonly string[]).includes(kind)) {
      errors[`item_kind_${i}`] = "Choose a type.";
      continue;
    }
    if (description.length < 1 || description.length > 200) errors[`item_description_${i}`] = "Describe the item (up to 200 characters).";
    const quantityText = text(form, `item_quantity_${i}`) || "1";
    if (!/^[0-9]{1,4}$/.test(quantityText) || Number(quantityText) < 1) errors[`item_quantity_${i}`] = "Enter a whole quantity from 1 to 9999.";
    if (priceText.startsWith("-")) {
      errors[`item_price_${i}`] = "A price cannot be negative. Enter a discount under Pricing & Rewards.";
      continue;
    }
    const minor = parseQarToMinor(priceText);
    if (minor === null) {
      errors[`item_price_${i}`] = "Enter an exact amount in QAR, like 1250 or 1,250.50.";
      continue;
    }
    items.push({ kind, description, quantity: Number(quantityText), unit_price_minor: minor });
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

/** What the Pricing & Rewards section sends: a discount (owner only), points to redeem (owner only) and the two figures the screen showed. */
export interface PricingInput {
  discount: { mode: "fixed"; amount_minor: number; reason: string } | { mode: "percent"; percent_bps: number; reason: string } | null;
  redeemPoints: number;
  expectedNetMinor: number;
  expectedDepositMinor: number;
}

/**
 * The expected figures are what the staff member SAW. They are not a price: the database works the real ones out from the items, the customer's
 * ledger and the owner's policies, and refuses the order if they differ. A form without them is stale or tampered with.
 * Discount fields: discount_mode ("", "fixed", "percent"), discount_amount (QAR) or discount_percent (0.01 to 100), discount_reason.
 * Points: redeem_points, a whole number (blank is none).
 */
export function parsePricing(form: FormData): Parsed<PricingInput> | { ok: false; stale: true } {
  const expectedNet = text(form, "expected_net_minor");
  const expectedDeposit = text(form, "expected_deposit_minor");
  if (!/^[0-9]{1,13}$/.test(expectedNet) || !/^[0-9]{1,13}$/.test(expectedDeposit)) return { ok: false, stale: true };
  const errors: StaffFieldErrors = {};
  let discount: PricingInput["discount"] = null;
  const mode = text(form, "discount_mode");
  if (mode === "fixed" || mode === "percent") {
    const reason = text(form, "discount_reason");
    if (reason.length < 3 || reason.length > 500) errors.discount_reason = "Give the reason for the discount (3 to 500 characters). It is kept with the record of who authorized it.";
    if (mode === "fixed") {
      const amount = parseQarToMinor(text(form, "discount_amount"));
      if (amount === null || amount < 1) errors.discount_amount = "Enter the discount in QAR, like 100 or 100.50.";
      else if (!errors.discount_reason) discount = { mode: "fixed", amount_minor: amount, reason };
    } else {
      const bps = parsePercentToBps(text(form, "discount_percent"));
      if (bps === null || bps < 1) errors.discount_percent = "Enter a percentage from 0.01 to 100, with at most two decimals.";
      else if (!errors.discount_reason) discount = { mode: "percent", percent_bps: bps, reason };
    }
  } else if (mode !== "") {
    errors.discount_mode = "Choose a fixed amount or a percentage.";
  }
  let redeemPoints = 0;
  const pointsText = text(form, "redeem_points");
  if (pointsText !== "") {
    if (!/^[0-9]{1,9}$/.test(pointsText)) errors.redeem_points = "Enter a whole number of points.";
    else redeemPoints = Number(pointsText);
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { discount, redeemPoints, expectedNetMinor: Number(expectedNet), expectedDepositMinor: Number(expectedDeposit) } };
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
  location: string | null;
  /** The time the event happened, as an ISO instant; null means "now" (the database dates it when it is published). */
  occurredAt: string | null;
}

/**
 * A time typed in a `datetime-local` field ("2026-11-22T14:30") is Qatar time (UTC+3, no daylight saving), the time the staff
 * member is looking at. Returns the ISO instant, or null for anything that is not a real date and time (so 30 February is refused,
 * not rolled into March).
 */
export function parseQatarDateTime(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour - 3, minute);
  const check = new Date(utc + 3 * 3600_000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
  return new Date(utc).toISOString();
}

const FUTURE_SLACK_MS = 24 * 3600_000;

function parseTrackingFields(form: FormData, now: Date): Parsed<TrackingInput> {
  const errors: StaffFieldErrors = {};
  const title = text(form, "title");
  if (title.length < 1 || title.length > 120) errors.title = "Write a short title (up to 120 characters).";
  const message = optional(form, "message", 1000, errors, "The message");
  const location = optional(form, "location", 120, errors, "The location");
  let occurredAt: string | null = null;
  const when = text(form, "occurred_at");
  if (when !== "") {
    occurredAt = parseQatarDateTime(when);
    if (occurredAt === null) errors.occurred_at = "Enter a real date and time, or leave it empty to use the time you publish.";
    else if (Date.parse(occurredAt) > now.getTime() + FUTURE_SLACK_MS) errors.occurred_at = "The time of an update cannot be in the future.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { title, message, location, occurredAt } };
}

export function parseTracking(form: FormData, now: Date = new Date()): Parsed<TrackingInput> {
  return parseTrackingFields(form, now);
}

export interface TrackingCorrectionInput extends TrackingInput {
  reason: string;
  /** The update this corrects, when the owner names one. */
  correctsEventId: string | null;
}
export function parseTrackingCorrection(form: FormData, now: Date = new Date()): Parsed<TrackingCorrectionInput> {
  const base = parseTrackingFields(form, now);
  const reason = parseReason(form, "reason");
  const errors: StaffFieldErrors = { ...(base.ok ? {} : base.errors), ...(reason.ok ? {} : reason.errors) };
  const corrects = text(form, "corrects_event_id");
  if (corrects !== "" && !isUuid(corrects)) errors.corrects_event_id = "Choose one of the listed updates, or none.";
  if (Object.keys(errors).length || !base.ok || !reason.ok) return { ok: false, errors };
  return { ok: true, value: { ...base.value, reason: reason.value, correctsEventId: corrects === "" ? null : corrects } };
}

export const FULFILLMENT_TYPES = ["custom_pc_build", "parts_only"] as const;
export function parseFulfillmentType(form: FormData): Parsed<(typeof FULFILLMENT_TYPES)[number]> {
  const value = text(form, "fulfillment_type");
  const found = FULFILLMENT_TYPES.find((type) => type === value);
  return found ? { ok: true, value: found } : { ok: false, errors: { fulfillment_type: "Choose Custom PC build or Parts only." } };
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
  /** The upper limit of every tier except the last (ascending, in minor units, inclusive). */
  upToMinor: number[];
  /** One percentage (basis points) per tier: always one more than upToMinor. */
  percentBps: number[];
  gate: string;
  reason: string;
}

export const MIN_DEPOSIT_TIERS = 1;
export const MAX_DEPOSIT_TIERS = 8;

/**
 * The deposit schedule as tiers by the whole ORIGINAL (gross) order total: up to the first limit, above it up to the next, and so on, and
 * above the last limit. The percentages apply to the entire total. The fields are up_to_N (every tier but the last), percent_N (every
 * tier) and tier_count. The gate status is carried over from the current policy.
 */
export function parseDepositSchedule(form: FormData, gate: string): Parsed<DepositScheduleInput> {
  const errors: StaffFieldErrors = {};
  const countText = text(form, "tier_count");
  const count = /^[0-9]{1,2}$/.test(countText) ? Number(countText) : 0;
  if (count < MIN_DEPOSIT_TIERS || count > MAX_DEPOSIT_TIERS) return { ok: false, errors: { tier_count: `A schedule has from ${MIN_DEPOSIT_TIERS} to ${MAX_DEPOSIT_TIERS} tiers.` } };
  const limits: number[] = [];
  const bps: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const percent = parsePercentToBps(text(form, `percent_${i}`));
    if (percent === null) errors[`percent_${i}`] = "Enter a percentage from 0 to 100, with at most two decimals.";
    else bps.push(percent);
    if (i < count - 1) {
      const limit = parseQarToMinor(text(form, `up_to_${i}`));
      if (limit === null || limit <= 0) errors[`up_to_${i}`] = "Enter this limit in QAR, like 3000.";
      else if (limits.length && limit <= limits[limits.length - 1]) errors[`up_to_${i}`] = "Each limit must be higher than the one before it.";
      else limits.push(limit);
    }
  }
  const reason = parseReason(form);
  if (!reason.ok) errors.reason = reason.errors.reason;
  if (text(form, "confirmed_by_owner") !== "yes") errors.confirmed_by_owner = "Only a schedule the owner has confirmed can be saved here.";
  if (text(form, "typed_confirmation") !== "CHANGE DEPOSIT SCHEDULE") errors.typed_confirmation = "Type CHANGE DEPOSIT SCHEDULE to confirm.";
  if (Object.keys(errors).length || !reason.ok || limits.length !== count - 1 || bps.length !== count) return { ok: false, errors };
  return { ok: true, value: { upToMinor: limits, percentBps: bps, gate, reason: reason.value } };
}

/** The policy value for the tiered schedule, in the shape the database validates. */
export function depositPolicyValue(input: DepositScheduleInput): Record<string, unknown> {
  return {
    mode: "tiered",
    minimum_minor: 0,
    required_before_status: input.gate,
    tiers: input.percentBps.map((percent, index) => (index < input.upToMinor.length ? { up_to_minor: input.upToMinor[index], percent_bps: percent } : { percent_bps: percent })),
  };
}

/** Two ids that must be UUIDs before they go anywhere near a database call. */
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);


// ---------------------------------------------------------------------------------------------------------------
// Private order costs (owner only). The database validates everything again; these checks give clear messages and keep a crafted
// request from reaching it. Amounts are typed in QAR and parsed to integer minor units; a negative or inexact amount is refused.
// ---------------------------------------------------------------------------------------------------------------
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar day written YYYY-MM-DD (so 30 February is refused, not rolled into March). */
export function isRealDay(input: string): boolean {
  const m = ISO_DAY.exec(input);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** One cost entry, reading each field through `name` (so the same rules serve the numbered rows of the order form and the single-entry forms). */
function parseCostFields(form: FormData, name: (field: string) => string, errors: StaffFieldErrors): NewOrderCost | null {
  const before = Object.keys(errors).length;
  const category = text(form, name("category"));
  if (!COST_CATEGORIES.some((c) => c.value === category)) errors[name("category")] = "Choose a category.";
  const description = text(form, name("description"));
  if (description.length < 1 || description.length > 200) errors[name("description")] = "Describe the cost (up to 200 characters).";
  const amountText = text(form, name("amount"));
  let amount: number | null = null;
  if (amountText.startsWith("-")) errors[name("amount")] = "A cost cannot be negative. Enter 0 for an explicit no-cost entry.";
  else {
    amount = parseQarToMinor(amountText);
    if (amount === null) errors[name("amount")] = "Enter an exact amount in QAR, like 1250 or 1,250.50 (0 is allowed).";
  }
  const kind = text(form, name("cost_kind"));
  if (!COST_KINDS.some((k) => k.value === kind)) errors[name("cost_kind")] = "Say whether the amount is estimated or actual.";
  const supplier = optional(form, name("supplier_ref"), 120, errors, "The supplier or reference");
  const notes = optional(form, name("notes"), 1000, errors, "The note");
  const day = text(form, name("incurred_on"));
  if (day !== "" && !isRealDay(day)) errors[name("incurred_on")] = "Enter a real date (YYYY-MM-DD), or leave it empty for today.";
  if (Object.keys(errors).length !== before || amount === null) return null;
  return {
    category: category as NewOrderCost["category"], description, amount_minor: amount, cost_kind: kind as NewOrderCost["cost_kind"],
    supplier_ref: supplier, incurred_on: day === "" ? null : day, notes,
  };
}

/**
 * The optional cost rows of the NEW-ORDER form: cost_category_N, cost_description_N, cost_amount_N, cost_kind_N, cost_supplier_ref_N,
 * cost_incurred_on_N, cost_notes_N. A row with no description and no amount is an unused row and is skipped: costs are never required.
 */
export function parseNewOrderCosts(form: FormData): Parsed<NewOrderCost[]> {
  const errors: StaffFieldErrors = {};
  const costs: NewOrderCost[] = [];
  for (let i = 0; i < MAX_NEW_ORDER_COSTS; i += 1) {
    if (text(form, `cost_description_${i}`) === "" && text(form, `cost_amount_${i}`) === "") continue;
    const entry = parseCostFields(form, (field) => `cost_${field}_${i}`, errors);
    if (entry) costs.push(entry);
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: costs };
}

/** The entry id of a new cost: chosen once by the form (a UUID kept like an idempotency key), so a retry of the same form saves nothing twice. */
export function parseEntryId(form: FormData): string | null {
  const value = form.get("idempotency_key");
  return typeof value === "string" && isUuid(value.trim()) ? value.trim() : null;
}

/** A single cost entry (fields category, description, amount, cost_kind, supplier_ref, incurred_on, notes). */
export function parseCostEntry(form: FormData): Parsed<NewOrderCost> {
  const errors: StaffFieldErrors = {};
  const entry = parseCostFields(form, (field) => field, errors);
  if (!entry || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: entry };
}

/** The version of the entry the screen showed, so the database can refuse an edit made from a stale screen. */
export function parseExpectedVersion(form: FormData): number | null {
  const value = form.get("expected_version");
  if (typeof value !== "string" || !/^[0-9]{1,6}$/.test(value.trim()) || Number(value.trim()) < 1) return null;
  return Number(value.trim());
}

export interface CostEditInput {
  cost: NewOrderCost;
  reason: string;
}
export function parseCostEdit(form: FormData): Parsed<CostEditInput> {
  const entry = parseCostEntry(form);
  const reason = parseReason(form, "reason");
  const errors: StaffFieldErrors = { ...(entry.ok ? {} : entry.errors), ...(reason.ok ? {} : reason.errors) };
  if (Object.keys(errors).length || !entry.ok || !reason.ok) return { ok: false, errors };
  return { ok: true, value: { cost: entry.value, reason: reason.value } };
}

/** The reason, and (for the owner's one-time confirmation of an undated delivery) the date and time, typed in Qatar time. */
export interface CompletionVerificationInput {
  completedAt: string;
  reason: string;
}
export function parseCompletionVerification(form: FormData, now: Date = new Date()): Parsed<CompletionVerificationInput> {
  const errors: StaffFieldErrors = {};
  const completedAt = parseQatarDateTime(text(form, "completed_at"));
  if (completedAt === null) errors.completed_at = "Enter the real date and time the order was delivered (Qatar time).";
  else if (Date.parse(completedAt) > now.getTime()) errors.completed_at = "The completion date cannot be in the future.";
  const reason = parseReason(form, "reason");
  if (!reason.ok) Object.assign(errors, reason.errors);
  if (Object.keys(errors).length || completedAt === null || !reason.ok) return { ok: false, errors };
  return { ok: true, value: { completedAt, reason: reason.value } };
}
