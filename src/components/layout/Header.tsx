"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

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
export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isHomepage = pathname === "/";
  const transparent = isHomepage && !scrolled && !open;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
          className="glass-fade fixed inset-0 cursor-default bg-black/60 lg:hidden"
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

          <nav className="hidden items-center gap-6 lg:flex xl:gap-8" aria-label="Primary">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative py-2 text-sm font-medium transition-colors duration-200 hover:text-white ${
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

          <div className="hidden lg:block">
            <Button href="/build-my-pc" variant="secondary" size="sm">
              Get a Quote
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="btn-glass inline-flex h-10 w-10 items-center justify-center rounded-full text-text-primary sm:h-11 sm:w-11 lg:hidden"
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
          <div id="mobile-menu" className="absolute inset-x-4 top-full sm:inset-x-6 lg:hidden">
            <div className="glass-strong glass-drop rounded-glass-lg p-2.5">
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
              <div className="mt-2 p-1.5">
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
