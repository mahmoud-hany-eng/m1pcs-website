"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isCurrentLink, linksForPath, type AccountNavLink } from "@/lib/account-nav";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * The account button and its menu, in the public header (desktop). It is a disclosure, not an application menu: the button says whether the
 * list is open (aria-expanded) and which element it opens (aria-controls); the list is ordinary links in a labelled navigation region, so
 * every link is reached with Tab and activated like any other. Extras that make it comfortable by keyboard: ArrowDown on the button
 * opens it and lands on the first link, Up and Down / Home and End move between the links, Escape closes it and returns focus to the button,
 * and tabbing out of it closes it.
 *
 * Closes on: a click or tap anywhere else, Escape, focus leaving it, activating a link, and any change of page. Opening and closing are a short
 * fade and a few pixels of slide (CSS, `.account-menu` in globals.css); with the visitor's reduced-motion setting it appears and disappears at
 * once. The menu is only in the page while it is open or closing, so a closed menu puts no extra links in the document.
 *
 * The links are given by the layout and already respect the feature switches (none on a production deployment). Nothing here decides who may
 * go where: every address still passes its own sign-in and second-step checks.
 */
export function AccountMenu({ links }: { links: readonly AccountNavLink[] }) {
  const pathname = usePathname();
  const reduceMotion = usePrefersReducedMotion();
  const [state, setState] = useState<"closed" | "open" | "closing">("closed");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const focusFirst = useRef(false);
  const panelId = useId();
  const visible = linksForPath(links, pathname);
  const customer = visible.filter((l) => l.group === "customer");
  const staff = visible.filter((l) => l.group === "staff");
  const mounted = state !== "closed";

  const close = useCallback(
    (restoreFocus: boolean) => {
      window.clearTimeout(timer.current);
      if (reduceMotion) setState("closed");
      else {
        setState((current) => (current === "open" ? "closing" : current));
        timer.current = window.setTimeout(() => setState("closed"), 130);
      }
      if (restoreFocus) buttonRef.current?.focus();
    },
    [reduceMotion],
  );

  const open = useCallback(() => {
    window.clearTimeout(timer.current);
    setState("open");
  }, []);

  // A new page closes the menu at once (no animation: the page it was opened over is gone).
  useEffect(() => {
    window.clearTimeout(timer.current);
    setState("closed");
  }, [pathname]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // While the menu is in the page: click or tap outside closes it, Escape closes it (focus back on the button), and focus leaving it closes it.
  useEffect(() => {
    if (state !== "open") return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [state, close]);

  // ArrowDown on the closed button opens the menu and puts focus on its first link.
  useEffect(() => {
    if (state === "open" && focusFirst.current) {
      focusFirst.current = false;
      rootRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    }
  }, [state]);

  if (visible.length === 0) return null;

  const onButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" && state !== "open") {
      event.preventDefault();
      focusFirst.current = true;
      open();
    }
  };
  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const anchors = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
    const index = anchors.indexOf(document.activeElement as HTMLAnchorElement);
    const move = (to: number) => {
      event.preventDefault();
      anchors[(to + anchors.length) % anchors.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(anchors.length - 1);
  };

  const item = (link: AccountNavLink) => {
    const current = isCurrentLink(link, pathname);
    return (
      <li key={link.href}>
        <Link
          href={link.href}
          onClick={() => close(false)}
          aria-current={current ? "page" : undefined}
          className={`flex items-center justify-between rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
            current ? "bg-white/[0.06] text-accent" : "text-text-primary/90 hover:bg-white/[0.06] hover:text-white"
          }`}
        >
          {link.label}
          {current ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgb(249_194_4/0.8)]" /> : null}
        </Link>
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative" data-testid="account-menu-root">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (state === "open" ? close(false) : open())}
        onKeyDown={onButtonKeyDown}
        className="btn-glass inline-flex h-10 w-10 items-center justify-center rounded-full text-text-primary transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label="Account menu"
        aria-expanded={state === "open"}
        aria-controls={mounted ? panelId : undefined}
        data-testid="account-menu-button"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="8.25" r="3.75" />
          <path d="M4.75 20c.6-3.6 3.5-5.5 7.25-5.5s6.65 1.9 7.25 5.5" />
        </svg>
      </button>

      {mounted ? (
        <div id={panelId} data-state={state} data-testid="account-menu" className="account-menu absolute right-0 top-full z-[60] mt-3 w-60" onKeyDown={onPanelKeyDown}>
          <div className="glass-strong rounded-glass-lg p-1.5">
            <nav aria-label="Account">
              {customer.length > 0 ? <ul className="flex flex-col">{customer.map(item)}</ul> : null}
              {staff.length > 0 ? (
                <ul className={`flex flex-col ${customer.length > 0 ? "mt-1.5 border-t border-white/10 pt-1.5" : ""}`}>{staff.map(item)}</ul>
              ) : null}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
