import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { CTABlock } from "@/components/cta/CTABlock";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { InlineText } from "@/components/seo/InlineText";
import { JsonLd } from "@/components/seo/JsonLd";
import { getGuide, guides, type Block } from "@/lib/guides";
import { articleJsonLd, pageMetadata } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return guides.map((g) => ({ slug: g.slug }));
}

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return pageMetadata({
    title: guide.title,
    description: guide.description,
    path: `/guides/${guide.slug}`,
    type: "article",
    publishedTime: guide.published,
    modifiedTime: guide.modified,
  });
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="list-disc space-y-2 pl-6 marker:text-accent">
          {block.items.map((item) => (
            <li key={item}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal space-y-2 pl-6 marker:text-accent">
          {block.items.map((item) => (
            <li key={item}>
              <InlineText text={item} />
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="glass glass-flat overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="px-5 pb-1 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              {block.caption}
            </caption>
            <thead>
              <tr className="border-b border-white/[0.08] text-text-muted">
                {block.head.map((h) => (
                  <th key={h} scope="col" className="px-5 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-b border-white/[0.05] last:border-0">
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={cell} scope="row" className="px-5 py-3 font-medium text-text-primary">
                        {cell}
                      </th>
                    ) : (
                      <td key={cell} className="px-5 py-3">
                        {cell}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note":
      return (
        <p className="rounded-xl bg-white/[0.03] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
          <InlineText text={block.text} />
        </p>
      );
  }
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const path = `/guides/${guide.slug}`;

  return (
    <>
      <JsonLd
        data={articleJsonLd({
          path,
          headline: guide.title,
          description: guide.description,
          datePublished: guide.published,
          dateModified: guide.modified,
        })}
      />

      <section className="relative">
        <Container className="pt-10 sm:pt-14">
          <Breadcrumbs path={path} trail={[{ name: "Guides", href: "/guides" }, { name: guide.title }]} />
        </Container>
        <Container className="pb-4 pt-8 sm:pb-6 sm:pt-10">
          <SectionHeading as="h1" align="left" eyebrow="Guide" title={guide.h1} />
          <p className="mt-4 text-sm text-text-muted">
            By M1 Gaming PCs &middot; Published {formatDate(guide.published)}
            {guide.modified !== guide.published ? ` · Updated ${formatDate(guide.modified)}` : ""}
          </p>
        </Container>
      </section>

      <section className="relative">
        <Container className="grid grid-cols-1 gap-10 py-8 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
          <nav
            aria-label="On this page"
            className="glass-subtle h-fit rounded-glass p-2 lg:sticky lg:top-28"
          >
            <ul className="flex flex-wrap gap-1 lg:flex-col">
              {guide.sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded-xl px-3.5 py-2 text-sm text-text-secondary transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="flex max-w-3xl flex-col gap-12 text-base text-text-secondary">
            <div className="flex flex-col gap-4 text-lg">
              {guide.intro.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            {guide.sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="font-display text-2xl font-bold tracking-tight text-white">{s.heading}</h2>
                <div className="mt-4 flex flex-col gap-4">
                  {s.blocks.map((b, i) => (
                    <BlockView key={i} block={b} />
                  ))}
                </div>
              </section>
            ))}

            <section aria-labelledby="related-heading" className="border-t border-white/[0.08] pt-8">
              <h2 id="related-heading" className="font-display text-xl font-bold text-white">
                Keep reading
              </h2>
              <ul className="mt-4 flex flex-col gap-2">
                {guide.related.map((r) => (
                  <li key={r.href}>
                    <Link href={r.href} className="text-accent transition-colors hover:text-accent-hover">
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </article>
        </Container>
      </section>

      <CTABlock title="Want M1 to plan it for you?" description="Tell us your budget and goals and request a current quotation.">
        <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
          Request a PC Quote
        </Button>
      </CTABlock>
    </>
  );
}
