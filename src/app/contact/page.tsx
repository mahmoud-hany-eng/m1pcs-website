import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { ComplaintForm } from "@/components/forms/ComplaintForm";
import { siteConfig } from "@/lib/site-config";
import { buildGeneralContactMessage, buildWhatsAppLink } from "@/lib/whatsapp";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact M1 Gaming PCs in Qatar via WhatsApp, Instagram or email, or view official business information.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  const whatsappHref = buildWhatsAppLink(buildGeneralContactMessage());

  return (
    <>
      <section className="relative">
        <Container className="pb-4 pt-16 sm:pb-6 sm:pt-24">
          <SectionHeading
            eyebrow="Contact"
            title="Get in touch"
            description="The fastest way to reach us is WhatsApp or Instagram. For formal enquiries and complaints, use email."
          />
        </Container>
      </section>

      <section className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-10 h-[520px] w-[min(1000px,140%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.12),transparent)]"
        />
        <Container className="relative py-12 sm:py-16">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
            {whatsappHref && (
              <div className="glass flex flex-col gap-4 p-6">
                <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white"><ChannelIcon name="whatsapp" />WhatsApp</h2>
                <p className="text-sm text-text-secondary">
                  {siteConfig.contact.whatsappDisplay}
                </p>
                <Button
                  href={whatsappHref}
                  external
                  variant="whatsapp"
                  size="lg"
                  className="mt-auto w-full"
                >
                  Chat on WhatsApp
                </Button>
              </div>
            )}

            <div className="glass flex flex-col gap-4 p-6">
              <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white"><ChannelIcon name="instagram" />Instagram</h2>
              <p className="text-sm text-text-secondary">
                {siteConfig.social.instagram.handle} — DMs open
              </p>
              <Button
                href={siteConfig.social.instagram.url}
                external
                variant="secondary"
                size="lg"
                className="mt-auto w-full"
              >
                Message on Instagram
              </Button>
            </div>

            {siteConfig.contact.email && (
              <div className="glass flex flex-col gap-4 p-6">
                <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white"><ChannelIcon name="email" />Email</h2>
                <p className="text-sm text-text-secondary">
                  {siteConfig.contact.email}
                </p>
                <Button
                  href={`mailto:${siteConfig.contact.email}`}
                  variant="glass"
                  size="lg"
                  className="mt-auto w-full"
                >
                  Send an Email
                </Button>
              </div>
            )}

            {siteConfig.contact.phoneDisplay && (
              <div className="glass flex flex-col gap-4 p-6">
                <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white">
                  <ChannelIcon name="phone" />
                  Customer Service
                </h2>
                <p className="text-sm text-text-secondary">
                  {siteConfig.contact.phoneDisplay}
                </p>
                <Button
                  href={`tel:${siteConfig.contact.phoneDisplay.replace(/[^\d+]/g, "")}`}
                  variant="glass"
                  size="lg"
                  className="mt-auto w-full"
                >
                  Call Us
                </Button>
              </div>
            )}
          </div>

          <div className="glass-subtle mx-auto mt-5 flex max-w-5xl flex-col gap-3 rounded-glass px-5 py-4 text-sm text-text-secondary md:flex-row md:items-center md:gap-6 md:px-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:shrink-0">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_10px_rgb(249_194_4/0.8)]" />
              <span className="whitespace-nowrap font-medium text-white">Customer service hours:</span>
              <span className="whitespace-nowrap">{siteConfig.contact.serviceHours}</span>
            </div>

            {siteConfig.operations.homeDeliveryAvailable && (
              <p className="md:border-l md:border-white/[0.08] md:pl-6">
                Home delivery is available across Qatar. {siteConfig.operations.deliveryNote}
              </p>
            )}
          </div>
        </Container>
      </section>

      {/* Official business information */}
      <section className="relative">
        <Container className="py-12 sm:py-20">
          <SectionHeading
            align="left"
            eyebrow="Business Information"
            title="Official business details"
          />
          <dl className="glass-subtle mt-8 grid max-w-3xl grid-cols-1 gap-6 rounded-glass-lg p-6 sm:grid-cols-2 sm:p-8">
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Registered name
              </dt>
              <dd className="mt-1 text-white">
                {siteConfig.legal.registeredName}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Commercial Registration
              </dt>
              <dd className="mt-1 text-white">
                {siteConfig.legal.commercialRegistration}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Country
              </dt>
              <dd className="mt-1 text-white">{siteConfig.legal.country}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Instagram
              </dt>
              <dd className="mt-1 text-white">
                {siteConfig.social.instagram.handle}
              </dd>
            </div>
            {siteConfig.legal.ecommerceLicenceNumber && (
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  E-Commerce Licence No.
                </dt>
                <dd className="mt-1 text-white">
                  {siteConfig.legal.ecommerceLicenceNumber}
                </dd>
              </div>
            )}
          </dl>
        </Container>
      </section>

      {/* Complaints — only shown once a customer service email is configured,
          since the form hands off to a mailto: link. */}
      {siteConfig.contact.email && (
        <section id="complaints" className="relative scroll-mt-24">
          <Container className="pb-16 pt-8 sm:pb-24 sm:pt-12">
            <SectionHeading
              align="left"
              eyebrow="Complaints"
              title="Submit a complaint"
              description="For Version 1, complaints are sent directly to our customer service email — nothing is stored on this website."
            />
            <div className="glass mt-10 max-w-2xl rounded-glass-lg p-6 sm:p-8">
              <ComplaintForm />
            </div>
          </Container>
        </section>
      )}
    </>
  );
}

/** Line icons for the four contact channels, in a lit glass chip. */
function ChannelIcon({ name }: { name: "whatsapp" | "instagram" | "email" | "phone" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgb(249_194_4/0.3)]"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]">
        {name === "whatsapp" && (
          <>
            <path {...common} d="M4 20l1.3-3.9A8 8 0 1 1 8 19l-4 1z" />
            <path {...common} d="M9.2 9.3c.3 2.3 2.3 4.4 4.9 5l1.3-1.3 1.8.9" />
          </>
        )}
        {name === "instagram" && (
          <>
            <rect {...common} x="4" y="4" width="16" height="16" rx="4.5" />
            <circle {...common} cx="12" cy="12" r="3.6" />
            <circle cx="16.7" cy="7.3" r="1" fill="currentColor" />
          </>
        )}
        {name === "email" && (
          <>
            <rect {...common} x="3.5" y="5.5" width="17" height="13" rx="2.5" />
            <path {...common} d="M4.5 7l7.5 6 7.5-6" />
          </>
        )}
        {name === "phone" && (
          <path
            {...common}
            d="M6.6 4.5h2.6l1.3 3.6-1.8 1.2a10 10 0 0 0 5.9 5.9l1.2-1.8 3.6 1.3v2.6a1.8 1.8 0 0 1-1.9 1.8A15.5 15.5 0 0 1 4.8 6.4 1.8 1.8 0 0 1 6.6 4.5z"
          />
        )}
      </svg>
    </span>
  );
}
