import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { siteConfig } from "@/lib/site-config";

const exploreLinks = [
  { href: "/build-my-pc", label: "Build My PC" },
  { href: "/products", label: "Products" },
  { href: "/completed-builds", label: "Completed Builds" },
  { href: "/how-it-works", label: "How It Works" },
];

const supportLinks = [
  { href: "/contact", label: "Contact" },
  { href: "/policies", label: "Policies" },
  { href: "/contact#complaints", label: "Complaints" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <Container className="py-12 sm:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2 w-fit">
              <Image
                src="/logo.png"
                alt="M1 Gaming PCs logo"
                width={36}
                height={45}
                className="h-9 w-auto"
              />
              <span className="font-display text-base font-bold">M1 GAMING PCS</span>
            </Link>
            <p className="text-sm text-text-secondary max-w-xs">
              Custom gaming PCs and computer components in Qatar, configured
              around your budget and performance goals.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Explore
            </h3>
            <ul className="flex flex-col gap-2">
              {exploreLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-text-secondary hover:text-accent transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Support
            </h3>
            <ul className="flex flex-col gap-2">
              {supportLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-text-secondary hover:text-accent transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Contact
            </h3>
            <ul className="flex flex-col gap-2 text-sm text-text-secondary">
              <li>
                <a
                  href={siteConfig.social.instagram.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  Instagram: {siteConfig.social.instagram.handle}
                </a>
              </li>
              {siteConfig.contact.whatsappDisplay && (
                <li>WhatsApp: {siteConfig.contact.whatsappDisplay}</li>
              )}
              {siteConfig.contact.email && (
                <li>
                  <a
                    href={`mailto:${siteConfig.contact.email}`}
                    className="hover:text-accent transition-colors"
                  >
                    {siteConfig.contact.email}
                  </a>
                </li>
              )}
              {siteConfig.contact.phoneDisplay && (
                <li>{siteConfig.contact.phoneDisplay}</li>
              )}
              <li className="text-text-muted">
                Service hours: {siteConfig.contact.serviceHours}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <div className="flex flex-col gap-2 text-xs text-text-muted">
            <p className="font-medium text-text-secondary">
              {siteConfig.legal.registeredName}
            </p>
            <p>Commercial Registration: {siteConfig.legal.commercialRegistration}</p>
            <p>{siteConfig.legal.country}</p>
            {siteConfig.legal.ecommerceLicenceNumber && (
              <p>
                E-Commerce Licence No.: {siteConfig.legal.ecommerceLicenceNumber}
              </p>
            )}
            <p className="mt-4">
              &copy; {year} {siteConfig.legal.registeredName}. All rights
              reserved. &ldquo;M1 Gaming PCs&rdquo; is a trading name used by{" "}
              {siteConfig.legal.registeredName}.
            </p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
