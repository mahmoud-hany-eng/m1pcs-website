import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { staffAdminGate } from "@/lib/staff/flag";
import { getStaffState } from "@/lib/staff/session";

// Never indexed, never cached, and not present at all unless both switches are on (and never on a production deployment).
export const metadata: Metadata = { title: "Staff dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!staffAdminGate(process.env).enabled || !customerAccountsGate(process.env).enabled) notFound();
  // The admin area shows a loading placeholder (loading.tsx) while a page is prepared. Once a placeholder has been sent the
  // response can no longer become a 404, so the question "is this person staff at all?" is answered HERE, before anything is
  // streamed: a person who is not staff gets the site's ordinary 404 for every admin address, exactly as before, and never
  // sees the placeholder. This is the same cached answer the page asks for (one check per request, not two), and it only
  // DECIDES the 404; sign-in, second-step and permission handling stay in requireStaff / requireStaffCandidate on each page.
  const state = await getStaffState();
  if (state.state === "disabled" || state.state === "not_staff") notFound();
  return <>{children}</>;
}
