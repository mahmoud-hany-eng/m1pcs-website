/** Display helpers for the admin screens. Pure functions: they format text the database already decided. */

export type Tone = "progress" | "done" | "paused" | "cancelled" | "neutral";

/** Status codes are fixed by the database (public.order_statuses); this only picks a colour. */
export function statusTone(code: string): Tone {
  if (code === "delivered") return "done";
  if (code === "on_hold") return "paused";
  if (code === "cancelled") return "cancelled";
  if (code === "pending_confirmation") return "neutral";
  return "progress";
}

const PAYMENT_METHOD: Record<string, string> = { cash: "Cash", fawran: "Fawran", bank_transfer: "Bank transfer", card: "Card", other: "Other" };
export const methodLabel = (method: string): string => PAYMENT_METHOD[method] ?? method;

const PURPOSE: Record<string, string> = { deposit: "Deposit", balance: "Balance", other: "Other" };
export const purposeLabel = (purpose: string): string => PURPOSE[purpose] ?? purpose;

const ENTRY: Record<string, string> = { payment: "Payment", reversal: "Reversal", refund: "Refund" };
export const entryLabel = (entry: string): string => ENTRY[entry] ?? entry;

const SOURCE: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", walk_in: "Walk-in", other: "Other", account: "Website account" };
export const sourceLabel = (source: string): string => SOURCE[source] ?? source;

/** 1500 -> "15%", 1250 -> "12.5%", 1005 -> "10.05%". */
export function percentLabel(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isInteger(bps)) return "—";
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/** A timestamp in Qatar time: "19 Nov 2026, 14:05". An unreadable value is shown as a dash, never as "Invalid Date". */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Qatar" }).format(date);
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Qatar" }).format(date);
}

/** Staff may read a customer's phone number, but a list shows only what is needed to tell two people apart. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** An amount for a form field: 125050 -> "1250.50" (no currency word, no thousands separators). */
export function plainAmount(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0) return "";
  const whole = Math.floor(minor / 100);
  return `${whole}.${String(minor % 100).padStart(2, "0")}`;
}

/** "12 minutes ago", "3 hours ago": how long before `now` something happened. An unreadable timestamp says "recently". */
export function ageText(createdAt: string, now: Date = new Date()): string {
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return "recently";
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
