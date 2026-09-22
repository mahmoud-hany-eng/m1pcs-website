import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Policies",
  description:
    "Terms & Conditions, Privacy Policy, Returns & Exchanges, Warranty, Delivery, Payment, Cancellations and Complaints information for M1 Gaming PCs.",
  alternates: { canonical: "/policies" },
};

/**
 * Content notice for the business owner: every section reflects the real
 * business rules provided (returns, warranty, delivery, payment methods,
 * cancellations). Where something genuinely hasn't been decided yet, it's
 * marked with a "[BUSINESS OWNER REVIEW REQUIRED]" comment directly above
 * it in this file (visible only in source code, never rendered publicly).
 */

const sections: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "terms",
    title: "Terms & Conditions",
    body: (
      <>
        <p>
          These terms govern your use of the M1 Gaming PCs website
          (operated by {siteConfig.legal.registeredName}, Commercial
          Registration No. {siteConfig.legal.commercialRegistration}) and any
          quotation, order or purchase arranged with us.
        </p>
        <p>
          Submitting an enquiry or quote request through this website does
          not create a binding order. An order is only confirmed once you
          have received and accepted a specific quotation from M1 and agreed
          on payment and delivery arrangements directly with our team via
          WhatsApp or Instagram.
        </p>
        {/* [BUSINESS OWNER REVIEW REQUIRED]: confirm any additional
           site-usage terms, acceptable-use rules, or liability limitations
           specific to the business. */}
        <p>
          Customer rights remain subject to applicable laws and regulations
          in the State of Qatar.
        </p>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Privacy Policy",
    body: (
      <>
        <p>
          When you submit a quote request, contact form or complaint, we
          collect the information you provide (such as your name, phone
          number, email address and the details of your enquiry) in order to
          respond to you and prepare a quotation.
        </p>
        <p>
          Version 1 of this website does not use a database or customer
          account system. Quote requests are sent directly to us via
          WhatsApp, and complaints are sent directly via email — information
          you submit is transmitted to us through those channels and is not
          stored on this website itself.
        </p>
        {/* [BUSINESS OWNER REVIEW REQUIRED]: confirm data retention
           practices once a CRM/database is introduced, and whether any
           analytics or marketing cookies are used. */}
        <p>
          We do not sell your personal information. If you have questions
          about how your information is handled, contact us using the
          details on our Contact page.
        </p>
      </>
    ),
  },
  {
    id: "returns",
    title: "Returns & Exchanges",
    body: (
      <>
        <p>
          Return requests may be accepted within{" "}
          {siteConfig.operations.returnWindowDays} days of delivery, subject
          to product condition and applicable terms. Please contact us as
          soon as possible if you receive a component or build that is
          faulty, damaged, or does not match your confirmed quotation.
        </p>
        {/* [BUSINESS OWNER REVIEW REQUIRED]: confirm any categories of item
           that are non-returnable (e.g. custom-built systems once
           assembled) and the exact condition requirements for a return. */}
        <p>
          Customer rights remain subject to applicable consumer protection
          laws in the State of Qatar.
        </p>
      </>
    ),
  },
  {
    id: "warranty",
    title: "Warranty",
    body: (
      <>
        <p>{siteConfig.operations.warrantyNote}</p>
        <p>
          Warranty coverage depends on the manufacturer and product category.
          Please retain your quotation and order confirmation, as these may
          be required to process a warranty claim.
        </p>
      </>
    ),
  },
  {
    id: "delivery",
    title: "Delivery Information",
    body: (
      <>
        <p>
          Home delivery is available across Qatar. {siteConfig.operations.deliveryNote}
        </p>
        {/* [BUSINESS OWNER REVIEW REQUIRED]: confirm whether a delivery fee
           applies and, if so, how it's calculated. */}
        <p>
          Delivery arrangements are confirmed with you directly as part of
          your accepted quotation.
        </p>
      </>
    ),
  },
  {
    id: "payment",
    title: "Payment Information",
    body: (
      <>
        <p>
          We currently accept {siteConfig.operations.paymentMethodsActive.join(" and ")}.
        </p>
        <p>{siteConfig.operations.depositNote}</p>
        <p className="text-text-muted">
          Additional payment options may be introduced in the future.
        </p>
      </>
    ),
  },
  {
    id: "cancellations",
    title: "Cancellations",
    body: (
      <>
        <p>
          Orders cannot be cancelled once the order has been confirmed and
          placed with suppliers. If you have concerns about an order in
          progress, please contact us as soon as possible and we will do our
          best to assist.
        </p>
      </>
    ),
  },
  {
    id: "complaints",
    title: "Complaints",
    body: (
      <>
        <p>
          If you are not satisfied with your experience, quotation or order,
          please submit a complaint using the form on our{" "}
          <a href="/contact#complaints" className="text-accent hover:text-accent-hover">
            Contact page
          </a>
          {siteConfig.contact.email && (
            <>
              {" "}or email us directly at{" "}
              <a
                href={`mailto:${siteConfig.contact.email}`}
                className="text-accent hover:text-accent-hover"
              >
                {siteConfig.contact.email}
              </a>
            </>
          )}
          . We aim to review and respond to complaints in a timely manner
          during our customer service hours ({siteConfig.contact.serviceHours}).
        </p>
      </>
    ),
  },
];

export default function PoliciesPage() {
  return (
    <>
      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            align="left"
            eyebrow="Legal"
            title="Policies"
            description="Terms, privacy, returns, warranty, delivery, payment, cancellations and complaints information for M1 Gaming PCs."
          />
        </Container>
      </section>

      <section>
        <Container className="py-16 sm:py-24">
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-16">
            <nav
              aria-label="Policy sections"
              className="lg:sticky lg:top-24 lg:h-fit lg:w-56 lg:shrink-0"
            >
              <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface hover:text-accent"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex flex-1 flex-col gap-14">
              {sections.map((section) => (
                <div key={section.id} id={section.id} className="scroll-mt-24">
                  <h2 className="font-display text-2xl font-bold">
                    {section.title}
                  </h2>
                  <div className="mt-4 flex flex-col gap-4 text-sm sm:text-base text-text-secondary [&_a]:underline [&_a]:underline-offset-2">
                    {section.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
