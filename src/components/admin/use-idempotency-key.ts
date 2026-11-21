"use client";

/**
 * The idempotency key of ONE intended action (this payment, this order). The server page chooses the first key, so the form
 * is complete even before the browser script runs. The rules for keeping and replacing it live in
 * src/lib/staff/idempotency-client.ts and are tested there; this hook only connects them to React.
 */
import { useEffect, useRef, useState } from "react";
import type { StaffFormState } from "@/lib/staff/form-state";
import { browserKeyStore, chooseKey, keyIsSpent, rotateKey, type KeyStore } from "@/lib/staff/idempotency-client";

export function useIdempotencyKey(scope: string, initial: string, binding: string, state: StaffFormState, store?: KeyStore | null): string {
  const [key, setKey] = useState(initial);
  const handled = useRef<StaffFormState | null>(null);
  const storeOf = () => (store === undefined ? browserKeyStore() : store);

  useEffect(() => {
    setKey(chooseKey(storeOf(), scope, binding, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, binding, initial, store]);

  useEffect(() => {
    if (state === handled.current || !keyIsSpent(state)) return;
    handled.current = state;
    setKey(rotateKey(storeOf(), scope, binding));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, scope, binding, store]);

  return key;
}
