import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PreviewBanner } from "@/components/account/ui";
import { assertAccountsEnabled } from "@/lib/accounts/server/guard";

// Never indexed, never statically built, and absent altogether (the site's ordinary 404) while the flag is off.
export const metadata: Metadata = { title: "My account", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AccountLayout({ children }: { children: ReactNode }) {
  // This is the first gate. It is not the only one: every page also verifies the session itself, because a layout is
  // not re-run on every client-side navigation.
  assertAccountsEnabled();
  return (
    <>
      <PreviewBanner label={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null} />
      {children}
    </>
  );
}
