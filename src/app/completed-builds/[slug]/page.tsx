import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { SectionHeading, Eyebrow } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { CTABlock } from "@/components/cta/CTABlock";
import { BuildImageFrame } from "@/components/cards/BuildImageFrame";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { completedBuilds } from "@/lib/builds";
import { categoryPages } from "@/lib/category-pages";
import { BUILDS_DATA_UPDATED } from "@/lib/content-dates";
import { buildPageDescription, buildPageTitle, buildShortName, nearbyBuilds } from "@/lib/build-seo";
import { buildOgPath, buildPageJsonLd, pageMetadata } from "@/lib/seo";

/** Every completed build is known at build time; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return completedBuilds.map((b) => ({ slug: b.slug }));
}

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const build = completedBuilds.find((b) => b.slug === slug);
  if (!build) return {};
  return pageMetadata({
    title: buildPageTitle(build),
    absoluteTitle: true,
    description: buildPageDescription(build),
    path: `/completed-builds/${build.slug}`,
    image: build.imageSrc ? buildOgPath(build.slug) : undefined,
    imageAlt: build.imageAlt,
  });
}

export default async function CompletedBuildPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const build = completedBuilds.find((b) => b.slug === slug);
  if (!build) notFound();

  const path = `/completed-builds/${build.slug}`;
  const short = buildShortName(build);
  const specs: { label: string; value: string }[] = [
    { label: "CPU", value: build.cpu },
    { label: "GPU", value: build.gpu },
    { label: "RAM", value: build.ram },
    { label: "Storage", value: build.storage },
    { label: "Motherboard", value: build.motherboard },
    { label: "CPU cooler", value: build.cpuCooler },
    { label: "Power supply", value: build.psu },
    ...(build.accessories.length > 0 ? [{ label: "Extras", value: build.accessories.join(", ") }] : []),
  ];

  // The category pages for the parts in this build (descriptive, part-specific links).
  const partLinks = categoryPages.map((c) => ({
    href: `/products/${c.slug}`,
    label: `${c.short} in Qatar`,
    part: c.pick(build),
    partLabel: c.usedLabel,
  }));
  const related = nearbyBuilds(completedBuilds, build.slug, 3);

  return (
    <>
      <JsonLd
        data={buildPageJsonLd({
          path,
          name: build.name,
          description: buildPageDescription(build),
          imagePath: build.imageSrc ?? "/logo.png",
          imageAlt: build.imageAlt,
          dateModified: BUILDS_DATA_UPDATED,
        })}
      />

      <section className="relative">
        <Container className="pt-10 sm:pt-14">
          <Breadcrumbs
            path={path}
            trail={[{ name: "Completed builds", href: "/completed-builds" }, { name: short }]}
          />
        </Container>
      </section>

      <section className="relative overflow-x-clip">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-10 h-[640px] w-[min(1000px,140%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.1),transparent)]"
        />
        <Container className="relative grid grid-cols-1 gap-10 py-10 sm:py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-16">
          <div className="glass glass-flat">
            {build.imageSrc ? (
              <BuildImageFrame
                src={build.imageSrc}
                alt={build.imageAlt}
                scale={build.imageScale}
                translateX={build.imageTranslateX}
                translateY={build.imageTranslateY}
                sizes="(min-width: 1024px) 45vw, 100vw"
                priority
              />
            ) : (
              <div role="img" aria-label={build.imageAlt} className="flex aspect-[4/5] w-full items-center justify-center">
                <span className="text-xs font-medium uppercase tracking-widest text-text-muted">Photo coming soon</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-5">
              <Eyebrow>Completed build</Eyebrow>
              <SectionHeading as="h1" align="left" title={build.name} description={build.description} />
              <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-text-secondary shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
                M1 configured and built this PC for a customer in Qatar, so this exact PC is not available to buy. Component
                availability and pricing may have changed since it was completed — request a similar build and M1 will quote current
                equivalent parts.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl font-bold text-white">Specifications</h2>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {specs.map((row) => (
                  <div key={row.label} className="flex flex-col border-b border-white/[0.07] pb-3">
                    <dt className="text-sm text-text-muted">{row.label}</dt>
                    <dd className="text-text-primary">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row">
              <Button href={`/build-my-pc?reference=${encodeURIComponent(build.name)}`} size="lg" className="w-full sm:w-auto">
                Request a similar build
              </Button>
              <Button href="/completed-builds" variant="glass" size="lg" className="w-full sm:w-auto">
                All completed builds
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <section className="relative">
        <Container className="py-10 sm:py-14">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">About the parts in this build</h2>
          <p className="mt-3 max-w-3xl text-text-secondary">
            Each part below links to what to check before choosing that kind of component. M1 can quote the same parts or current
            alternatives, and confirms pricing and availability for every request.
          </p>
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {partLinks.map((p) => (
              <li key={p.href} className="glass glass-flat glass-interactive relative p-5">
                <p className="text-sm text-text-muted">{p.partLabel}</p>
                <p className="mt-1 text-text-primary">{p.part}</p>
                <Link
                  href={p.href}
                  className="mt-3 inline-flex text-sm font-semibold text-accent transition-colors after:absolute after:inset-0 after:content-[''] hover:text-accent-hover"
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="relative">
        <Container className="py-10 sm:py-14">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">More completed builds</h2>
          <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {related.map((b) => (
              <li key={b.slug} className="glass glass-flat glass-interactive relative flex flex-col">
                {b.imageSrc && (
                  <BuildImageFrame
                    src={b.imageSrc}
                    alt={b.imageAlt}
                    scale={b.imageScale}
                    translateX={b.imageTranslateX}
                    translateY={b.imageTranslateY}
                    sizes="(min-width: 640px) 30vw, 100vw"
                  />
                )}
                <div className="flex flex-col gap-1 p-5">
                  <Link
                    href={`/completed-builds/${b.slug}`}
                    className="font-display text-base font-semibold text-white transition-colors after:absolute after:inset-0 after:content-[''] hover:text-accent"
                  >
                    {b.name}
                  </Link>
                  <p className="text-sm text-text-secondary">
                    {b.cpu} &middot; {b.gpu}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <CTABlock
        title="Want a PC like this?"
        description="Tell M1 your budget and goals and we'll quote a current configuration, with pricing and availability confirmed."
      >
        <Button href={`/build-my-pc?reference=${encodeURIComponent(build.name)}`} size="lg" className="w-full sm:w-auto">
          Request a similar build
        </Button>
      </CTABlock>
    </>
  );
}
