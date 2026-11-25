"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { isCurrentLink, linksForPath, type AccountNavLink } from "@/lib/account-nav";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/build-my-pc", label: "Build My PC" },
  { href: "/products", label: "Products" },
  { href: "/completed-builds", label: "Completed Builds" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/contact", label: "Contact" },
];

/**
 * Floating glass header. The header box itself stays exactly 4rem/5rem
 * tall (sticky sections across the site pin at top-16/sm:top-20 against
 * it), with a frosted capsule floating inside it. On the homepage the
 * capsule's glass is clear at the very top so the hero reads edge to edge,
 * and frosts in once the page scrolls — only the glass layer's opacity
 * transitions; its backdrop-filter is never animated.
 */
export function Header({ accountLinks = [] }: { accountLinks?: readonly AccountNavLink[] }) {
  const pathname = usePathname();
  // The account entries for this page (none at all unless the layout was given some: nothing is offered where the routes are switched off).
  const mobileAccountLinks = linksForPath(accountLinks, pathname);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isHomepage = pathname === "/";
  const transparent = isHomepage && !scrolled && !open;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The menu's list is only for widths below 80em. When the window grows past that the links appear in the bar, so an open menu is closed
  // (it would otherwise stay open, invisible, with the page scroll locked).
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 80em)");
    const onChange = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // A press anywhere outside the menu and its button closes it. From 1024px the account button is next to the menu button, so this is what
  // keeps the two lists from being open together (pressing the account button closes this one; pressing this button closes that one).
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (toggleRef.current?.contains(target) || document.getElementById("mobile-menu")?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!isHomepage) return;

    const SCROLL_THRESHOLD = 64;
    let ticking = false;

    function update() {
      setScrolled(window.scrollY > SCROLL_THRESHOLD);
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    update(); // correct state immediately if the page loads already scrolled
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHomepage]);

  return (
    <header className="sticky top-0 z-50 h-16 sm:h-20">
      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="glass-fade fixed inset-0 cursor-default bg-black/60 [@media(min-width:80em)]:hidden"
        />
      )}

      <Container className="relative flex h-full items-center">
        <div className="relative isolate flex h-12 w-full items-center justify-between gap-4 rounded-full pl-3 pr-1.5 sm:h-14 sm:pl-4 sm:pr-2">
          {/* The capsule's glass — a separate layer so it can fade without
              ever animating backdrop-filter. */}
          <div
            aria-hidden="true"
            className={`glass-nav pointer-events-none absolute inset-0 -z-10 rounded-full transition-opacity duration-500 ease-glass ${
              transparent ? "opacity-0" : "opacity-100"
            }`}
          />

          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="M1 Gaming PCs home">
            <Image
              src="/logo.png"
              alt="M1 Gaming PCs logo"
              width={40}
              height={50}
              className="h-8 w-auto sm:h-9"
              priority
            />
            <span className="hidden font-display text-[15px] font-bold tracking-tight text-white xs:inline sm:text-base">
              M1 GAMING PCS
            </span>
          </Link>

          {/* The six links sit in the bar only from 80em (1280px at the browser's default text size). Below that they are in the menu button's list,
              so nothing is ever squeezed: the room they need depends on the font the visitor's system really draws, which cannot be known here
              (a wider fallback font made them wrap to two rows at 1024px). The switch is in em, not px, so a visitor who has chosen larger default
              text gets the menu earlier too. The links never wrap inside themselves and the group never shrinks. */}
          <nav className="hidden shrink-0 items-center gap-8 [@media(min-width:80em)]:flex" aria-label="Primary">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative whitespace-nowrap py-2 text-sm font-medium transition-colors duration-200 hover:text-white ${
                    isActive ? "text-accent" : transparent ? "text-white/85" : "text-text-secondary"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {link.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-0.5 left-1/2 h-[2px] w-4 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_10px_rgb(249_194_4/0.7)]"
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Get a Quote and the account button are in the bar from 1024px. Between 1024px and 80em the links are in the menu, so this group sits
              at the right, next to the menu button (ml-auto); from 80em the links are between the logo and this group. */}
          <div className="hidden shrink-0 items-center gap-2.5 ml-auto [@media(min-width:80em)]:ml-0 lg:flex">
            <Button href="/build-my-pc" variant="secondary" size="sm">
              Get a Quote
            </Button>
            {accountLinks.length > 0 ? <AccountMenu links={accountLinks} /> : null}
          </div>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="btn-glass inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-primary sm:h-11 sm:w-11 [@media(min-width:80em)]:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            <span className="relative block h-3.5 w-[18px]" aria-hidden="true">
              <span
                className={`absolute left-0 top-0 h-0.5 w-[18px] rounded-full bg-current transition-transform duration-300 ${
                  open ? "translate-y-[6px] rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-[6px] h-0.5 w-[18px] rounded-full bg-current transition-opacity duration-200 ${
                  open ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 top-[12px] h-0.5 w-[18px] rounded-full bg-current transition-transform duration-300 ${
                  open ? "-translate-y-[6px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </div>

        {open && (
          <div id="mobile-menu" className="absolute inset-x-4 top-full sm:inset-x-6 lg:inset-x-auto lg:right-8 lg:w-80 [@media(min-width:80em)]:hidden">
            <div className="glass-strong glass-drop max-h-[calc(100dvh-5.5rem)] overflow-y-auto overscroll-contain rounded-glass-lg p-2.5">
              <nav className="flex flex-col" aria-label="Mobile">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center justify-between rounded-2xl px-4 py-3.5 text-[17px] font-medium transition-colors ${
                        isActive
                          ? "bg-white/[0.06] text-accent"
                          : "text-text-primary/90 hover:bg-white/[0.05] hover:text-white"
                      }`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {link.label}
                      <span
                        aria-hidden="true"
                        className={isActive ? "h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgb(249_194_4/0.8)]" : "text-text-muted"}
                      >
                        {isActive ? null : "→"}
                      </span>
                    </Link>
                  );
                })}
              </nav>
              {mobileAccountLinks.length > 0 && (
                <nav className="mt-1.5 border-t border-white/10 pt-1 lg:hidden" aria-label="Account" data-testid="mobile-account-links">
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Account</p>
                  {mobileAccountLinks.map((link) => {
                    const current = isCurrentLink(link, pathname);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className={`flex items-center justify-between rounded-2xl px-4 py-3 text-base font-medium transition-colors ${
                          current ? "bg-white/[0.06] text-accent" : "text-text-primary/90 hover:bg-white/[0.05] hover:text-white"
                        }`}
                        aria-current={current ? "page" : undefined}
                      >
                        {link.label}
                        <span aria-hidden="true" className={current ? "h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgb(249_194_4/0.8)]" : "text-text-muted"}>
                          {current ? null : "→"}
                        </span>
                      </Link>
                    );
                  })}
                </nav>
              )}
              {/* From 1024px Get a Quote and the account button are already in the bar, so the menu does not repeat them. */}
              <div className="mt-2 p-1.5 lg:hidden">
                <Button href="/build-my-pc" variant="secondary" size="lg" className="w-full">
                  Get a Quote
                </Button>
              </div>
            </div>
          </div>
        )}
      </Container>
    </header>
  );
}
