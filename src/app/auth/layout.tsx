import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PreviewBanner } from "@/components/account/ui";
import { assertAccountsEnabled } from "@/lib/accounts/server/guard";

// Never indexed, never cached, and never present at all while the feature flag is off.
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  assertAccountsEnabled();
  return (
    <>
      <PreviewBanner label={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null} />
      {children}
    </>
  );
}
