"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe reduced-motion flag: `false` on the server and on the client's
 * first render (so hydration always matches), corrected right after mount.
 * Framer Motion's own useReducedMotion() reads matchMedia synchronously on
 * the first client render, which produces a real hydration mismatch for
 * visitors who have reduced motion enabled.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduce;
}
