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
      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="Contact"
            title="Get in touch"
            description="The fastest way to reach us is WhatsApp or Instagram. For formal enquiries and complaints, use email."
          />
        </Container>
      </section>

      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {whatsappHref && (
              <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6">
                <h2 className="font-display text-lg font-semibold">WhatsApp</h2>
                <p className="text-sm text-text-secondary">
                  {siteConfig.contact.whatsappDisplay}
                </p>
                <Button
                  href={whatsappHref}
                  external
                  variant="whatsapp"
                  size="lg"
                  className="w-full"
                >
                  Chat on WhatsApp
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6">
              <h2 className="font-display text-lg font-semibold">Instagram</h2>
              <p className="text-sm text-text-secondary">
                {siteConfig.social.instagram.handle} — DMs open
              </p>
              <Button
                href={siteConfig.social.instagram.url}
                external
                variant="secondary"
                size="lg"
                className="w-full"
              >
                Message on Instagram
              </Button>
            </div>

            {siteConfig.contact.email && (
              <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6">
                <h2 className="font-display text-lg font-semibold">Email</h2>
                <p className="text-sm text-text-secondary">
                  {siteConfig.contact.email}
                </p>
                <Button
                  href={`mailto:${siteConfig.contact.email}`}
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  Send an Email
                </Button>
              </div>
            )}

            {siteConfig.contact.phoneDisplay && (
              <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6">
                <h2 className="font-display text-lg font-semibold">
                  Customer Service
                </h2>
                <p className="text-sm text-text-secondary">
                  {siteConfig.contact.phoneDisplay}
                </p>
                <Button
                  href={`tel:${siteConfig.contact.phoneDisplay.replace(/[^\d+]/g, "")}`}
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  Call Us
                </Button>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-2 text-sm text-text-secondary sm:flex-row sm:items-center sm:gap-4">
            <span className="font-medium text-text-primary">
              Customer service hours:
            </span>
            <span>{siteConfig.contact.serviceHours}</span>
          </div>

          {siteConfig.operations.homeDeliveryAvailable && (
            <p className="mt-3 text-sm text-text-secondary">
              Home delivery is available across Qatar. {siteConfig.operations.deliveryNote}
            </p>
          )}
        </Container>
      </section>

      {/* Official business information */}
      <section className="border-b border-border bg-surface">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            align="left"
            eyebrow="Business Information"
            title="Official business details"
          />
          <dl className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-2xl">
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Registered name
              </dt>
              <dd className="mt-1 text-text-primary">
                {siteConfig.legal.registeredName}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Commercial Registration
              </dt>
              <dd className="mt-1 text-text-primary">
                {siteConfig.legal.commercialRegistration}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Country
              </dt>
              <dd className="mt-1 text-text-primary">{siteConfig.legal.country}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-muted">
                Instagram
              </dt>
              <dd className="mt-1 text-text-primary">
                {siteConfig.social.instagram.handle}
              </dd>
            </div>
            {siteConfig.legal.ecommerceLicenceNumber && (
              <div>
                <dt className="text-xs uppercase tracking-wider text-text-muted">
                  E-Commerce Licence No.
                </dt>
                <dd className="mt-1 text-text-primary">
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
        <section id="complaints">
          <Container className="py-16 sm:py-24">
            <SectionHeading
              align="left"
              eyebrow="Complaints"
              title="Submit a complaint"
              description="For Version 1, complaints are sent directly to our customer service email — nothing is stored on this website."
            />
            <div className="mt-10 max-w-2xl rounded-card border border-border bg-surface p-6 sm:p-8">
              <ComplaintForm />
            </div>
          </Container>
        </section>
      )}
    </>
  );
}
