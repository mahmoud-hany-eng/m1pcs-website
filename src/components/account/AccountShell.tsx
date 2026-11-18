import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/SectionHeading";
import { signOutAction } from "@/lib/accounts/server/actions";

export type AccountSection = "overview" | "orders" | "payments" | "loyalty" | "profile" | "claim";

const NAV: { key: AccountSection; href: string; label: string }[] = [
  { key: "overview", href: "/account", label: "Overview" },
  { key: "orders", href: "/account/orders", label: "My orders" },
  { key: "payments", href: "/account/payments", label: "Payments" },
  { key: "loyalty", href: "/account/loyalty", label: "Loyalty" },
  { key: "profile", href: "/account/profile", label: "Profile" },
];

/** The frame around every signed-in page: a heading, the section navigation and the sign-out button. */
export function AccountShell({
  active,
  email,
  title,
  description,
  minimal = false,
  children,
}: {
  active: AccountSection;
  email: string | null;
  title: string;
  description?: string;
  /** Hides the section navigation, for a signed-in account that has no customer profile yet. */
  minimal?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="relative">
      <Container className="pb-16 pt-10 sm:pt-14">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3">
            <Eyebrow>My M1 account</Eyebrow>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
            {description ? <p className="max-w-2xl text-sm text-text-secondary sm:text-base">{description}</p> : null}
          </div>
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            {email ? (
              <span className="hidden max-w-[16rem] truncate sm:inline" title={email}>
                {email}
              </span>
            ) : null}
            <form action={signOutAction}>
              <button type="submit" className="btn-sheen btn-glass inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold">
                Sign out
              </button>
            </form>
          </div>
        </div>

        {minimal ? null : (
        <nav aria-label="Account sections" className="scrollbar-hide -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {NAV.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  isActive ? "border-primary/60 bg-primary/15 text-white" : "border-border-strong bg-surface/60 text-text-secondary hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        )}

        <div className="mt-8 flex flex-col gap-6">{children}</div>
      </Container>
    </section>
  );
}

/** The frame for the sign-in, sign-up and email pages. */
export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="relative">
      <Container className="flex justify-center pb-20 pt-12 sm:pt-20">
        <div className="glass glass-strong w-full max-w-md p-6 sm:p-8">
          <div className="mb-6 flex flex-col gap-3">
            <Eyebrow tone="red">M1 account</Eyebrow>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
            {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
          </div>
          <div className="flex flex-col gap-5">{children}</div>
          {footer ? <div className="mt-6 border-t border-border pt-5 text-sm text-text-secondary">{footer}</div> : null}
        </div>
      </Container>
    </section>
  );
}
