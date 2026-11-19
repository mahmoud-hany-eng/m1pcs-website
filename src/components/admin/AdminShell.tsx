import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/lib/accounts/server/actions";

export type AdminSection = "overview" | "customers" | "orders" | "payments" | "loyalty" | "policies" | "audit";

interface NavItem {
  key: AdminSection;
  href: string;
  label: string;
  permission: string | null;
  icon: string;
}

const NAV: NavItem[] = [
  { key: "overview", href: "/admin", label: "Overview", permission: null, icon: "M3 12 12 4l9 8M5 10v10h5v-6h4v6h5V10" },
  { key: "customers", href: "/admin/customers", label: "Customers", permission: "customers.read", icon: "M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1a3 3 0 0 0-2.5-3M15.5 4.3a3 3 0 0 1 0 5.4" },
  { key: "orders", href: "/admin/orders", label: "Orders", permission: "orders.read", icon: "M6 3h12l2 4H4l2-4ZM4 7v13h16V7M9 12h6" },
  { key: "payments", href: "/admin/payments", label: "Payments", permission: "payments.read", icon: "M3 7h18v10H3V7ZM3 11h18M7 15h3" },
  { key: "loyalty", href: "/admin/loyalty", label: "Loyalty", permission: "loyalty.read", icon: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" },
  { key: "policies", href: "/admin/policies", label: "Policies", permission: "policies.read", icon: "M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4" },
  { key: "audit", href: "/admin/audit", label: "Audit log", permission: "audit.read", icon: "M7 3h8l4 4v14H7V3Zm8 0v4h4M10 12h6M10 16h6" },
];

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/**
 * The frame around every admin page. On a desktop it is a fixed side navigation and a wide work area; on a phone it is
 * a compact top bar with a scrolling row of sections. The public site's header, footer and chat button are hidden here
 * with a rule that exists only while an admin page is on screen (it is part of this page, so it goes when the page does).
 */
export function AdminShell({
  active,
  email,
  can,
  title,
  description,
  actions,
  previewLabel,
  children,
}: {
  active: AdminSection;
  email: string | null;
  can: (permission: string) => boolean;
  title: string;
  description?: string;
  actions?: ReactNode;
  previewLabel?: string | null;
  children: ReactNode;
}) {
  const items = NAV.filter((item) => item.permission === null || can(item.permission));
  return (
    <div className="admin-root fixed inset-0 z-[60] overflow-y-auto bg-background text-text-primary">
      <style>{`body > header, body > footer, body > a[aria-label="Chat with M1 on WhatsApp"] { display: none !important; }`}</style>
      <div className="mx-auto flex min-h-full w-full max-w-[96rem] flex-col lg:flex-row">
        <aside className="lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-r lg:border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 lg:flex-col lg:items-stretch lg:gap-6 lg:border-b-0 lg:px-5 lg:py-6">
            <Link href="/admin" className="flex items-center gap-2.5" aria-label="M1 staff dashboard">
              <span aria-hidden="true" className="btn-red flex h-9 w-9 items-center justify-center rounded-xl font-display text-sm font-bold text-white">
                M1
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-display text-sm font-bold tracking-tight text-white">M1 Staff</span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Dashboard</span>
              </span>
            </Link>
            <div className="flex items-center gap-2 lg:hidden">
              <form action={signOutAction}>
                <button type="submit" className="btn-sheen btn-glass inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold">
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <nav aria-label="Admin sections" className="scrollbar-hide flex gap-1.5 overflow-x-auto px-4 py-3 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-3 lg:py-2">
            {items.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-full px-4 py-2 text-sm font-medium transition-colors lg:rounded-xl lg:px-3.5 lg:py-2.5 ${
                    isActive
                      ? "border border-primary/50 bg-primary/15 text-white lg:border-transparent lg:bg-white/[0.07] lg:shadow-[inset_2px_0_0_rgb(var(--color-primary))]"
                      : "border border-border-strong bg-surface/60 text-text-secondary hover:text-white lg:border-transparent lg:bg-transparent lg:hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon path={item.icon} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto hidden flex-col gap-3 border-t border-border px-5 py-5 lg:absolute lg:bottom-0 lg:left-0 lg:flex lg:w-64">
            {email ? (
              <p className="truncate text-xs text-text-muted" title={email}>
                Signed in as <span className="text-text-secondary">{email}</span>
              </p>
            ) : null}
            <form action={signOutAction}>
              <button type="submit" className="btn-sheen btn-glass inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {previewLabel ? (
            <div role="note" className="border-b border-warning/50 bg-warning/15 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-warning">
              {previewLabel}
            </div>
          ) : null}
          <main className="px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-10">
            <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
                {description ? <p className="max-w-2xl text-sm text-text-secondary">{description}</p> : null}
              </div>
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </header>
            <div className="flex flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
