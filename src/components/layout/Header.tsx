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

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Container>
        <div className="flex h-16 sm:h-20 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="M1 Gaming PCs home">
            <Image
              src="/logo.png"
              alt="M1 Gaming PCs logo"
              width={40}
              height={50}
              className="h-10 w-auto"
              priority
            />
            <span className="font-display text-lg font-bold tracking-tight hidden xs:inline">
              M1 GAMING PCS
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-8" aria-label="Primary">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-medium transition-colors hover:text-accent ${
                    isActive ? "text-accent" : "text-text-secondary"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden lg:block">
            <Button href="/build-my-pc" variant="secondary" size="md">
              Get a Quote
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border-strong text-text-primary"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            <span className="relative block h-4 w-5" aria-hidden="true">
              <span
                className={`absolute left-0 top-0 h-0.5 w-5 bg-current transition-transform ${
                  open ? "translate-y-[7px] rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-[7px] h-0.5 w-5 bg-current transition-opacity ${
                  open ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 top-[14px] h-0.5 w-5 bg-current transition-transform ${
                  open ? "-translate-y-[7px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </div>
      </Container>

      {open && (
        <div id="mobile-menu" className="lg:hidden border-t border-border bg-background">
          <Container className="py-4">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-lg px-3 py-3 text-base font-medium transition-colors ${
                      isActive
                        ? "bg-surface text-accent"
                        : "text-text-secondary hover:bg-surface hover:text-text-primary"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-4">
              <Button href="/build-my-pc" variant="secondary" size="lg" className="w-full">
                Get a Quote
              </Button>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
