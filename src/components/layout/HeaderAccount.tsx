"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { HEADER_IDENTITY_PATH, parseHeaderIdentity, type AccountNavLink, type HeaderDashboardHref } from "@/lib/account-nav";

/**
 * The account control in the public header: signed out, the person icon opens a small menu (Log in, Create account); signed in, the person's
 * name and icon are ONE link straight to their dashboard (no second step, no menu).
 *
 * The public pages are built once and cached, so they cannot say who is signed in. This control starts neutral (the signed-out icon, the same on
 * the server and in the browser, so nothing can be cached or mismatch) and then asks the uncached route /auth/header-identity who is signed in. It asks
 * again whenever the answer could have changed: a new page (sign-in, sign-out and sign-up all end in one), the tab becoming visible or focused
 * again (a session that expired while the tab was away), and a page restored from the browser's history. Only a label and one of three fixed
 * addresses come back; anything else is refused and the signed-out icon stays.
 *
 * Nothing here decides who may go where: the dashboard the link opens checks the sign-in, the staff table and the second step itself.
 */
type View = { kind: "loading" } | { kind: "out" } | { kind: "in"; label: string; href: HeaderDashboardHref; who: "staff" | "customer" | "unknown" };

const MIN_GAP_MS = 800;

function useHeaderIdentity(): View {
  const pathname = usePathname();
  const [view, setView] = useState<View>({ kind: "loading" });
  const latest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lastAt = useRef(0);

  const refresh = useCallback(async () => {
    lastAt.current = Date.now();
    controller.current?.abort();
    const mine = ++latest.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch(HEADER_IDENTITY_PATH, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: abort.signal });
      if (mine !== latest.current) return;
      // The route is absent (404) where accounts are switched off: nobody can be signed in there.
      const parsed = response.ok ? parseHeaderIdentity(await response.json()) : null;
      if (mine !== latest.current) return;
      if (parsed?.state === "signed_in") setView({ kind: "in", label: parsed.label, href: parsed.href, who: parsed.kind });
      else if (parsed?.state === "signed_out" || response.status === 404) setView({ kind: "out" });
      // Anything else (the service could not be reached, an unreadable answer): keep what is shown; at the very start that is the signed-out icon.
      else setView((current) => (current.kind === "loading" ? { kind: "out" } : current));
    } catch {
      if (mine === latest.current) setView((current) => (current.kind === "loading" ? { kind: "out" } : current));
    }
  }, []);

  // A new page: ask again (signing in and out both end in a new page).
  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  // The tab came back, or the page was restored from the history: the session may have ended or changed meanwhile.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastAt.current < MIN_GAP_MS) return;
      void refresh();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void refresh();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    window.addEventListener("pageshow", restored);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
      window.removeEventListener("pageshow", restored);
      controller.current?.abort();
    };
  }, [refresh]);

  return view;
}

const PERSON_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="8.25" r="3.75" />
    <path d="M4.75 20c.6-3.6 3.5-5.5 7.25-5.5s6.65 1.9 7.25 5.5" />
  </svg>
);

/**
 * The signed-in control: the person icon and the name as ONE link to the dashboard. It is its own component (and has no state) so the exact markup
 * the header draws can also be rendered on its own, for example by the layout tests.
 */
export function HeaderIdentityLink({ label, href, who }: { label: string; href: HeaderDashboardHref; who: "staff" | "customer" | "unknown" }) {
  return (
    <div data-testid="header-account" data-account-state="signed_in" data-account-kind={who} className="flex min-w-0 shrink items-center">
      {/* prefetch off: a prefetch would load the dashboard (and, for staff, ask the staff database) on every public page. */}
      <Link
        href={href}
        prefetch={false}
        title={label}
        aria-label={`${label}: open your dashboard`}
        data-testid="account-identity"
        className="btn-glass inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full px-2.5 text-text-primary transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 sm:pl-3 sm:pr-3.5"
      >
        {PERSON_ICON}
        <span
          data-testid="account-identity-name"
          className="hidden min-w-0 max-w-[9rem] truncate text-sm font-medium sm:inline [@media(min-width:80em)]:max-w-[6rem]"
        >
          {label}
        </span>
      </Link>
    </div>
  );
}

export function HeaderAccount({ links }: { links: readonly AccountNavLink[] }) {
  const view = useHeaderIdentity();

  if (view.kind === "in") return <HeaderIdentityLink label={view.label} href={view.href} who={view.who} />;

  // Loading and signed out show the same thing: the person icon and the Log in / Create account menu.
  return (
    <div data-testid="header-account" data-account-state={view.kind === "loading" ? "loading" : "signed_out"} className="flex shrink-0 items-center">
      <AccountMenu links={links} />
    </div>
  );
}
