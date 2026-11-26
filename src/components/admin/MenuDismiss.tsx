"use client";

/** Adds "press outside" and Escape to the page's <details data-menu> dropdowns (the logic and its tests are in lib/menu-dismiss.ts). Renders nothing. */
import { useEffect } from "react";
import { attachMenuDismiss } from "@/lib/menu-dismiss";

export function MenuDismiss() {
  useEffect(() => attachMenuDismiss(document), []);
  return null;
}
