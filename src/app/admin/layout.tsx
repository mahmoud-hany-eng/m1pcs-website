import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { staffAdminGate } from "@/lib/staff/flag";

// Never indexed, never cached, and not present at all unless both switches are on (and never on a production deployment).
export const metadata: Metadata = { title: "Staff dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  if (!staffAdminGate(process.env).enabled || !customerAccountsGate(process.env).enabled) notFound();
  return <>{children}</>;
}
