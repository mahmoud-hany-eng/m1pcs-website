/**
 * The browser side of idempotency keys: which key a form should carry, and when it must take a new one. Pure functions over
 * a tiny storage interface (sessionStorage in the browser, a stub in tests), so the rules are tested without a framework.
 *
 * Why a key is kept. A staff member who double-clicks, retries after a timeout, or reloads after a lost response must send the
 * SAME key, so the database answers with the record it already made instead of making another. The page chooses the first
 * key on the server; the browser keeps it in sessionStorage (one tab, gone when the tab closes) under a scope such as
 * `payment:<order id>`.
 *
 * Why a key is replaced:
 *   * the action succeeded (the next, different action needs its own key);
 *   * the database refused the key as belonging to a different or finished request (`keyRetired`);
 *   * the page's BINDING changed. For a payment the binding is the amount already paid that the page showed. If the balance
 *     moved (the payment went through and the response was lost, or someone else paid), the page the person is now looking
 *     at is a NEW decision, so it must not reuse the old key and quietly turn a deliberate second payment into a repeat.
 * A key is never replaced just because the person looked at the page again.
 */
import type { StaffFormState } from "./form-state";
import { IDEMPOTENCY_KEY_PATTERN, freshIdempotencyKey } from "./validation";

export interface KeyStore {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
}

const PREFIX = "m1-idem:";

interface Saved {
  key: string;
  binding: string;
}

function readSaved(store: KeyStore, scope: string): Saved | null {
  try {
    const raw = store.getItem(PREFIX + scope);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Saved> | null;
    if (value && typeof value.key === "string" && typeof value.binding === "string" && IDEMPOTENCY_KEY_PATTERN.test(value.key)) {
      return { key: value.key, binding: value.binding };
    }
  } catch {
    /* unreadable or not ours: treated as nothing saved */
  }
  return null;
}

function writeSaved(store: KeyStore, scope: string, saved: Saved): void {
  try {
    store.setItem(PREFIX + scope, JSON.stringify(saved));
  } catch {
    /* storage full or blocked: the page's own key still protects against a double click */
  }
}

/** The key the form should carry now: the one saved for this scope and binding, else the page's own (which is then saved). */
export function chooseKey(store: KeyStore | null, scope: string, binding: string, initial: string): string {
  if (!store) return initial;
  const saved = readSaved(store, scope);
  if (saved && saved.binding === binding) return saved.key;
  writeSaved(store, scope, { key: initial, binding });
  return initial;
}

/** A new key for the next action; it is saved so a reload keeps it. */
export function rotateKey(store: KeyStore | null, scope: string, binding: string, next: string = freshIdempotencyKey()): string {
  if (store) writeSaved(store, scope, { key: next, binding });
  return next;
}

/** True when the key has done its job and the form needs a new one: the action succeeded, or the database retired the key. */
export function keyIsSpent(state: StaffFormState): boolean {
  return state.status === "success" || (state.status === "error" && state.keyRetired === true);
}

/** sessionStorage when the browser allows it (it can be missing or throw in a private window), else null. */
export function browserKeyStore(): KeyStore | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const probe = `${PREFIX}probe`;
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem?.(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}
