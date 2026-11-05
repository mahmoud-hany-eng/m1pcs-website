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
import { getBuildNotes } from "@/lib/build-notes";
import { BUILDS_DATA_UPDATED } from "@/lib/content-dates";
import {
  buildPageDescription,
  buildPageTitle,
  buildShortName,
  gpuModelLabel,
  nearbyBuilds,
  sameGpuBuilds,
} from "@/lib/build-seo";
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
    label: c.guideLabel,
    part: c.pick(build),
    partLabel: c.usedLabel,
  }));
  const related = nearbyBuilds(completedBuilds, build.slug, 3);
  const notes = getBuildNotes(build.slug);
  const sameGpu = sameGpuBuilds(completedBuilds, build);
  const gpuLabel = gpuModelLabel(build.gpu);

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
                M1 built this PC for a customer in Qatar, so this exact PC is not available to buy. Parts pricing and availability may
                have changed; request a similar build and M1 will quote current equivalents.
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

      {notes && (
        <section aria-labelledby="about-this-build" className="relative">
          <Container className="py-10 sm:py-14">
            <h2 id="about-this-build" className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              About this build
            </h2>
            <div className="mt-6 flex max-w-3xl flex-col gap-4 text-base text-text-secondary">
              <p>
                <strong className="font-semibold text-white">Platform and memory. </strong>
                {notes.platform}
              </p>
              <p>
                <strong className="font-semibold text-white">Cooling and airflow. </strong>
                {notes.cooling}
              </p>
              <p>
                <strong className="font-semibold text-white">Look. </strong>
                {notes.look}
              </p>
              {notes.extras && (
                <p>
                  <strong className="font-semibold text-white">Extras. </strong>
                  {notes.extras}
                </p>
              )}
            </div>
            {sameGpu.length > 0 && gpuLabel && (
              <div className="mt-8 max-w-3xl">
                <h3 className="font-display text-lg font-semibold text-white">Other builds with the {gpuLabel}</h3>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-text-secondary">
                  {sameGpu.map((b) => (
                    <li key={b.slug}>
                      <Link href={`/completed-builds/${b.slug}`} className="font-medium text-accent transition-colors hover:text-accent-hover">
                        {b.name}
                      </Link>{" "}
                      &mdash; {b.cpu} on a {b.motherboard} board, cooled by {b.cpuCooler}.
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Container>
        </section>
      )}

      <section className="relative">
        <Container className="py-10 sm:py-14">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Choosing parts like these</h2>
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
        description={`Tell M1 what you would keep and what you would change from the ${short} and we'll quote a current configuration.`}
      >
        <Button href={`/build-my-pc?reference=${encodeURIComponent(build.name)}`} size="lg" className="w-full sm:w-auto">
          Request a similar build
        </Button>
      </CTABlock>
    </>
  );
}
