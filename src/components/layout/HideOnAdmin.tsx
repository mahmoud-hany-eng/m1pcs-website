"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Leaves out what the staff dashboard does not need: the public footer and the WhatsApp button. The public HEADER is never hidden (the dashboard sits
 * under it). The pages' own markup is not touched: this only decides, from the address being shown, whether its children are drawn at all, so
 * there is no global style rule that hides elements of the page and nothing that can be left behind when the admin area is closed.
 */
export function HideOnAdmin({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  return <>{children}</>;
}
