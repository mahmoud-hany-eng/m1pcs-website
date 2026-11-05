import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { CTABlock } from "@/components/cta/CTABlock";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { completedBuilds } from "@/lib/builds";
import { categories } from "@/lib/categories";
import { categoryPages, getCategoryPage } from "@/lib/category-pages";
import { CATEGORY_PAGES_UPDATED } from "@/lib/content-dates";
import { guides } from "@/lib/guides";
import { siteConfig } from "@/lib/site-config";
import { pageMetadata, webPageJsonLd } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return categoryPages.map((c) => ({ slug: c.slug }));
}

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = getCategoryPage(slug);
  if (!page) return {};
  return pageMetadata({ title: page.title, description: page.description, path: `/products/${page.slug}` });
}

export default async function CategoryPageRoute({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = getCategoryPage(slug);
  if (!page) notFound();

  const path = `/products/${page.slug}`;
  const category = categories.find((c) => c.slug === page.slug);
  const quoteHref = `/build-my-pc?category=${encodeURIComponent(category?.name ?? page.short)}`;

  // Group completed builds by the part they used so repeated parts list every build once.
  const used = new Map<string, typeof completedBuilds>();
  for (const build of completedBuilds) {
    const key = page.pick(build);
    used.set(key, [...(used.get(key) ?? []), build]);
  }

  const relatedPages = page.related
    .map((s) => getCategoryPage(s))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const relatedGuides = page.guides
    .map((s) => guides.find((g) => g.slug === s))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <>
      <JsonLd
        data={webPageJsonLd({
          path,
          name: page.h1,
          description: page.description,
          type: "CollectionPage",
          dateModified: CATEGORY_PAGES_UPDATED,
        })}
      />

      <section className="relative">
        <Container className="pt-10 sm:pt-14">
          <Breadcrumbs path={path} trail={[{ name: "Products", href: "/products" }, { name: page.short }]} />
        </Container>
        <Container className="pb-4 pt-8 sm:pb-6 sm:pt-10">
          <SectionHeading as="h1" align="left" eyebrow="Components" title={page.h1} description={page.intro[0]} />
        </Container>
      </section>

      <section className="relative">
        <Container className="grid grid-cols-1 gap-10 py-8 sm:py-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)] lg:gap-16">
          <div className="flex flex-col gap-5 text-text-secondary">
            {page.intro.slice(1).map((p) => (
              <p key={p} className="text-base sm:text-lg">
                {p}
              </p>
            ))}
            <div className="flex flex-col gap-4 pt-2 sm:flex-row">
              <Button href={quoteHref} size="lg" className="w-full sm:w-auto">
                Request current pricing
              </Button>
              <Button href="/build-my-pc" variant="glass" size="lg" className="w-full sm:w-auto">
                Request a full PC quote
              </Button>
            </div>
          </div>

          <aside className="glass glass-flat flex flex-col gap-3 self-start p-6 text-sm text-text-secondary">
            <h2 className="font-display text-lg font-semibold text-white">Pricing &amp; availability</h2>
            <p>
              There is no fixed price list. Prices and availability change often, and many parts are sourced from the U.S. once your
              order is confirmed, so M1 quotes each request individually.
            </p>
            <p>{siteConfig.operations.deliveryNote}</p>
          </aside>
        </Container>
      </section>

      <section className="relative">
        <Container className="py-8 sm:py-12">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{page.considerationsHeading}</h2>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {page.considerations.map((c) => (
              <li key={c.title} className="glass glass-flat flex flex-col gap-2 p-6">
                <h3 className="font-display text-lg font-semibold text-white">{c.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{c.body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="relative">
        <Container className="py-8 sm:py-12">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {page.short} used in M1&rsquo;s completed builds
          </h2>
          <p className="mt-3 max-w-3xl text-text-secondary">
            Real parts from PCs M1 has already built for customers in Qatar. These are examples of what we work with, not a stock list —
            ask for current pricing and availability.
          </p>
          <div className="glass glass-flat mt-6 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">{page.short} used in completed M1 builds</caption>
              <thead>
                <tr className="border-b border-white/[0.08] text-text-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    {page.usedLabel}
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Used in
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...used.entries()].map(([part, builds]) => (
                  <tr key={part} className="border-b border-white/[0.05] align-top last:border-0">
                    <th scope="row" className="px-5 py-3 font-normal text-text-primary">
                      {part}
                    </th>
                    <td className="px-5 py-3">
                      <ul className="flex flex-col gap-1">
                        {builds.map((b) => (
                          <li key={b.slug}>
                            <Link href={`/completed-builds/${b.slug}`} className="text-accent transition-colors hover:text-accent-hover">
                              {b.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="relative">
        <Container className="grid grid-cols-1 gap-8 py-8 sm:py-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Related components</h2>
            <ul className="mt-4 flex flex-col gap-2">
              {relatedPages.map((c) => (
                <li key={c.slug}>
                  <Link href={`/products/${c.slug}`} className="text-accent transition-colors hover:text-accent-hover">
                    {c.h1}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/products" className="text-accent transition-colors hover:text-accent-hover">
                  All PC component categories
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-white">Guides</h2>
            <ul className="mt-4 flex flex-col gap-2">
              {relatedGuides.map((g) => (
                <li key={g.slug}>
                  <Link href={`/guides/${g.slug}`} className="text-accent transition-colors hover:text-accent-hover">
                    {g.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <CTABlock
        title={`Need ${page.short} for your build?`}
        description="Tell M1 what you're building and we'll quote current options and confirm availability."
      >
        <Button href={quoteHref} size="lg" className="w-full sm:w-auto">
          Request current pricing
        </Button>
      </CTABlock>
    </>
  );
}
